/**
 * GlintChat 应用程序外壳（entry）
 * ------------------------------------------------------------------
 * 职责：加载 .env → 构造配置 → 装配中间件与路由 → 托管前端产物 → 监听端口。
 * 这些都是「应用」的事情；可复用的核心逻辑都在 ./config 与 ./routes/* 里，
 * 它们以工厂函数形式导出、不读全局状态，方便被其它项目直接引用。
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import {
  createChatConfig,
  loadEnvFile,
  describeProviders,
  type ChatConfig,
} from './config.js';
import { createCorsOptions } from './middleware/cors.js';
import { createChatRouter } from './routes/chat.js';
import { createModelsRouter } from './routes/models.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 先加载 server/.env（不覆盖已有环境变量），再构造配置 */
async function bootstrapConfig(): Promise<ChatConfig> {
  const candidates = [
    resolve(__dirname, '..', '.env'),
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), 'server', '.env'),
  ];

  for (const file of candidates) {
    const result = await loadEnvFile(file);
    if (!result.skipped) {
      console.log(`[server] 已加载环境变量文件：${file}`);
      break;
    }
  }

  return createChatConfig(process.env);
}

/** 组装 Express 应用（可被测试或其它宿主复用） */
export function createApp(config: ChatConfig): express.Express {
  const app = express();

  app.disable('x-powered-by');
  const corsOptions = createCorsOptions(config.corsOrigins);
  app.use(cors(corsOptions));
  app.options(/.*/, cors(corsOptions));
  // 限制请求体大小：一次对话最多 1MB 文本
  app.use(express.json({ limit: '1mb' }));

  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      if (req.path.startsWith('/api')) {
        console.log(
          `${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - startedAt}ms)`,
        );
      }
    });
    next();
  });

  app.use('/api', createModelsRouter(config));
  app.use('/api', createChatRouter(config));

  app.get('/', (req, res) => {
    const hasBuiltClient = existsSync(join(__dirname, '..', '..', 'client', 'dist', 'index.html'));
    if (hasBuiltClient) {
      res.redirect('/index.html');
      return;
    }
    res.type('text/plain; charset=utf-8').send(
      [
        'GlintChat server is running.',
        '',
        `GET  http://localhost:${config.port}/api/models`,
        `POST http://localhost:${config.port}/api/chat/stream`,
        '',
        '前端开发服务器：cd client && pnpm dev  (http://localhost:5173)',
      ].join('\n'),
    );
  });

  // 生产模式：托管前端构建产物（client/dist）
  const clientDist = resolve(__dirname, '..', '..', 'client', 'dist');
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false }));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(join(clientDist, 'index.html'));
    });
    console.log(`[server] 已托管前端静态资源：${clientDist}`);
  }

  // 404（仅 API）
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ code: 404, message: '接口不存在', data: null });
  });

  // 全局错误处理：任何异常都转成结构化 JSON，绝不返回 HTML 堆栈
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const err = error as { type?: string; status?: number; message?: string };
    const status = typeof err?.status === 'number' ? err.status : undefined;

    if (err?.type === 'entity.too.large') {
      res.status(413).json({ code: 413, message: '请求体过大（上限 1MB）', data: null });
      return;
    }
    if (error instanceof SyntaxError && status === 400) {
      res.status(400).json({ code: 400, message: 'JSON 解析失败，请检查请求体格式', data: null });
      return;
    }

    console.error('[server] 未捕获异常：', error);
    res.status(status ?? 500).json({
      code: status ?? 500,
      message: err?.message ?? '服务器内部错误',
      data: null,
    });
  });

  return app;
}

/* ------------------------------ 进程入口 ------------------------------ */

process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandledRejection：', reason);
});
process.on('uncaughtException', (error) => {
  console.error('[server] uncaughtException：', error);
});

const config = await bootstrapConfig();
const app = createApp(config);

const server = app.listen(config.port, () => {
  const providers = describeProviders(config);
  console.log('');
  console.log('  GlintChat server 已启动');
  console.log(`  ➜ 本地地址: http://localhost:${config.port}`);
  console.log(`  ➜ 接口:     GET /api/models   POST /api/chat/stream`);
  console.log(`  ➜ 模型:     ${providers.map((p) => p.model.id).join(', ')}`);
  const missing = providers.filter((p) => !p.configured);
  if (missing.length > 0) {
    console.log('  ⚠ 尚未配置密钥的模型：');
    for (const item of missing) console.log(`      - ${item.model.id}: ${item.reason}`);
    console.log('      → 复制 server/.env.example 为 server/.env 并填入 OPENAI_API_KEY');
  }
  console.log('');
});

function shutdown(signal: string): void {
  console.log(`\n[server] 收到 ${signal}，正在关闭…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
