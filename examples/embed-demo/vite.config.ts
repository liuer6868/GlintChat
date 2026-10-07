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
 * 关键点：Node 后端与前端不同源，用 Vite 代理把 /api 转发过去（同时避免 CORS 与 SSE 缓冲问题）。
 */
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    port: Number(process.env.DEMO_PORT || 5180),
    strictPort: false,
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
