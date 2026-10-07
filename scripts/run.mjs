#!/usr/bin/env node
/**
 * 通用启动器：用「当前 Node」运行工作区内的命令，并统一临时目录。
 * ------------------------------------------------------------------
 * 它解决三个真实问题：
 * 1. 包管理器执行 npm scripts 时不会替换 PATH 里原有的 node，系统 node 过旧时
 *    Vite 7 会直接失败；这里把当前 node 目录前置到 PATH。
 * 2. esbuild / Vite 默认往系统 TEMP 写临时文件，在受限（沙箱）环境下会因无法删除而
 *    报 "Access is denied"；这里把 TEMP/TMP/ESBUILD_TMPDIR 统一指向仓库内的 .tmp。
 * 3. 直接把 node_modules/.bin 里的可执行文件转成「node <js 入口>」调用，
 *    不再经过 shell，避免 Windows 下 .cmd 转发的各种坑。
 *
 * 用法：
 *   node scripts/run.mjs --cwd client vite build
 *   node scripts/run.mjs --cwd server tsx watch src/index.ts
 *   node scripts/run.mjs node -e "console.log(1)"
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

let cwd = ROOT;
const cwdFlag = argv.indexOf('--cwd');
if (cwdFlag !== -1) {
  cwd = resolve(argv[cwdFlag + 1] ?? ROOT);
  argv.splice(cwdFlag, 2);
}

const [rawCommand, ...rawArgs] = argv;
if (!rawCommand) {
  console.error('[run] 用法: node scripts/run.mjs [--cwd <dir>] <命令> [...参数]');
  process.exit(1);
}

/* ------------------------------- 环境准备 ------------------------------- */

for (const dir of [join(ROOT, '.tmp', 'tmp'), join(ROOT, '.tmp', 'esbuild')]) {
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* 已存在或无权限时忽略 */
  }
}

/**
 * 挑选一个「足够新」的 Node：
 * 包管理器会用自己绑定的 node 执行 npm scripts（例如系统里的 Node 18），
 * 而 Vite 7 / @vitejs/plugin-vue 需要 Node ≥ 20.19（用到 crypto.hash）。
 * 这里按优先级探测，把找到的目录前置到 PATH，并直接用它的 node 执行子命令。
 */
function candidateNodeDirs() {
  const dirs = [];
  const push = (dir) => {
    if (dir && !dirs.includes(dir)) dirs.push(dir);
  };

  push(process.env.GLINTCHAT_NODE_DIR);
  push(dirname(process.execPath));

  const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
  if (home) {
    push(join(home, '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin'));
  }

  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
  push(join(programFiles, 'nodejs'));
  push('C:\\Program Files\\nodejs');

  return dirs;
}

function nodeBinary(dir) {
  for (const name of ['node.exe', 'node']) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** 读取主版本号，失败返回 0 */
function nodeMajor(binary) {
  try {
    const output = execFileSync(binary, ['-v'], { encoding: 'utf8' }).trim();
    const match = output.match(/^v?(\d+)/);
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}

let activeNodeBinary = process.execPath;
let activeNodeDir = dirname(process.execPath);
let activeMajor = nodeMajor(activeNodeBinary);

for (const dir of candidateNodeDirs()) {
  if (dir === activeNodeDir) continue;
  const binary = nodeBinary(dir);
  if (!binary) continue;

  const major = nodeMajor(binary);
  if (major > activeMajor) {
    activeNodeBinary = binary;
    activeNodeDir = dir;
    activeMajor = major;
  }
}

const MIN_MAJOR = 20;
if (activeMajor < MIN_MAJOR) {
  console.warn(
    `[run] ⚠ 当前可用的最高 Node 版本为 v${activeMajor}，Vite 7 需要 >= ${MIN_MAJOR}.19。\n` +
      '      请升级 Node，或用 GLINTCHAT_NODE_DIR 指定一个较新的 Node 安装目录。',
  );
}

const nodeDir = activeNodeDir;
const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
const env = {
  ...process.env,
  TEMP: join(ROOT, '.tmp', 'tmp'),
  TMP: join(ROOT, '.tmp', 'tmp'),
  ESBUILD_TMPDIR: join(ROOT, '.tmp', 'esbuild'),
};
env[pathKey] = nodeDir ? `${nodeDir}${delimiter}${env[pathKey] ?? ''}` : (env[pathKey] ?? '');

/** 常用命令在包内的真实入口（扁平安装布局下都在根 node_modules 里） */
const DIRECT_ENTRIES = {
  vite: ['vite/bin/vite.js'],
  'vue-tsc': ['vue-tsc/bin/vue-tsc.js'],
  tsx: ['tsx/dist/cli.mjs'],
  tsc: ['typescript/bin/tsc', 'typescript/lib/tsc.js'],
  concurrently: ['concurrently/dist/bin/concurrently.js'],
};

/* --------------------------- 解析本地 .bin 命令 --------------------------- */

/** 在若干 node_modules/.bin 中查找命令，返回可直接 spawn 的 {file, args} */
function resolveLocalBin(command, args) {
  const nodeModulesDirs = [
    join(cwd, 'node_modules'),
    join(ROOT, 'node_modules'),
    join(cwd, '..', 'node_modules'),
  ];

  for (const nodeModules of nodeModulesDirs) {
    // 1) 优先直接命中包内的 js/mjs 入口，最稳（完全不经过 shell）
    for (const relative of DIRECT_ENTRIES[command] ?? []) {
      const entry = join(nodeModules, relative);
      if (existsSync(entry)) {
        return { file: activeNodeBinary, args: [realpathSync(entry), ...args] };
      }
    }

    // 2) 退回到 .bin shim，解析其转发脚本指向的 js 入口
    const binDir = join(nodeModules, '.bin');
    for (const suffix of ['.CMD', '.cmd', '.exe', '']) {
      const shim = join(binDir, `${command}${suffix}`);
      if (!existsSync(shim)) continue;

      const jsEntry = extractJsEntry(shim);
      if (jsEntry) return { file: activeNodeBinary, args: [jsEntry, ...args] };

      // 解析失败：Windows 下用 cmd.exe 显式执行 .cmd，避免 shell:true 的注入与转义问题
      if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(shim)) {
        return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', shim, ...args] };
      }
      return { file: shim, args };
    }
  }
  return null;
}

/** 从 .bin 的 shim 里提取真实 js 入口路径 */
function extractJsEntry(shimPath) {
  try {
    const content = readFileSync(shimPath, 'utf8');
    // 依次尝试：带引号的入口、不带引号的入口（如 tsc 的 shim）
    const candidates = [
      content.match(/"([^"\r\n]*\.(?:js|cjs|mjs))"/i)?.[1],
      content.match(/([^\s"'()]+\.(?:js|cjs|mjs))(?=["'\s]|$)/i)?.[1],
    ].filter(Boolean);

    for (const raw of candidates) {
      // 去掉 .bin shim 里的批处理变量前缀，以及紧随其后的路径分隔符
      const target = raw.replace(/%~dp0%?/gi, '').replace(/^[\\/]+/, '');
      if (!target) continue;

      if (/^[A-Za-z]:/.test(target)) {
        if (existsSync(target)) return target;
        continue;
      }

      for (const base of [dirname(shimPath), resolve(dirname(shimPath), '..')]) {
        const resolved = resolve(base, target.replace(/\\/g, '/'));
        if (existsSync(resolved)) return realpathSync(resolved);
      }
    }
    return null;
  } catch {
    return null;
  }
}

const local = resolveLocalBin(rawCommand, rawArgs);
const spawnOptions = { stdio: 'inherit', env, cwd };

const file = local?.file ?? rawCommand;
const args = local?.args ?? rawArgs;

console.log(`[run] ${rawCommand} (cwd=${cwd.replace(ROOT, '.')})`);

const child = spawn(file, args, spawnOptions);

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
child.on('error', (error) => {
  console.error(`[run] 启动失败: ${error.message}`);
  process.exit(1);
});
