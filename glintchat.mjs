#!/usr/bin/env node
/**
 * GlintChat 一键命令入口（跨平台，无需预先安装 pnpm）
 * ---------------------------------------------------------------------------
 * 解决的问题：项目需要 Node ≥ 20.19 与 pnpm，但机器上可能
 *   1) 只装了旧版 Node（如 18.x，Vite 7 会直接报错）；
 *   2) 根本没有 pnpm。
 *
 * 本脚本自动寻找可用的 Node 与 pnpm，再用它们执行你的命令，
 * 不修改系统环境变量、不写注册表。
 *
 * 用法：
 *   node glintchat.mjs install          # 安装依赖
 *   node glintchat.mjs dev              # 同时启动前后端
 *   node glintchat.mjs build            # 构建生产产物
 *   node glintchat.mjs start            # 生产模式启动后端
 *   node glintchat.mjs node -v          # 用找到的 Node 执行任意命令
 *   node glintchat.mjs --doctor         # 环境体检（不执行命令）
 *   node glintchat.mjs --node <目录> dev # 指定 Node 目录
 *
 * Windows 下可用短命令： glintchat.cmd install
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const ROOT = dirname(fileURLToPath(import.meta.url));
const IS_WINDOWS = process.platform === 'win32';
const MIN_MAJOR = 20;
const MIN_MINOR = 19;

const colors = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  red: '\u001b[31m',
  cyan: '\u001b[36m',
};
const paint = (color, text) =>
  process.stdout.isTTY ? `${colors[color]}${text}${colors.reset}` : text;

/* ============================== 基础工具 ============================== */

function nodeBinary(dir) {
  if (!dir) return null;
  for (const name of IS_WINDOWS ? ['node.exe', 'node'] : ['node', 'node.exe']) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** 读取 Node 版本：优先执行 node -v，失败则读同目录的版本信息文件 */
function nodeVersion(dir, binary) {
  // 1) 直接问二进制（最准；少数受限环境不允许 spawn，会走到下面的回退）
  try {
    const raw = execFileSync(binary, ['-v'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 8000,
    }).trim();
    const match = raw.match(/^v?(\d+)\.(\d+)\.(\d+)/);
    if (match) {
      return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), raw };
    }
  } catch {
    /* 继续尝试文件回退 */
  }

  // 2) 读同目录的版本描述文件
  const files = ['.node-version', 'NODE_VERSION', 'node-version', 'VERSION'];
  for (const name of files) {
    const file = join(dir, name);
    if (!existsSync(file)) continue;
    try {
      const raw = readFileSync(file, 'utf8').trim();
      const match = raw.match(/v?(\d+)\.(\d+)\.(\d+)/);
      if (match) {
        return {
          major: Number(match[1]),
          minor: Number(match[2]),
          patch: Number(match[3]),
          raw: `v${match[1]}.${match[2]}.${match[3]}`,
        };
      }
    } catch {
      /* 忽略 */
    }
  }

  return null;
}

function isSupported(version) {
  if (!version) return false;
  if (version.major > MIN_MAJOR) return true;
  return version.major === MIN_MAJOR && version.minor >= MIN_MINOR;
}

/** 从 PATH 里解析命令的绝对路径（只查文件系统，不执行命令） */
function findInPath(command) {
  const exts = IS_WINDOWS ? ['', '.exe', '.cmd', '.bat'] : [''];

  for (const rawDir of (process.env.PATH ?? '').split(delimiter)) {
    const dir = rawDir.replace(/^"|"$/g, '').trim();
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, `${command}${ext}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** 在目录里递归查找指定文件名（pnpm 的 .cmd 可能在 hash 命名的子目录中） */
function findRecursive(dir, names, depth = 3) {
  if (depth < 0 || !existsSync(dir)) return null;

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (entry.isFile() && names.includes(entry.name.toLowerCase())) return join(dir, entry.name);
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = findRecursive(join(dir, entry.name), names, depth - 1);
    if (found) return found;
  }
  return null;
}

/* ============================== 探测 Node ============================== */

const argv = process.argv.slice(2);
const doctorOnly = argv.includes('--doctor');

// 支持 --node <目录> 显式指定
let cliNodeDir = '';
const nodeFlagIndex = argv.indexOf('--node');
if (nodeFlagIndex !== -1) {
  cliNodeDir = argv[nodeFlagIndex + 1] ?? '';
  argv.splice(nodeFlagIndex, 2);
}

const [command, ...rest] = argv.filter((item) => item !== '--doctor');

const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
const localAppData = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';

const candidates = [];
const pushCandidate = (dir) => {
  if (dir && !candidates.includes(dir)) candidates.push(dir);
};

// 当前正在运行本脚本的 Node：它一定是可用的
pushCandidate(process.env.GLINTCHAT_NODE_DIR ?? '');
pushCandidate(cliNodeDir);
pushCandidate(join(ROOT, '.tools', 'node')); // 项目便携版（scripts/setup-node.ps1）
pushCandidate(dirname(process.execPath)); // 正在运行它的那个 Node
pushCandidate(join(home, '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin'));
pushCandidate(join(programFiles, 'nodejs'));
pushCandidate(join(programFilesX86, 'nodejs'));
pushCandidate(join(localAppData, 'Programs', 'nodejs'));
pushCandidate(join(home, 'scoop', 'apps', 'nodejs', 'current'));
pushCandidate('D:\\vue3huanjing');
pushCandidate(findInPath('node') ? dirname(findInPath('node')) : '');

const probes = [];
for (const dir of candidates) {
  const binary = nodeBinary(dir);
  if (!binary) continue;

  const isSelf = binary === process.execPath;
  const version = isSelf
    ? (() => {
        const match = process.versions.node.match(/^(\d+)\.(\d+)\.(\d+)/);
        return match
          ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), raw: `v${process.versions.node}` }
          : null;
      })()
    : nodeVersion(dir, binary);

  probes.push({ dir, binary, version, isSelf });
}

/** 选择策略：版本已知且合规 > 未知版本（交给实际执行去验证）> 当前 Node */
const supported = probes
  .filter((item) => isSupported(item.version))
  .sort((a, b) => b.version.major - a.version.major);

const unknown = probes.filter((item) => !item.version);
const chosen = supported[0] ?? unknown.find((item) => item.isSelf) ?? unknown[0] ?? null;

/* ============================== 探测 pnpm ============================== */

function findPnpm() {
  const inPath = findInPath('pnpm');
  if (inPath) return { kind: 'bin', path: inPath };

  // DSH 内置 pnpm（本机已存在），用 node 执行 pnpm.cjs
  const dshPnpm = join(
    home,
    '.dsh',
    'dsh-runtimes',
    'dsh-primary-runtime',
    'dependencies',
    'pnpm',
    'bin',
    'pnpm.cjs',
  );
  if (existsSync(dshPnpm)) return { kind: 'script', path: dshPnpm };

  // pnpm 独立安装目录
  const pnpmHome = process.env.PNPM_HOME ?? join(localAppData, 'pnpm');
  const standalone = findRecursive(pnpmHome, IS_WINDOWS ? ['pnpm.exe', 'pnpm.cmd', 'pnpm'] : ['pnpm']);
  if (standalone) return { kind: 'bin', path: standalone };

  const script = findRecursive(pnpmHome, ['pnpm.cjs', 'pnpm.mjs']);
  if (script) return { kind: 'script', path: script };

  // npm 全局目录
  const npmGlobal = join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'npm');
  const npmPnpm = findRecursive(npmGlobal, IS_WINDOWS ? ['pnpm.cmd', 'pnpm.exe', 'pnpm'] : ['pnpm']);
  if (npmPnpm) return { kind: 'bin', path: npmPnpm };

  return null;
}

/* ============================== 体检输出 ============================== */

function printDiagnosis() {
  const pnpm = findPnpm();

  console.log('');
  console.log(paint('cyan', '  GlintChat 环境体检'));
  console.log(`  ${paint('dim', '─'.repeat(56))}`);
  console.log(`  正在运行本脚本的 Node : ${process.version}`);
  console.log(`  探测到的 Node 候选：`);

  if (probes.length === 0) {
    console.log(`    ${paint('red', '未找到任何 node 可执行文件')}`);
  }

  for (const item of probes) {
    const known = Boolean(item.version);
    const ok = isSupported(item.version);
    const mark = known ? (ok ? paint('green', '✔ 可用  ') : paint('red', '✘ 版本低')) : paint('yellow', '? 未知  ');
    const label = known ? item.version.raw : '(无法执行 -v 探测)';
    console.log(`    - ${label.padEnd(12)} ${mark} ${paint('dim', item.dir)}`);
  }

  console.log(`  ${paint('dim', '─'.repeat(56))}`);
  console.log(
    `  选用的 Node          : ${
      chosen ? `${chosen.version ? chosen.version.raw : '(版本未知)'}  ${paint('dim', chosen.binary)}` : paint('red', '无')
    }`,
  );
  console.log(
    `  pnpm                 : ${pnpm ? `${paint('green', '已找到')}  ${paint('dim', pnpm.path)}` : paint('red', '未找到')}`,
  );
  console.log(`  ${paint('dim', '─'.repeat(56))}`);

  if (!chosen || !isSupported(chosen.version)) {
    console.log('');
    console.log(paint('yellow', `  ⚠ 没有找到版本明确符合要求的 Node（需要 >= ${MIN_MAJOR}.${MIN_MINOR}）`));
    console.log('    任选一种方式：');
    console.log('      1) 安装 Node 22 LTS：https://nodejs.org/zh-cn/download');
    console.log('      2) 本项目内安装便携版：pwsh -File scripts/setup-node.ps1');
    console.log('      3) 已有新版 Node：node glintchat.mjs --node <node目录> install');
    console.log('         或设置环境变量 GLINTCHAT_NODE_DIR=<node目录>');
  }

  if (!pnpm) {
    console.log('');
    console.log(paint('yellow', '  ⚠ 没有找到 pnpm'));
    console.log('    安装方式：npm i -g pnpm        或        corepack enable pnpm');
  }

  console.log('');
  return { pnpm };
}

const { pnpm } = printDiagnosis();

if (doctorOnly) {
  process.exit(chosen && isSupported(chosen.version) && pnpm ? 0 : 1);
}

if (!command) {
  console.log('  可用命令： install | dev | build | typecheck | start | preview | clean | node <...>');
  console.log('');
  process.exit(0);
}

/* ============================== 执行命令 ============================== */

if (!chosen) {
  console.error(paint('red', '[glintchat] 找不到 Node，请先安装 Node 20.19+'));
  process.exit(1);
}

if (chosen.version && !isSupported(chosen.version)) {
  console.error(
    paint('red', `[glintchat] Node ${chosen.version.raw} 低于要求的 ${MIN_MAJOR}.${MIN_MINOR}`),
  );
  console.error('  请安装 Node 22 LTS，或运行 pwsh -File scripts/setup-node.ps1');
  process.exit(1);
}

if (!pnpm) {
  console.error(paint('red', '[glintchat] 没有找到 pnpm，请先执行：npm i -g pnpm'));
  process.exit(1);
}

const NPM_LIFECYCLE = new Set([
  'install',
  'i',
  'ci',
  'add',
  'remove',
  'rm',
  'update',
  'dev',
  'build',
  'start',
  'preview',
  'clean',
  'typecheck',
  'test',
]);

let file;
let args;
if (NPM_LIFECYCLE.has(command)) {
  if (pnpm.kind === 'script') {
    file = chosen.binary;
    args = [pnpm.path, command, ...rest];
  } else {
    file = pnpm.path;
    args = [command, ...rest];
  }
} else {
  file = chosen.binary;
  args = [command, ...rest];
}

const env = {
  ...process.env,
  // 选中的 Node 放到 PATH 最前面，pnpm 派生的子进程（tsx / vite）也会用它
  PATH: `${chosen.dir}${delimiter}${process.env.PATH ?? ''}`,
  ESBUILD_TMPDIR: process.env.ESBUILD_TMPDIR ?? join(ROOT, '.tmp', 'esbuild'),
};

console.log(
  `  ${paint('cyan', 'GlintChat')} ${paint('dim', `使用 ${chosen.version ? chosen.version.raw : '未知版本'} Node → ${chosen.dir}`)}`,
);
console.log(`  ${paint('dim', `执行: ${command} ${rest.join(' ')}`)}`);
console.log('');

const child = spawn(file, args, { stdio: 'inherit', env, cwd: ROOT });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
child.on('error', (error) => {
  console.error(paint('red', `[glintchat] 启动失败: ${error.message}`));
  process.exit(1);
});
