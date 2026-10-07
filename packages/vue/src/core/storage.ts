/**
 * 会话持久化层
 * ---------------------------------------------------------------------------
 * 可嵌入设计要点：
 * 1. 存储 key 带命名空间（默认 `glintchat:sessions`），一个页面挂多个面板互不干扰；
 * 2. 存储介质可替换（localStorage / 内存 / 宿主自己的 store），传 null 即内存态；
 * 3. 读取时做结构校验，脏数据不会导致宿主白屏；流式中的临时状态不落库。
 */
import type { ChatMessage, ChatSession, MessageStatus } from './types';
import { DEFAULT_MODEL_ID, DEFAULT_NAMESPACE, DEFAULT_SYSTEM_PROMPT } from './types';

/** 存储适配器：只需实现这三个方法即可接管持久化 */
export interface GlintChatStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const memoryStore = new Map<string, string>();

/** 内存态存储（persist: false 时使用，SSR / 隐私模式友好） */
export function createMemoryStorage(): GlintChatStorage {
  return {
    getItem: (key) => memoryStore.get(key) ?? null,
    setItem: (key, value) => void memoryStore.set(key, value),
    removeItem: (key) => void memoryStore.delete(key),
  };
}

/** 浏览器 localStorage，不可用时自动降级为内存态 */
export function createLocalStorage(): GlintChatStorage {
  try {
    const storage = globalThis.localStorage;
    if (storage) {
      // 探测是否真的可写（隐私模式下可能抛错）
      const probe = '__glintchat_probe__';
      storage.setItem(probe, '1');
      storage.removeItem(probe);
      return storage;
    }
  } catch {
    /* 落到内存态 */
  }
  return createMemoryStorage();
}

export const SESSIONS_SUFFIX = ':sessions';

export function sessionsKey(namespace = DEFAULT_NAMESPACE): string {
  return `${namespace}${SESSIONS_SUFFIX}`;
}

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

export function loadSessions(storage: GlintChatStorage, namespace?: string): ChatSession[] {
  try {
    const raw = storage.getItem(sessionsKey(namespace));
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
    console.warn('[glintchat] 读取本地会话失败，已忽略：', error);
    return [];
  }
}

/** 落盘（写入前把流式中的临时状态收敛掉） */
export function persistSessionsNow(
  storage: GlintChatStorage,
  sessions: ChatSession[],
  namespace?: string,
): boolean {
  try {
    const payload = sessions.map((session) => ({
      ...session,
      messages: session.messages.map((message) => ({
        ...message,
        status: sanitizeStatus(message.status) ?? message.status,
      })),
    }));
    storage.setItem(sessionsKey(namespace), JSON.stringify(payload));
    return true;
  } catch (error) {
    console.warn('[glintchat] 写入本地会话失败（可能是配额已满）：', error);
    return false;
  }
}

export function removeStoredSessions(storage: GlintChatStorage, namespace?: string): void {
  try {
    storage.removeItem(sessionsKey(namespace));
  } catch (error) {
    console.warn('[glintchat] 清除本地会话失败：', error);
  }
}

/** 粗略估算已用存储体积，用于展示 */
export function estimateStorageSize(storage: GlintChatStorage, namespace?: string): number {
  try {
    const raw = storage.getItem(sessionsKey(namespace)) ?? '';
    return typeof TextEncoder === 'undefined' ? raw.length : new TextEncoder().encode(raw).length;
  } catch {
    return 0;
  }
}
