import type { Response } from 'express';

/**
 * 极简 SSE（Server-Sent Events）写入器。
 * 严格遵循 data: <json>\n\n 的行格式，并附带 Node 专属 header 关闭缓冲。
 */
export class SseStream {
  private closed = false;
  private heartbeat: NodeJS.Timeout | undefined;

  constructor(
    private readonly res: Response,
    heartbeatMs = 0,
  ) {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.flushHeaders?.();

    if (heartbeatMs > 0) {
      this.heartbeat = setInterval(() => {
        // SSE 注释行，仅用于保活，客户端解析时应忽略
        this.comment('ping');
      }, heartbeatMs);
    }
  }

  get isClosed(): boolean {
    return this.closed || this.res.writableEnded;
  }

  /** 已触发 close 事件但尚未 end 时也不能再 write，这里统一兜底 */
  private writeRaw(chunk: string): void {
    if (this.isClosed) return;
    try {
      this.res.write(chunk);
    } catch {
      this.closed = true;
    }
  }

  comment(text: string): void {
    this.writeRaw(`: ${text}\n\n`);
  }

  event(payload: unknown, eventName?: string): void {
    if (eventName) this.writeRaw(`event: ${eventName}\n`);
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.writeRaw(`data: ${data}\n\n`);
  }

  /** data: [DONE] 结束标记 */
  done(): void {
    this.writeRaw('data: [DONE]\n\n');
    this.close();
  }

  close(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }
    if (this.closed) return;
    this.closed = true;
    try {
      this.res.end();
    } catch {
      /* 连接可能已被客户端关闭，忽略 */
    }
  }
}
