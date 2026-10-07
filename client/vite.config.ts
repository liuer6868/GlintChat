import { fileURLToPath, URL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

// 从仓库根目录读取 .env，保证前后端使用同一个端口约定
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// esbuild 默认把临时文件写到系统 TEMP；在某些受限/沙箱环境里那里不可写，
// 统一改到仓库内的 .tmp/esbuild，既避免权限问题，也便于清理。
const esbuildTmpDir = fileURLToPath(new URL('../.tmp/esbuild', import.meta.url));
try {
  mkdirSync(esbuildTmpDir, { recursive: true });
} catch {
  /* 创建失败时回退到 esbuild 默认行为 */
}
process.env.ESBUILD_TMPDIR ??= esbuildTmpDir;

export default defineConfig(({ mode }) => {
  const env = {
    ...loadEnv(mode, repoRoot, ''),
    ...loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), ''),
  };
  const apiTarget = env.VITE_PROXY_TARGET || `http://localhost:${env.PORT || 3000}`;

  return {
    plugins: [vue(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: Number(env.VITE_PORT || 5173),
      strictPort: false,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          // SSE 必须关闭代理侧缓冲，否则打字机效果会攒成一坨
          configure: (proxy) => {
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
      sourcemap: false,
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks: {
            markdown: ['marked', 'dompurify', 'highlight.js'],
          },
        },
      },
    },
  };
});
