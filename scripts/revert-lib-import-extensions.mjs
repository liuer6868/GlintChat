#!/usr/bin/env node
/**
 * 还原 @glintchat/vue 源码里相对导入的 .ts 扩展名（恢复常规的无扩展名写法）。
 * 用法：node scripts/revert-lib-import-extensions.mjs
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIB_SRC = join(ROOT, 'packages', 'vue', 'src');

function collect(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collect(full));
    else if (/\.(ts|vue)$/.test(entry)) out.push(full);
  }
  return out;
}

const RE = /(from\s+['"])(\.\.?\/[^'"]+?)\.ts(['"])/g;

let changed = 0;
for (const file of collect(LIB_SRC)) {
  const original = readFileSync(file, 'utf8');
  const next = original.replace(RE, (_m, prefix, specifier, quote) => `${prefix}${specifier}${quote}`);
  if (next !== original) {
    writeFileSync(file, next, 'utf8');
    changed += 1;
  }
}
console.log(`[revert] 已还原 ${changed} 个文件`);
