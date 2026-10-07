import { fileURLToPath, URL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { defineConfig } from 'vite';
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
 * 最小宿主示例的构建配置。
 *
 * ⚠ 当前状态（详见 docs/plugin-roadmap.md 第 0 节）：
 *   本示例通过别名指向 packages/vue 的**源码目录**，这是仓库内开发最省事的方式，
 *   但 `vite build` 会因为「项目根之外的源码不做扩展名补全」而失败。
 *   等库产物（vite build --lib，同时编译 .ts 与 .vue）落地后，
 *   删掉下面的 alias，改为直接 import 包名即可正常构建。
 *
 * 代理部分与真实宿主一致：前端与 Node 后端不同源时用它转发 /api，
 * 顺带避免 CORS 与 SSE 被缓冲。
 */
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@glintchat/vue': fileURLToPath(new URL('../../packages/vue/src/index.ts', import.meta.url)),
    },
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
