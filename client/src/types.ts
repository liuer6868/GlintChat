/** 全局类型定义（与后端 server/src/types.ts 保持一致） */

export type ChatRole = 'system' | 'user' | 'assistant';

/** 仅 assistant 实时消息会经历的状态流转 */
export type MessageStatus = 'sending' | 'streaming' | 'success' | 'error';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** 只对 assistant 消息有意义 */
  status?: MessageStatus;
  /** 思维链内容（DeepSeek-R1 等推理模型） */
  reasoningContent?: string;
  /** 失败时的错误说明 */
  errorMessage?: string;
  /** 采样/耗时等元信息，仅用于展示 */
  meta?: {
    model?: string;
    createdAt?: number;
    elapsedMs?: number;
    contentChars?: number;
    reasoningChars?: number;
  };
  createdAt: number;
}

export interface ChatSession {
  id: string;
  title: string;
  /** 该会话使用的模型 */
  model: string;
  /** 该会话的系统角色设定 */
  systemPrompt: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface PublicModel {
  id: string;
  name: string;
  description: string;
  provider: string;
  reasoning: boolean;
}

export interface ModelsResponse {
  code: number;
  message?: string;
  data: PublicModel[];
  meta?: {
    configured?: string[];
    unconfigured?: { id: string; reason: string }[];
  };
}

export const DEFAULT_SYSTEM_PROMPT = '你是一个博学、严谨且富有同理心的 AI 助手。';

export const DEFAULT_MODEL_ID = 'deepseek-chat';

/** localStorage 存储键，遵循 PRD 约定 */
export const STORAGE_KEY = 'ai_chat_sessions';
