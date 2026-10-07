#!/usr/bin/env node
/**
 * 同步 @glintchat/vue 库源码里相对导入的 .ts 扩展名。
 *
 * 为什么源码要写 .ts：
 *   打包阶段（Rollup / Vite build）不会为无扩展名的相对导入补后缀，
 *   显式写扩展名后 Rollup 能原生解析；配合 tsconfig 里的
 *   allowImportingTsExtensions（源码允许）与 rewriteRelativeImportExtensions
 *   （emit 时改回 .js），产出的是标准 ESM。
 *
 * 为什么需要这个脚本：扩展名是「约定」，容易在新增文件时漏写，
 *   用脚本统一补全比靠人肉 review 可靠。
 *
 * 用法：
 *   node scripts/sync-lib-import-extensions.mjs          补全（默认）
 *   node scripts/sync-lib-import-extensions.mjs --check   只检查，有缺失时返回码 1
 *   node scripts/sync-lib-import-extensions.mjs --remove  撤销（改回无扩展名）
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIB_SRC = join(ROOT, 'packages', 'vue', 'src');

const mode = process.argv.includes('--remove')
  ? 'remove'
  : process.argv.includes('--check')
    ? 'check'
    : 'add';

function collect(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collect(full));
    else if (/\.(ts|vue)$/.test(entry)) out.push(full);
  }
  return out;
}

const ADD_RE = /(from\s+['"])(\.\.?\/[^'"]+?)(['"])/g;
const REMOVE_RE = /(from\s+['"])(\.\.?\/[^'"]+?)\.ts(['"])/g;

function transform(source, file) {
  if (mode === 'remove') {
    return source.replace(REMOVE_RE, (_m, prefix, specifier, quote) => `${prefix}${specifier}${quote}`);
  }
  return source.replace(ADD_RE, (match, prefix, specifier, quote) => {
    // 已经是带扩展名（.ts/.vue/.json/.css/...）的导入保持不变
    if (/\.(ts|tsx|js|mjs|cjs|json|vue|css)$/.test(specifier)) return match;
    void file;
    return `${prefix}${specifier}.ts${quote}`;
  });
}

let changed = 0;
for (const file of collect(LIB_SRC)) {
  const original = readFileSync(file, 'utf8');
  const next = transform(original, file);
  if (next === original) continue;

  changed += 1;
  console.log(`  - ${file.replace(ROOT, '').replace(/\\/g, '/')}`);
  if (mode !== 'check') writeFileSync(file, next, 'utf8');
}

const label = mode === 'remove' ? '已撤销' : mode === 'check' ? '需要修改' : '已修改';
console.log(`[sync-lib-import-extensions] ${label} ${changed} 个文件`);
process.exit(mode === 'check' && changed > 0 ? 1 : 0);
