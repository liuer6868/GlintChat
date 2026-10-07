/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}

interface ImportMetaEnv {
  /** 后端代理地址，默认 http://localhost:3000 */
  readonly VITE_PROXY_TARGET?: string;
  /** 前端开发端口，默认 5173 */
  readonly VITE_PORT?: string;
  /** 需要独立部署前端时的后端绝对地址，如 https://api.example.com */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
