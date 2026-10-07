/**
 * SSE 增量解析器与聊天客户端
 * ---------------------------------------------------------------------------
 * 设计要点（可嵌入）：
 * 1. **运行时可配置**：`apiBase` 由调用方注入，默认 `/api`（相对路径）。
 *    绝不读 `import.meta.env` —— 那是编译期替换的，打进库产物后宿主改不了，
 *    而且一旦留下绝对地址，宿主上线后会请求到用户自己的 localhost。
 * 2. 解析逻辑与 fetch 解耦，便于单测（`createSseParser` 可单独使用）。
 * 3. 真正的结束条件是「流读到 EOF」或服务端 `[DONE]`；网络异常与业务错误分开处理。
 */
import type { ChatMessage, PublicModel } from './types';

export interface StreamCallbacks {
  /** 收到普通增量文本 */
  onContent?: (delta: string, full: string) => void;
  /** 收到思维链增量（推理模型） */
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
  /** 是否收到服务端 [DONE] 或 done 事件 */
  completed: boolean;
}

export interface ChatRequestPayload {
  model: string;
  systemPrompt: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
  temperature?: number;
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

export interface ChatClientOptions {
  /** 后端地址前缀（含路由前缀），默认 '/api' */
  apiBase?: string;
  /** 额外请求头，支持函数形式以便动态取 token */
  headers?: Record<string, string> | (() => Record<string, string>);
  /** 自定义 fetch（单测 mock / SSR / 走宿主封装） */
  fetch?: typeof globalThis.fetch;
}

export interface ChatClient {
  apiBase: string;
  health(signal?: AbortSignal): Promise<unknown>;
  listModels(signal?: AbortSignal): Promise<PublicModel[]>;
  streamChat(payload: ChatRequestPayload, callbacks?: StreamCallbacks): Promise<StreamResult>;
}

const DEFAULT_API_BASE = '/api';

function resolveHeaders(headers: ChatClientOptions['headers']): Record<string, string> {
  if (!headers) return {};
  return typeof headers === 'function' ? headers() : headers;
}

/** 把历史消息裁剪成后端需要的精简结构 */
function toRequestMessages(messages: ChatMessage[]): { role: string; content: string }[] {
  return messages
    .filter((message) => message.role !== 'system' && message.content.trim().length > 0)
    .map((message) => ({ role: message.role, content: message.content }));
}

/** 单条 SSE 事件的服务端负载形状 */
export interface SseEventPayload {
  content?: string;
  reasoning?: string;
  error?: string;
  code?: string;
  done?: boolean;
  finishReason?: string | null;
  usage?: unknown;
  meta?: { contentChars?: number; reasoningChars?: number; model?: string } & Record<string, unknown>;
}

/**
 * 创建一个「逐行喂入、逐事件回调」的 SSE 解析器。
 * 处理心跳注释行、[DONE]、半截数据等边界情况。
 */
export function createSseParser(handlers: {
  onEvent: (payload: SseEventPayload) => void;
  onDoneMarker?: () => void;
}) {
  let buffer = '';

  const handleLine = (rawLine: string): void => {
    const line = rawLine.trim();
    if (!line || line.startsWith(':')) return; // 心跳/注释
    if (!line.startsWith('data:')) return;

    const data = line.slice(5).trim();
    if (!data) return;

    if (data === '[DONE]') {
      handlers.onDoneMarker?.();
      return;
    }

    try {
      handlers.onEvent(JSON.parse(data) as SseEventPayload);
    } catch {
      /* 半截或非 JSON 行，忽略 */
    }
  };

  return {
    /** 喂入一段解码后的文本，返回本次识别出的事件数 */
    push(chunk: string): number {
      buffer += chunk;
      let count = 0;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        handleLine(line);
        count += 1;
        newline = buffer.indexOf('\n');
      }
      return count;
    },
    /** 流结束时冲刷残留缓冲 */
    flush(): void {
      if (buffer.trim()) handleLine(buffer);
      buffer = '';
    },
  };
}

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

  async function health(signal?: AbortSignal): Promise<unknown> {
    const response = await doFetch(url('/health'), {
      method: 'GET',
      headers: { Accept: 'application/json', ...resolveHeaders(options.headers) },
      signal,
    });
    if (!response.ok) throw new ApiError(`健康检查失败（HTTP ${response.status}）`, 'HEALTH_FAILED', response.status);
    return response.json();
  }

  async function streamChat(
    payload: ChatRequestPayload,
    callbacks: StreamCallbacks = {},
  ): Promise<StreamResult> {
    const { model, systemPrompt, messages, signal, temperature } = payload;

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
          ...resolveHeaders(options.headers),
        },
        body: JSON.stringify({
          model,
          systemPrompt,
          messages: toRequestMessages(messages),
          ...(typeof temperature === 'number' ? { temperature } : {}),
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

      const parser = createSseParser({
        onDoneMarker: () => {
          result.completed = true;
        },
        onEvent: (event) => {
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
            callbacks.onDone?.(event as Record<string, unknown>);
          }
        },
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }

      parser.push(decoder.decode());
      parser.flush();

      if (streamError) throw streamError;
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

  return { apiBase, health, listModels, streamChat };
}
