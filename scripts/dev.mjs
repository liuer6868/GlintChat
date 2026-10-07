#!/usr/bin/env node
/**
 * 开发环境启动器
 * ------------------------------------------------------------------
 * `pnpm dev` 会并行调用本脚本两次（server / client）。
 * 真正的启动逻辑复用 scripts/run.mjs：统一 Node 版本、临时目录，并直接以
 * `node <js 入口>` 启动本地命令（不经过 shell，也不依赖 PATH 里的 node）。
 *
 * 背景：包管理器执行 npm scripts 时不会替换 PATH 中已有的 node，
 * 若系统 node 过旧（如 18.x），Vite 7 会直接报错退出。
 *
 * 用法：node scripts/dev.mjs <server|client>
 */
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [target] = process.argv.slice(2);

const TASKS = {
  server: { cwd: join(ROOT, 'server'), command: 'tsx', args: ['watch', '--clear-screen=false', 'src/index.ts'] },
  client: { cwd: join(ROOT, 'client'), command: 'vite', args: [] },
};

const task = TASKS[target];
if (!task) {
  console.error('[dev] 用法: node scripts/dev.mjs <server|client>');
  process.exit(1);
}

const child = spawn(
  process.execPath,
  [join(ROOT, 'scripts', 'run.mjs'), '--cwd', task.cwd, task.command, ...task.args, ...process.argv.slice(3)],
  { stdio: 'inherit', cwd: ROOT },
);

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
child.on('error', (error) => {
  console.error(`[dev] 启动失败: ${error.message}`);
  process.exit(1);
});
