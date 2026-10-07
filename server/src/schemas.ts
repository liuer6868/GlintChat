import { z } from 'zod';

/**
 * 请求校验：与 PRD 中的请求体约定保持一致。
 * 说明：systemPrompt 既可由前端单独传，也兼容 messages 里出现 system 角色。
 */
export const chatRequestSchema = z.object({
  model: z.string().trim().min(1, 'model 不能为空'),
  systemPrompt: z.string().max(8000, 'systemPrompt 过长').optional(),
  temperature: z.number().min(0).max(2).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string(),
      }),
    )
    .min(1, 'messages 至少需要一条消息')
    .max(200, 'messages 数量过多'),
});

export type ChatRequestInput = z.infer<typeof chatRequestSchema>;

/** SSE 事件负载，均为 JSON 字符串，行格式：data: {...} */
export type StreamEvent =
  | { content: string }
  | { reasoning: string }
  | { error: string; code?: string }
  | { done: true; finishReason?: string | null; usage?: unknown };
