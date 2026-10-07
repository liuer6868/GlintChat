/**
 * 流式对话客户端
 * ------------------------------------------------------------------
 * 用原生 fetch + ReadableStream 读取服务端 SSE，逐行解析 data: 前缀的 JSON，
 * 通过回调把增量内容实时推给视图层（打字机效果）。
 */
import type { ChatMessage, PublicModel } from '@/types';

export interface StreamCallbacks {
  /** 收到普通增量文本 */
  onContent?: (delta: string, full: string) => void;
  /** 收到思维链增量（DeepSeek-R1 等） */
  onReasoning?: (delta: string, full: string) => void;
  /** 收到业务错误事件 */
  onError?: (message: string, code?: string) => void;
  /** 服务端声明结束 */
  onDone?: (payload?: Record<string, unknown>) => void;
}

export interface StreamStats {
  contentChars: number;
  reasoningChars: number;
}

export interface StreamResult {
  content: string;
  reasoning: string;
  stats: StreamStats;
  /** 是否被用户主动中断 */
  aborted: boolean;
  /** 是否收到服务端 [DONE] */
  completed: boolean;
}

export interface ChatRequestPayload {
  model: string;
  systemPrompt: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}

/** 携带后端业务错误码的异常 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code = 'UNKNOWN', status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/**
 * 运行时配置。
 * ---------------------------------------------------------------------------
 * 可嵌入设计要点：`import.meta.env` 是**编译期**替换的，一旦打进库产物就固化了，
 * 宿主在运行时改配置将完全无效（更糟的是若留下绝对地址，宿主上线后会请求到
 * 用户自己的 localhost）。所以这里改成运行时注入：
 *   - 默认值是相对路径 '/api'，永远不留绝对地址；
 *   - 需要独立部署时通过 `createChatClient({ apiBase: 'https://host/api' })` 或
 *     宿主自己的 transport 覆盖。
 */
export interface ChatClientOptions {
  /** 后端地址前缀（含路由前缀），默认 '/api' */
  apiBase?: string;
  /** 额外请求头，支持函数形式以便动态取 token */
  headers?: Record<string, string> | (() => Record<string, string>);
  /** 自定义 fetch（单测 mock / SSR / 走宿主封装） */
  fetch?: typeof globalThis.fetch;
}

const DEFAULT_API_BASE = (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/+$/, '');

function resolveHeaders(
  headers: ChatClientOptions['headers'],
): Record<string, string> {
  if (!headers) return {};
  return typeof headers === 'function' ? headers() : headers;
}

/** 把历史消息裁剪成后端需要的精简结构 */
function toRequestMessages(messages: ChatMessage[]): { role: string; content: string }[] {
  return messages
    .filter((message) => message.role !== 'system' && message.content.trim().length > 0)
    .map((message) => ({ role: message.role, content: message.content }));
}

export interface ChatClient {
  apiBase: string;
  listModels(signal?: AbortSignal): Promise<PublicModel[]>;
  streamChat(payload: ChatRequestPayload, callbacks?: StreamCallbacks): Promise<StreamResult>;
}

/** 创建聊天客户端实例（可嵌入、可多实例、可注入 fetch） */
export function createChatClient(options: ChatClientOptions = {}): ChatClient {
  const apiBase = (options.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, '');
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  const url = (path: string): string => `${apiBase}${path}`;

  async function listModels(signal?: AbortSignal): Promise<PublicModel[]> {
    const response = await doFetch(url('/models'), {
      method: 'GET',
      headers: { Accept: 'application/json', ...resolveHeaders(options.headers) },
      signal,
    });

    if (!response.ok) {
      throw new ApiError(
        `获取模型列表失败（HTTP ${response.status}）`,
        'MODELS_FAILED',
        response.status,
      );
    }

    const payload = (await response.json()) as { data?: PublicModel[] } | PublicModel[];
    const list = Array.isArray(payload) ? payload : (payload.data ?? []);
    return list.filter((item) => item && typeof item.id === 'string');
  }

  async function streamChat(
    payload: ChatRequestPayload,
    callbacks: StreamCallbacks = {},
  ): Promise<StreamResult> {
    return runStreamChat({ doFetch, url, payload, callbacks });
  }

  return { apiBase, listModels, streamChat };
}

/** 应用外壳默认使用的客户端 */
const defaultClient = createChatClient();

export const fetchModels = (signal?: AbortSignal): Promise<PublicModel[]> =>
  defaultClient.listModels(signal);

export function streamChat(
  payload: ChatRequestPayload,
  callbacks: StreamCallbacks = {},
): Promise<StreamResult> {
  return defaultClient.streamChat(payload, callbacks);
}

/** 流式对话的实际实现：边读边回调，函数返回时代表流已结束 */
async function runStreamChat(input: {
  doFetch: typeof globalThis.fetch;
  url: (path: string) => string;
  payload: ChatRequestPayload;
  callbacks: StreamCallbacks;
}): Promise<StreamResult> {
  const { doFetch, url, payload, callbacks } = input;
  const { model, systemPrompt, messages, signal } = payload;

  const result: StreamResult = {
    content: '',
    reasoning: '',
    stats: { contentChars: 0, reasoningChars: 0 },
    aborted: false,
    completed: false,
  };

  let streamError: ApiError | undefined;

  const emitError = (message: string, code?: string): void => {
    streamError ??= new ApiError(message, code ?? 'STREAM_ERROR', 200);
    callbacks.onError?.(message, code);
  };

  try {
    const response = await doFetch(url('/chat/stream'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model,
        systemPrompt,
        messages: toRequestMessages(messages),
      }),
      signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      let message = `请求失败（HTTP ${response.status}）`;
      let code = 'HTTP_ERROR';
      try {
        const parsed = JSON.parse(detail) as { message?: string; code?: number };
        if (parsed.message) message = parsed.message;
        if (parsed.code) code = String(parsed.code);
      } catch {
        if (detail.trim()) message = `${message}：${detail.slice(0, 200)}`;
      }
      throw new ApiError(message, code, response.status);
    }

    if (!response.body) {
      throw new ApiError('当前浏览器不支持流式响应（response.body 为空）', 'NO_STREAM_BODY');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    /** 处理一行 SSE 原始文本 */
    const handleLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) return; // 心跳/注释
      if (!trimmed.startsWith('data:')) return;

      const data = trimmed.slice(5).trim();
      if (!data) return;

      if (data === '[DONE]') {
        result.completed = true;
        return;
      }

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(data) as Record<string, unknown>;
      } catch {
        return; // 半截数据，忽略
      }

      if (typeof event.error === 'string') {
        emitError(event.error, typeof event.code === 'string' ? event.code : undefined);
        return;
      }

      if (typeof event.reasoning === 'string' && event.reasoning.length > 0) {
        result.reasoning += event.reasoning;
        result.stats.reasoningChars = result.reasoning.length;
        callbacks.onReasoning?.(event.reasoning, result.reasoning);
      }

      if (typeof event.content === 'string' && event.content.length > 0) {
        result.content += event.content;
        result.stats.contentChars = result.content.length;
        callbacks.onContent?.(event.content, result.content);
      }

      if (event.done === true) {
        result.completed = true;
        callbacks.onDone?.(event);
      }
    };

    // 逐块读取字节流并解码
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        handleLine(line);
        newlineIndex = buffer.indexOf('\n');
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) handleLine(buffer);

    if (streamError) {
      // 服务端明确报错：内容保留，但状态标记为错误
      throw streamError;
    }

    return result;
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      result.aborted = true;
      callbacks.onDone?.({ aborted: true });
      return result;
    }
    if (error instanceof ApiError) throw error;

    throw new ApiError(
      error instanceof Error ? `网络异常：${error.message}` : '网络异常，请检查后端服务是否已启动',
      'NETWORK_ERROR',
    );
  }
}
