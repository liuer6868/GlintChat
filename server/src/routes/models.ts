import { Router } from 'express';
import { describeProviders, publicModels, type ChatConfig } from '../config.js';
import type { PublicModel } from '../types.js';

/**
 * 模型 / 健康检查路由。
 * 以工厂函数形式导出：配置由调用方注入，模块本身不读全局状态，
 * 因此可以安全地被宿主项目 import 并挂到任意路由前缀下。
 */
export function createModelsRouter(config: ChatConfig): Router {
  const router = Router();

  /**
   * GET /models
   * 默认按 `{ code, data }` 信封返回；带 ?envelope=0 时只返回裸数组，方便第三方客户端复用。
   */
  router.get('/models', (req, res) => {
    const providers = describeProviders(config);
    const data: PublicModel[] = publicModels(config);
    const envelope = req.query.envelope !== '0';

    if (!envelope) {
      res.json(data);
      return;
    }

    res.json({
      code: 200,
      message: 'ok',
      data,
      meta: {
        // 只暴露「是否已配置」，不泄露任何密钥片段
        configured: providers.filter((item) => item.configured).map((item) => item.model.id),
        unconfigured: providers
          .filter((item) => !item.configured)
          .map((item) => ({ id: item.model.id, reason: item.reason })),
      },
    });
  });

  /** GET /health：供前端顶部状态灯与本地排查使用 */
  router.get('/health', (_req, res) => {
    const providers = describeProviders(config);
    res.json({
      code: 200,
      data: {
        status: 'ok',
        uptime: Math.round(process.uptime()),
        modelCount: providers.length,
        configuredCount: providers.filter((item) => item.configured).length,
        models: providers.map((item) => ({
          id: item.model.id,
          configured: item.configured,
          reason: item.reason,
        })),
      },
    });
  });

  return router;
}
