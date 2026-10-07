import type { CorsOptions } from 'cors';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * CORS 配置工厂。
 * 可嵌入设计要点：不在模块顶层读 `process.env.CORS_ORIGINS`——
 * 白名单由调用方显式传入，库被宿主 import 时不会产生副作用。
 *
 * @param allowList 额外放行的来源（通常来自配置）
 * @param allowLocal 是否放行 localhost / 127.0.0.1 任意端口（本地开发默认 true）
 */
export function createCorsOptions(allowList: string[] = [], allowLocal = true): CorsOptions {
  const allowed = new Set(allowList);

  return {
    origin(origin, callback) {
      // 无 Origin：同源请求、curl、Postman 等
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowed.has(origin)) {
        callback(null, true);
        return;
      }

      if (allowLocal) {
        try {
          const { hostname } = new URL(origin);
          if (LOCAL_HOSTNAMES.has(hostname)) {
            callback(null, true);
            return;
          }
        } catch {
          /* 非法 Origin，走下面的拒绝分支 */
        }
      }

      callback(new Error(`CORS 拒绝：来源 ${origin} 不在允许列表中`));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'Authorization'],
    credentials: false,
    maxAge: 86_400,
  };
}
