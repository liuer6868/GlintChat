/**
 * 前后端共享的类型定义与 zod 校验规则。
 */

/** 对外暴露的模型元数据（不含任何密钥信息） */
export interface PublicModel {
  id: string;
  name: string;
  description: string;
  provider: string;
  reasoning: boolean;
}

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequestBody {
  model: string;
  systemPrompt?: string;
  messages: ChatMessage[];
  temperature?: number;
}
