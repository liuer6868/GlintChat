/**
 * 会话状态中枢（组合式 API）
 * - 所有会话与消息都存在 localStorage（无数据库）
 * - 每 250ms 防抖落盘，页面隐藏/卸载时立即冲刷
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import type { ChatMessage, ChatSession, MessageStatus, PublicModel } from '@/types';
import { DEFAULT_MODEL_ID, DEFAULT_SYSTEM_PROMPT, STORAGE_KEY } from '@/types';
import {
  estimateStorageSize,
  flushPendingPersist,
  loadSessions,
  persistSessions,
  persistSessionsNow,
  removeStoredSessions,
} from '@/utils/storage';
import { uuid } from '@/utils/uuid';

export function createSession(model = DEFAULT_MODEL_ID, systemPrompt = DEFAULT_SYSTEM_PROMPT): ChatSession {
  const now = Date.now();
  return {
    id: uuid(),
    title: '新的对话',
    model,
    systemPrompt,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** 标题取第一条用户消息前 15 字 */
export function buildTitle(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '新的对话';
  return normalized.length > 15 ? `${normalized.slice(0, 15)}…` : normalized;
}

export function useSessions() {
  const sessions = reactive<ChatSession[]>(loadSessions());
  const activeId = ref<string>(sessions[0]?.id ?? '');
  const lastError = ref<string>('');
  const storageWarning = ref<string>('');

  if (sessions.length === 0) {
    const first = createSession();
    sessions.push(first);
    activeId.value = first.id;
  }

  const activeSession = computed<ChatSession | undefined>(() =>
    sessions.find((session) => session.id === activeId.value),
  );

  const messages = computed<ChatMessage[]>(() => activeSession.value?.messages ?? []);

  const activeModel = computed<string>(() => activeSession.value?.model ?? DEFAULT_MODEL_ID);

  const activeSystemPrompt = computed<string>(
    () => activeSession.value?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
  );

  const sortedSessions = computed(() =>
    [...sessions].sort((a, b) => b.updatedAt - a.updatedAt),
  );

  const totalMessages = computed(() =>
    sessions.reduce((sum, session) => sum + session.messages.length, 0),
  );

  const storageSize = ref(0);

  function refreshStorageSize(): void {
    storageSize.value = estimateStorageSize();
  }

  function touch(session: ChatSession): void {
    session.updatedAt = Date.now();
  }

  function persist(delay?: number): void {
    persistSessions(sessions, delay);
    refreshStorageSize();
  }

  /** 立即落盘，并检查浏览器配额（配额已满时提示用户导出备份） */
  function persistAndCheckQuota(): void {
    const ok = persistSessionsNow(sessions);
    storageWarning.value = ok ? '' : '本地存储写入失败：浏览器配额可能已满，建议导出历史后清空';
    refreshStorageSize();
  }
  function newSession(model = activeModel.value, systemPrompt = activeSystemPrompt.value): ChatSession {
    const session = createSession(model, systemPrompt);
    sessions.unshift(session);
    activeId.value = session.id;
    persist(0);
    return session;
  }

  function selectSession(id: string): void {
    if (sessions.some((session) => session.id === id)) {
      activeId.value = id;
    }
  }

  function deleteSession(id: string): void {
    const index = sessions.findIndex((session) => session.id === id);
    if (index === -1) return;

    sessions.splice(index, 1);

    if (sessions.length === 0) {
      const session = createSession();
      sessions.push(session);
      activeId.value = session.id;
    } else if (activeId.value === id) {
      const fallback = sortedSessions.value[0];
      if (fallback) activeId.value = fallback.id;
    }

    persist(0);
  }

  /** 清空所有历史（调用方需二次确认） */
  function clearAll(): void {
    sessions.splice(0, sessions.length);
    removeStoredSessions();
    const session = createSession();
    sessions.push(session);
    activeId.value = session.id;
    persist(0);
  }

  /** 创建一条用户消息；若是首条消息则据此生成标题 */
  function addUserMessage(session: ChatSession, content: string): ChatMessage {
    const isFirst = session.messages.every((message) => message.role !== 'user');
    const message: ChatMessage = {
      id: uuid(),
      role: 'user',
      content,
      status: 'success',
      createdAt: Date.now(),
    };
    session.messages.push(message);
    if (isFirst) session.title = buildTitle(content);
    touch(session);
    persist();
    return message;
  }

  function addAssistantPlaceholder(session: ChatSession, model: string): ChatMessage {
    const message: ChatMessage = {
      id: uuid(),
      role: 'assistant',
      content: '',
      reasoningContent: '',
      status: 'sending',
      createdAt: Date.now(),
      meta: { model, createdAt: Date.now() },
    };
    session.messages.push(message);
    touch(session);
    persist();
    return message;
  }

  function setMessageStatus(session: ChatSession, message: ChatMessage, status: MessageStatus): void {
    message.status = status;
    touch(session);
    persist();
  }

  function updateSessionModel(model: string): void {
    const session = activeSession.value;
    if (!session) return;
    session.model = model;
    touch(session);
    persist(0);
  }

  function updateSystemPrompt(prompt: string): void {
    const session = activeSession.value;
    if (!session) return;
    session.systemPrompt = prompt;
    touch(session);
    persist(0);
  }

  function renameSession(id: string, title: string): void {
    const session = sessions.find((item) => item.id === id);
    if (!session) return;
    session.title = buildTitle(title);
    touch(session);
    persist(0);
  }

  function exportSessions(): string {
    return JSON.stringify({ version: 1, exportedAt: Date.now(), sessions }, null, 2);
  }

  function importSessions(json: string): number {
    try {
      const parsed = JSON.parse(json) as { sessions?: unknown } | unknown[];
      const list = Array.isArray(parsed) ? parsed : (parsed.sessions ?? []);
      if (!Array.isArray(list)) return 0;

      let imported = 0;
      for (const item of list) {
        const session = item as Partial<ChatSession>;
        if (!session || typeof session.id !== 'string') continue;
        if (sessions.some((existing) => existing.id === session.id)) continue;
        sessions.push({
          id: session.id,
          title: session.title ?? '导入的对话',
          model: session.model ?? DEFAULT_MODEL_ID,
          systemPrompt: session.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
          messages: Array.isArray(session.messages) ? (session.messages as ChatMessage[]) : [],
          createdAt: session.createdAt ?? Date.now(),
          updatedAt: session.updatedAt ?? Date.now(),
        });
        imported += 1;
      }
      if (imported > 0) persist(0);
      return imported;
    } catch {
      return 0;
    }
  }

  // 多标签页同步：其它标签页写入 localStorage 时同步状态
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== STORAGE_KEY) return;
    const latest = loadSessions();
    sessions.splice(0, sessions.length, ...latest);
    if (!sessions.some((session) => session.id === activeId.value)) {
      activeId.value = sessions[0]?.id ?? '';
    }
  };

  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      flushPendingPersist(sessions);
    }
  };

  onMounted(() => {
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', () => flushPendingPersist(sessions));
    refreshStorageSize();
  });

  onBeforeUnmount(() => {
    window.removeEventListener('storage', onStorage);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    flushPendingPersist(sessions);
  });

  // 首次进入时把初始状态落盘，保证刷新后仍在
  watch(
    () => sessions.length,
    () => refreshStorageSize(),
  );

  return {
    // state
    sessions,
    sortedSessions,
    activeId,
    activeSession,
    activeModel,
    activeSystemPrompt,
    messages,
    totalMessages,
    storageSize,
    lastError,
    storageWarning,
    // actions
    newSession,
    selectSession,
    deleteSession,
    clearAll,
    addUserMessage,
    addAssistantPlaceholder,
    setMessageStatus,
    updateSessionModel,
    updateSystemPrompt,
    renameSession,
    importSessions,
    exportSessions,
    persist,
    persistAndCheckQuota,
    refreshStorageSize,
  };
}

export type SessionsStore = ReturnType<typeof useSessions>;

/** 供模型列表使用的小工具：把 PublicModel 映射成下拉框选项 */
export function modelOptions(models: PublicModel[]): { value: string; label: string }[] {
  return models.map((model) => ({ value: model.id, label: model.name }));
}
