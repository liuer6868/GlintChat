/**
 * localStorage 持久化层
 * - Key: ai_chat_sessions（PRD 约定）
 * - 读取时做结构校验，避免旧数据/脏数据导致白屏
 * - 写入做防抖 + 配额异常兜底
 */
import type { ChatMessage, ChatSession, MessageStatus } from '@/types';
import { DEFAULT_MODEL_ID, DEFAULT_SYSTEM_PROMPT, STORAGE_KEY } from '@/types';

const VALID_ROLES = new Set(['system', 'user', 'assistant']);
const VALID_STATUS: MessageStatus[] = ['sending', 'streaming', 'success', 'error'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** 流式进行中的消息在刷新后不可能继续，落库时统一收敛为 success */
function sanitizeStatus(status: unknown): MessageStatus | undefined {
  if (typeof status !== 'string') return undefined;
  if (status === 'sending' || status === 'streaming') return 'success';
  return (VALID_STATUS as string[]).includes(status) ? (status as MessageStatus) : undefined;
}

function sanitizeMessage(raw: unknown): ChatMessage | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.content !== 'string') return null;
  if (typeof raw.role !== 'string' || !VALID_ROLES.has(raw.role)) return null;

  const message: ChatMessage = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `${Date.now()}-${Math.random()}`,
    role: raw.role as ChatMessage['role'],
    content: raw.content,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
  };

  const status = sanitizeStatus(raw.status);
  if (status) message.status = status;
  if (typeof raw.reasoningContent === 'string' && raw.reasoningContent) {
    message.reasoningContent = raw.reasoningContent;
  }
  if (typeof raw.errorMessage === 'string' && raw.errorMessage) {
    message.errorMessage = raw.errorMessage;
  }
  if (isRecord(raw.meta)) {
    message.meta = {
      model: typeof raw.meta.model === 'string' ? raw.meta.model : undefined,
      createdAt: typeof raw.meta.createdAt === 'number' ? raw.meta.createdAt : undefined,
      elapsedMs: typeof raw.meta.elapsedMs === 'number' ? raw.meta.elapsedMs : undefined,
      contentChars: typeof raw.meta.contentChars === 'number' ? raw.meta.contentChars : undefined,
      reasoningChars:
        typeof raw.meta.reasoningChars === 'number' ? raw.meta.reasoningChars : undefined,
    };
  }

  return message;
}

function sanitizeSession(raw: unknown): ChatSession | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || !raw.id) return null;

  const messages = Array.isArray(raw.messages)
    ? raw.messages.map(sanitizeMessage).filter((item): item is ChatMessage => item !== null)
    : [];

  return {
    id: raw.id,
    title: typeof raw.title === 'string' && raw.title ? raw.title : '新的对话',
    model: typeof raw.model === 'string' && raw.model ? raw.model : DEFAULT_MODEL_ID,
    systemPrompt:
      typeof raw.systemPrompt === 'string' && raw.systemPrompt
        ? raw.systemPrompt
        : DEFAULT_SYSTEM_PROMPT,
    messages,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  };
}

export function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    const list = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.sessions)
        ? parsed.sessions
        : [];

    return list
      .map(sanitizeSession)
      .filter((item): item is ChatSession => item !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (error) {
    console.warn('[storage] 读取本地会话失败，已忽略：', error);
    return [];
  }
}

let pendingTimer: number | undefined;

/** 真正落盘 */
export function persistSessionsNow(sessions: ChatSession[]): boolean {
  try {
    // 流式中的临时状态不落库
    const payload = sessions.map((session) => ({
      ...session,
      messages: session.messages.map((message) => ({
        ...message,
        status: sanitizeStatus(message.status) ?? message.status,
      })),
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch (error) {
    console.warn('[storage] 写入本地会话失败（可能是配额已满）：', error);
    return false;
  }
}

/** 防抖落盘：流式生成时高频调用也不会卡顿 */
export function persistSessions(sessions: ChatSession[], delay = 250): void {
  if (pendingTimer !== undefined) window.clearTimeout(pendingTimer);
  pendingTimer = window.setTimeout(() => {
    pendingTimer = undefined;
    persistSessionsNow(sessions);
  }, delay);
}

/** 关闭页面前立即冲刷，避免丢失最后一段增量 */
export function flushPendingPersist(sessions: ChatSession[]): void {
  if (pendingTimer !== undefined) {
    window.clearTimeout(pendingTimer);
    pendingTimer = undefined;
  }
  persistSessionsNow(sessions);
}

export function removeStoredSessions(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('[storage] 清除本地会话失败：', error);
  }
}

/** 粗略估算已用存储体积，用于侧边栏提示 */
export function estimateStorageSize(): number {
  try {
    return new Blob([localStorage.getItem(STORAGE_KEY) ?? '']).size;
  } catch {
    return 0;
  }
}
