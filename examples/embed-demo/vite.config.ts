import { fileURLToPath, URL } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';
// 注意：不要直接 import { resolve } from 'node:path'，
// 会与下面配置里的 `resolve` 字段同名，导致路径解析被覆盖（这个坑很隐蔽）。
import * as path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

// esbuild 默认往系统 TEMP 写临时文件；受限环境下那里可能不可写，统一放到仓库 .tmp
const esbuildTmpDir = fileURLToPath(new URL('../../.tmp/esbuild', import.meta.url));
try {
  mkdirSync(esbuildTmpDir, { recursive: true });
} catch {
  /* 忽略 */
}
process.env.ESBUILD_TMPDIR ??= esbuildTmpDir;

/**
 * 为「项目目录之外」的源码补全无扩展名相对导入。
 *
 * 背景：本示例通过别名直接引用 packages/vue 的源码（仓库内开发最省事），
 * 这些文件里的相对导入（如 '../core/stream'）在打包阶段不会被自动补后缀，
 * 会报 Could not resolve。发布形态下宿主安装的是预构建产物，不会有这个问题。
 */
function resolveRelativeExtensions(): Plugin {
  const candidates = ['.ts', '.tsx', '.mts', '.js', '.mjs', '/index.ts'];

  return {
    name: 'glintchat:resolve-relative-extensions',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer) return null;
      if (!source.startsWith('./') && !source.startsWith('../')) return null;
      if (/\.(ts|tsx|mts|js|mjs|cjs|json|vue|css)$/.test(source)) return null;

      const baseDir = path.dirname(importer);
      for (const ext of candidates) {
        const candidate = path.join(baseDir, `${source}${ext}`);
        if (existsSync(candidate)) {
          if (process.env.GLINTCHAT_RESOLVE_DEBUG) {
            console.log(
              `[resolve] 命中 ${source}${ext} baseDir=${baseDir} -> ${candidate}`,
            );
          }
          return candidate;
        }
      }
      if (process.env.GLINTCHAT_RESOLVE_DEBUG) {
        console.log(
          `[resolve] 未命中 source=${source} baseDir=${baseDir} 候选=${path.join(baseDir, `${source}.ts`)} 存在=${existsSync(path.join(baseDir, `${source}.ts`))}`,
        );
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [resolveRelativeExtensions(), vue(), tailwindcss()],
  resolve: {
    alias: {
      '@glintchat/vue': fileURLToPath(new URL('../../packages/vue/src/index.ts', import.meta.url)),
    },
    // 让 Vite/Rollup 为无扩展名的相对导入尝试这些后缀
    extensions: ['.ts', '.tsx', '.mts', '.js', '.mjs', '.json', '.vue'],
  },
  server: {
    port: Number(process.env.DEMO_PORT || 5180),
    strictPort: false,
    fs: {
      // 允许读取仓库内的库源码
      allow: [fileURLToPath(new URL('../../', import.meta.url))],
    },
    proxy: {
      '/api': {
        target: process.env.DEMO_API_TARGET || 'http://localhost:3000',
        changeOrigin: true,
        configure: (proxy) => {
          // SSE 必须禁用压缩，否则打字机效果会攒成一坨
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Accept-Encoding', 'identity');
          });
        },
      },
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    chunkSizeWarningLimit: 900,
  },
});
