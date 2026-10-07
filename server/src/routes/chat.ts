import { Router } from 'express';
import {
  findModel,
  resolveProvider,
  type ChatConfig,
  type ModelDefinition,
} from '../config.js';
import { AppError, describeUpstreamStatus, extractUpstreamMessage, toAppError } from '../errors.js';
import { chatRequestSchema } from '../schemas.js';
import type { ChatMessage } from '../types.js';
import { SseStream } from '../utils/sse.js';

const MAX_TOTAL_CHARS = 200_000;

/** 把 PRD 请求体转换成 OpenAI 兼容的 messages 数组 */
export function buildUpstreamMessages(
  systemPrompt: string,
  messages: ChatMessage[],
): ChatMessage[] {
  const result: ChatMessage[] = [];
  const trimmedPrompt = systemPrompt.trim();

  // 前端单独传的 systemPrompt 优先作为第一条 system 消息
  if (trimmedPrompt) result.push({ role: 'system', content: trimmedPrompt });

  for (const message of messages) {
    // 已经作为 systemPrompt 注入过的 system 消息不重复追加
    if (message.role === 'system' && trimmedPrompt) continue;
    const content = message.content ?? '';
    if (content.length === 0 && message.role === 'assistant') continue;
    result.push({ role: message.role, content });
  }

  if (!result.some((item) => item.role === 'user')) {
    throw new AppError('BAD_REQUEST', 'messages 中至少需要一条 user 消息', 400);
  }

  return result;
}

interface ParsedChunk {
  content?: string;
  reasoning?: string;
  finishReason?: string | null;
  usage?: unknown;
}

/** 解析上游单个 SSE data 负载，兼容 OpenAI / DeepSeek 两种 delta 结构 */
export function parseUpstreamChunk(raw: string): ParsedChunk | null {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;

  const record = payload as Record<string, any>;
  if (record.error) {
    const message = extractUpstreamMessage(record) ?? '上游返回未知错误';
    throw new AppError('UPSTREAM_ERROR', `模型服务返回错误：${message}`, 502);
  }

  const choice = Array.isArray(record.choices) ? record.choices[0] : undefined;
  if (!choice) return null;

  const delta = (choice.delta ?? choice.message ?? {}) as Record<string, unknown>;
  const result: ParsedChunk = {};

  const content = typeof delta.content === 'string' ? delta.content : undefined;
  if (content) result.content = content;

  // DeepSeek-R1 等推理模型：reasoning_content / reasoning
  const reasoning =
    typeof delta.reasoning_content === 'string'
      ? delta.reasoning_content
      : typeof delta.reasoning === 'string'
        ? delta.reasoning
        : undefined;
  if (reasoning) result.reasoning = reasoning;

  if (typeof choice.finish_reason === 'string' || choice.finish_reason === null) {
    result.finishReason = choice.finish_reason;
  }
  if (record.usage) result.usage = record.usage;

  return result;
}

/**
 * 核心流式对话路由。
 * 以工厂函数形式导出：配置与可选依赖由调用方注入，模块不读全局状态，
 * 便于宿主项目挂到任意路由前缀、也便于单元测试。
 */
export function createChatRouter(config: ChatConfig): Router {
  const router = Router();

  router.post('/chat/stream', async (req, res) => {
    const sse = new SseStream(res, config.sseHeartbeatMs);
    const abort = new AbortController();
    let clientGone = false;

    const onClientGone = (): void => {
      clientGone = true;
      abort.abort();
    };
    // req 上的 close 在请求体读完后可能立即触发，因此用 res 判定连接是否真正断开
    res.on('close', () => {
      if (!res.writableEnded) onClientGone();
    });
    res.on('error', onClientGone);

    try {
      const parsed = chatRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        throw new AppError(
          'BAD_REQUEST',
          `请求参数不合法：${first ? `${first.path.join('.')} ${first.message}` : '未知字段'}`,
          400,
        );
      }

      const { model: modelId, messages, systemPrompt = '', temperature } = parsed.data;

      const totalChars = messages.reduce((sum, item) => sum + item.content.length, 0);
      if (totalChars > MAX_TOTAL_CHARS) {
        throw new AppError('BAD_REQUEST', '对话上下文过长，请新建会话或清空历史后重试', 413);
      }

      const model: ModelDefinition | undefined = findModel(config, modelId);
      if (!model) {
        throw new AppError(
          'MODEL_NOT_FOUND',
          `不支持的模型「${modelId}」，可选：${config.models.map((item) => item.id).join('、')}`,
          404,
        );
      }

      const provider = resolveProvider(model, config);
      if (!provider.configured) {
        throw new AppError('MODEL_NOT_CONFIGURED', provider.reason, 500);
      }

      const upstreamMessages = buildUpstreamMessages(systemPrompt, messages);

      const timeoutSignal =
        config.upstreamTimeoutMs > 0 ? AbortSignal.timeout(config.upstreamTimeoutMs) : undefined;
      const signal = timeoutSignal ? AbortSignal.any([abort.signal, timeoutSignal]) : abort.signal;

      const upstreamResponse = await fetch(provider.chatCompletionsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({
          model: model.id,
          messages: upstreamMessages,
          stream: true,
          stream_options: { include_usage: true },
          ...(typeof temperature === 'number' ? { temperature } : {}),
        }),
        signal,
      });

      if (!upstreamResponse.ok) {
        const rawBody = await upstreamResponse.text().catch(() => '');
        let parsedBody: unknown = rawBody;
        try {
          parsedBody = JSON.parse(rawBody);
        } catch {
          /* 上游可能返回纯文本错误 */
        }
        throw describeUpstreamStatus(
          upstreamResponse.status,
          extractUpstreamMessage(parsedBody) ?? rawBody.slice(0, 300),
        );
      }

      if (!upstreamResponse.body) {
        throw new AppError('UPSTREAM_ERROR', '模型服务未返回流式响应体', 502);
      }

      const reader = upstreamResponse.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let finishReason: string | null = null;
      let usage: unknown;
      let reasoningChars = 0;
      let contentChars = 0;

      const handleLine = (line: string): void => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) return;

        const payload = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
        if (!payload || payload === '[DONE]') return;

        const chunk = parseUpstreamChunk(payload);
        if (!chunk) return;

        if (chunk.reasoning) {
          reasoningChars += chunk.reasoning.length;
          sse.event({ reasoning: chunk.reasoning });
        }
        if (chunk.content) {
          contentChars += chunk.content.length;
          sse.event({ content: chunk.content });
        }
        if (chunk.finishReason !== undefined) finishReason = chunk.finishReason;
        if (chunk.usage !== undefined) usage = chunk.usage;
      };

      while (!clientGone) {
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

      if (buffer.trim()) handleLine(buffer);

      if (contentChars === 0 && reasoningChars === 0) {
        sse.event({
          error: '模型没有返回任何内容，请检查模型名称或稍后重试',
          code: 'UPSTREAM_ERROR',
        });
        sse.done();
        return;
      }

      if (finishReason === 'length') {
        sse.event({ content: '\n\n> ⚠️ 输出已达模型最大长度限制，内容可能被截断。' });
      }

      sse.event({
        done: true,
        finishReason,
        ...(usage ? { usage } : {}),
        meta: { reasoningChars, contentChars, model: model.id },
      });
      sse.done();
      console.log(
        `[chat] model=${model.id} content=${contentChars}chars reasoning=${reasoningChars}chars finish=${finishReason ?? 'n/a'}`,
      );
    } catch (error) {
      const appError = toAppError(error);

      if (appError.code === 'STREAM_ABORTED') {
        // 用户点击「停止生成」：直接收尾，不算异常
        if (!sse.isClosed) sse.done();
        console.log('[chat] 客户端中断了生成');
        return;
      }

      console.error(
        `[chat] 失败 code=${appError.code} status=${appError.status}: ${appError.message}`,
      );
      if (appError.detail) console.error(`[chat] 详情: ${appError.detail}`);

      if (!sse.isClosed) {
        sse.event({ error: appError.message, code: appError.code });
        sse.done();
      }
    } finally {
      res.off('error', onClientGone);
      sse.close();
    }
  });

  return router;
}
