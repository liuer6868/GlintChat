/**
 * 配置解析：环境变量 / 显式选项 → 规范化配置
 * ---------------------------------------------------------------------------
 * 可嵌入设计要点（很重要）：
 * 旧实现在**模块顶层**执行 `import 'dotenv/config'` + `safeParse(process.env)`，失败直接
 * `throw`。这意味着别人只要 `import` 一下本模块，就会：
 *   1) 在宿主进程里偷偷加载 .env（副作用）；
 *   2) 因为宿主缺 PORT / 平台给的 PORT 形态不同而**在冷启动时崩溃**。
 * 现在改为「零副作用 + 工厂函数 + 显式传参」：
 *   - `createChatConfig(input)`：纯函数，从传入的 options/环境变量对象构造配置；
 *   - `.env` 的加载只发生在应用程序外壳（server/src/index.ts）或 CLI 里；
 *   - 库使用者也可以完全不看环境变量，直接传 `{ apiKey, baseUrl, models }`。
 */
import { z } from 'zod';

/** 内置模型定义 */
export interface ModelDefinition {
  id: string;
  name: string;
  /** 简短说明，前端下拉框与鉴权提示都会用到 */
  description: string;
  /** 服务商标签，仅用于展示 */
  provider: string;
  /** 是否为思维链（reasoning）模型，前端据此显示「思考过程」面板 */
  reasoning: boolean;
  /** 读取 baseURL 的环境变量名，缺省使用全局 OPENAI_BASE_URL */
  baseUrlEnv?: string;
  /** 读取 API Key 的环境变量名，缺省使用全局 OPENAI_API_KEY */
  apiKeyEnv?: string;
}

export const BUILTIN_MODELS: ModelDefinition[] = [
  {
    id: 'deepseek-chat',
    name: 'DeepSeek-V3 (通用)',
    description: '通用对话与写作，速度快、成本低',
    provider: 'DeepSeek',
    reasoning: false,
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek-R1 (深度思考)',
    description: '先输出思维链再给答案，适合推理与数学',
    provider: 'DeepSeek',
    reasoning: true,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: 'OpenAI 轻量多模态模型，需配置 OPENAI 端点',
    provider: 'OpenAI',
    reasoning: false,
    baseUrlEnv: 'MODEL_GPT_4O_MINI_BASE_URL',
    apiKeyEnv: 'MODEL_GPT_4O_MINI_API_KEY',
  },
];

/** 默认占位 Key：出现它即视为「还没配置」 */
const PLACEHOLDER_KEY_PREFIX = 'sk-your-api-key';

/**
 * 去掉值两端可能残留的引号。
 * dotenv 不会剥离引号（`KEY="value"` 会原样解析成 `"value"`），
 * 若 OPENAI_BASE_URL 带引号会拼出 `"https://host/v1"/chat/completions` 这种坏 URL。
 */
export function stripQuotes(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

/** 去掉结尾斜杠，便于拼接 /chat/completions */
export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/** 环境变量（或显式选项）的校验规则 */
export const chatConfigSchema = z.object({
  // 注意：允许 0（部分 Serverless / 容器平台会给 PORT=0 表示随机端口），
  // 因此不能用 .positive()，否则宿主冷启动会直接崩。
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  OPENAI_API_KEY: z.string().transform(stripQuotes).default(''),
  OPENAI_BASE_URL: z
    .string()
    .transform(stripQuotes)
    .default('https://api.deepseek.com/v1'),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(0).default(120_000),
  SSE_HEARTBEAT_MS: z.coerce.number().int().min(0).default(15_000),
  CORS_ORIGINS: z.string().transform(stripQuotes).default(''),
  MODELS_JSON: z.string().transform(stripQuotes).default(''),
});

export type RawConfigInput = Partial<Record<keyof z.infer<typeof chatConfigSchema>, unknown>>;

export interface ChatConfig {
  port: number;
  nodeEnv: 'development' | 'production' | 'test';
  apiKey: string;
  baseUrl: string;
  upstreamTimeoutMs: number;
  sseHeartbeatMs: number;
  corsOrigins: string[];
  models: ModelDefinition[];
}

const modelOverrideSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().trim().default(''),
  provider: z.string().trim().default('Custom'),
  reasoning: z.boolean().default(false),
  baseUrlEnv: z.string().trim().optional(),
  apiKeyEnv: z.string().trim().optional(),
});

/** 解析 MODELS_JSON；不合法时回退到内置清单（不再抛错） */
export function parseModelCatalog(modelsJson: string): ModelDefinition[] {
  const raw = stripQuotes(modelsJson);
  if (!raw) return BUILTIN_MODELS;

  try {
    const parsed: unknown = JSON.parse(raw);
    const result = z.array(modelOverrideSchema).safeParse(parsed);
    if (!result.success || result.data.length === 0) {
      console.warn('[config] MODELS_JSON 格式不合法，已回退到内置模型清单');
      return BUILTIN_MODELS;
    }
    return result.data;
  } catch (error) {
    console.warn('[config] MODELS_JSON 解析失败，已回退到内置模型清单：', (error as Error).message);
    return BUILTIN_MODELS;
  }
}

/**
 * 由传入的原始配置（通常是 process.env 的子集）构造规范化配置。
 * 纯函数、无副作用、不读全局变量。
 */
export function createChatConfig(input: RawConfigInput = {}): ChatConfig {
  const parsed = chatConfigSchema.safeParse(input);

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('；');
    throw new Error(`配置校验失败：${detail}`);
  }

  return {
    port: parsed.data.PORT,
    nodeEnv: parsed.data.NODE_ENV,
    apiKey: parsed.data.OPENAI_API_KEY,
    baseUrl: normalizeBaseUrl(parsed.data.OPENAI_BASE_URL),
    upstreamTimeoutMs: parsed.data.UPSTREAM_TIMEOUT_MS,
    sseHeartbeatMs: parsed.data.SSE_HEARTBEAT_MS,
    corsOrigins: parsed.data.CORS_ORIGINS.split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    models: parseModelCatalog(parsed.data.MODELS_JSON),
  };
}

/** 每个模型解析后的实际请求参数 */
export interface ProviderConfig {
  model: ModelDefinition;
  apiKey: string;
  baseUrl: string;
  chatCompletionsUrl: string;
  configured: boolean;
  reason: string;
}

/**
 * 解析单个模型要用的 baseURL / API Key。
 * `source` 用于读取按模型覆盖的变量（默认 process.env），可显式传入以便测试与嵌入。
 */
export function resolveProvider(
  model: ModelDefinition,
  config: ChatConfig,
  source: Record<string, string | undefined> = process.env,
): ProviderConfig {
  const overrideBaseUrl = model.baseUrlEnv ? stripQuotes(source[model.baseUrlEnv]) : '';
  const overrideApiKey = model.apiKeyEnv ? stripQuotes(source[model.apiKeyEnv]) : '';

  const baseUrl = normalizeBaseUrl(overrideBaseUrl || config.baseUrl);
  const apiKey = overrideApiKey || config.apiKey;

  let configured = true;
  let reason = 'ok';

  if (!baseUrl) {
    configured = false;
    reason = '缺少服务地址：请配置 OPENAI_BASE_URL';
  } else if (!apiKey || apiKey.startsWith(PLACEHOLDER_KEY_PREFIX)) {
    configured = false;
    reason = `缺少 API Key：请配置 ${model.apiKeyEnv ?? 'OPENAI_API_KEY'}（server/.env 或显式选项）`;
  }

  return {
    model,
    apiKey,
    baseUrl,
    chatCompletionsUrl: `${baseUrl}/chat/completions`,
    configured,
    reason,
  };
}

export function describeProviders(
  config: ChatConfig,
  source?: Record<string, string | undefined>,
): ProviderConfig[] {
  return config.models.map((model) => resolveProvider(model, config, source));
}

export function findModel(config: ChatConfig, modelId: string): ModelDefinition | undefined {
  return config.models.find((item) => item.id === modelId);
}

export function publicModels(config: ChatConfig) {
  return config.models.map(({ id, name, description, provider, reasoning }) => ({
    id,
    name,
    description,
    provider,
    reasoning,
  }));
}

/**
 * 显式加载 .env 文件（由应用程序外壳 / CLI 调用，库内部永远不自动加载）。
 * 不覆盖已存在的真实环境变量，与 `node --env-file` 的语义一致。
 */
export async function loadEnvFile(path: string): Promise<{ loaded: string[]; skipped: boolean }> {
  const { existsSync } = await import('node:fs');
  if (!existsSync(path)) return { loaded: [], skipped: true };

  const { config: parse } = await import('dotenv');
  const result = parse({ path, override: false, quiet: true });
  if (result.error) throw result.error;

  const loaded: string[] = [];
  for (const [key, value] of Object.entries(result.parsed ?? {})) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
      loaded.push(key);
    }
  }

  return { loaded, skipped: false };
}
