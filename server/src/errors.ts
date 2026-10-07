/**
 * 统一的错误模型：把上游（第三方大模型服务）的失败翻译成人类可读的中文提示，
 * 交给路由层以 SSE 错误事件的形式回传给前端，保证进程永不因上游异常崩溃。
 */

export type AppErrorCode =
  | 'BAD_REQUEST'
  | 'MODEL_NOT_FOUND'
  | 'MODEL_NOT_CONFIGURED'
  | 'AUTH_ERROR'
  | 'RATE_LIMITED'
  | 'UPSTREAM_ERROR'
  | 'UPSTREAM_UNREACHABLE'
  | 'UPSTREAM_TIMEOUT'
  | 'STREAM_ABORTED'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly detail?: string;

  constructor(code: AppErrorCode, message: string, status = 500, detail?: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof Error) {
    // 用户主动中断（AbortController）
    if (error.name === 'AbortError') {
      return new AppError('STREAM_ABORTED', '生成已被中断', 499);
    }
    if (error.name === 'TimeoutError') {
      return new AppError('UPSTREAM_TIMEOUT', '上游服务响应超时，请稍后重试', 504, error.message);
    }
    // fetch 网络层失败
    const cause = (error as { cause?: unknown }).cause;
    const causeMessage =
      cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : undefined;
    if (error.message.includes('fetch failed') || causeMessage) {
      return new AppError(
        'UPSTREAM_UNREACHABLE',
        '无法连接到模型服务，请检查网络或 OPENAI_BASE_URL 配置',
        502,
        causeMessage ?? error.message,
      );
    }
    return new AppError('INTERNAL_ERROR', error.message || '服务内部错误', 500);
  }

  return new AppError('INTERNAL_ERROR', '未知错误', 500, String(error));
}

/** 依据上游 HTTP 状态码给出中文提示 */
export function describeUpstreamStatus(status: number, upstreamMessage?: string): AppError {
  const suffix = upstreamMessage ? `：${upstreamMessage}` : '';

  if (status === 401 || status === 403) {
    return new AppError('AUTH_ERROR', `API Key 无效或无权限（HTTP ${status}）${suffix}`, 401);
  }
  if (status === 404) {
    return new AppError(
      'UPSTREAM_ERROR',
      `上游接口不存在（HTTP 404）${suffix}，请确认 OPENAI_BASE_URL 是否正确`,
      404,
    );
  }
  if (status === 429) {
    return new AppError('RATE_LIMITED', `请求过于频繁或额度不足（HTTP 429）${suffix}`, 429);
  }
  if (status >= 500) {
    return new AppError('UPSTREAM_ERROR', `模型服务异常（HTTP ${status}）${suffix}`, 502);
  }
  if (status === 400 || status === 422) {
    return new AppError('BAD_REQUEST', `请求被模型服务拒绝（HTTP ${status}）${suffix}`, 400);
  }
  return new AppError('UPSTREAM_ERROR', `模型服务返回异常状态（HTTP ${status}）${suffix}`, 502);
}

/** 从上游错误响应体中尽力提取可读信息 */
export function extractUpstreamMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string') {
    const text = payload.trim();
    return text.length > 0 ? text.slice(0, 500) : undefined;
  }
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const error = record.error;
    if (typeof error === 'string') return error.slice(0, 500);
    if (error && typeof error === 'object') {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === 'string') return message.slice(0, 500);
    }
    if (typeof record.message === 'string') return record.message.slice(0, 500);
  }
  return undefined;
}
