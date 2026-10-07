/**
 * 对话控制器：会话管理 + 流式编排（可嵌入面板的唯一状态中枢）
 * ---------------------------------------------------------------------------
 * 与旧实现（挂在应用外壳 App.vue 里）的区别：
 * - 所有依赖（storage / namespace / client / 默认值）都由外部注入，不读全局；
 * - 不依赖 `import.meta.env`，不依赖全局快捷键、viewport 判断等外壳逻辑；
 * - 支持多实例：每个控制器有独立的 namespace 与确认服务。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { ApiError, type ChatClient } from '../core/stream.ts';
import {
  estimateStorageSize,
  loadSessions,
  persistSessionsNow,
  removeStoredSessions,
  type GlintChatStorage,
} from '../core/storage.ts';
import {
  DEFAULT_MODEL_ID,
  DEFAULT_SYSTEM_PROMPT,
  type ChatMessage,
  type ChatSession,
  type PublicModel,
} from '../core/types.ts';
import { uuid } from '../core/uuid.ts';

export interface ChatControllerOptions {
  storage: GlintChatStorage;
  namespace: string;
  client: ChatClient;
  defaultModel?: string;
  defaultSystemPrompt?: string;
  /** 是否把会话同步到 localStorage（false 时只保存在内存） */
  persist?: boolean;
  /** 外部提供的模型列表；为空时控制器会自行拉取 */
  models?: PublicModel[];
  onError?: (message: string, code?: string) => void;
  onMessageComplete?: (message: ChatMessage) => void;
  onSessionChange?: (session: ChatSession | undefined) => void;
}

/** 标题取第一条用户消息前 15 字 */
export function buildTitle(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '新的对话';
  return normalized.length > 15 ? `${normalized.slice(0, 15)}…` : normalized;
}

export function createSession(
  model = DEFAULT_MODEL_ID,
  systemPrompt = DEFAULT_SYSTEM_PROMPT,
): ChatSession {
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

export function createChatController(options: ChatControllerOptions) {
  const persistEnabled = options.persist ?? true;
  const defaultModel = options.defaultModel ?? DEFAULT_MODEL_ID;
  const defaultSystemPrompt = options.defaultSystemPrompt ?? DEFAULT_SYSTEM_PROMPT;

  const sessions = reactive<ChatSession[]>(
    persistEnabled ? loadSessions(options.storage, options.namespace) : [],
  );
  const activeId = ref<string>(sessions[0]?.id ?? '');
  const models = ref<PublicModel[]>(options.models ? [...options.models] : []);
  const modelsError = ref('');
  const streamingSessionId = ref('');
  const storageWarning = ref('');

  if (sessions.length === 0) {
    const first = createSession(defaultModel, defaultSystemPrompt);
    sessions.push(first);
    activeId.value = first.id;
  }

  let abortController: AbortController | null = null;

  const isStreaming = computed(() => streamingSessionId.value !== '');
  const activeSession = computed(() => sessions.find((item) => item.id === activeId.value));
  const messages = computed<ChatMessage[]>(() => activeSession.value?.messages ?? []);
  const activeModel = computed(() => activeSession.value?.model ?? defaultModel);
  const activeSystemPrompt = computed(
    () => activeSession.value?.systemPrompt ?? defaultSystemPrompt,
  );
  const sortedSessions = computed(() => [...sessions].sort((a, b) => b.updatedAt - a.updatedAt));
  const totalMessages = computed(() =>
    sessions.reduce((sum, session) => sum + session.messages.length, 0),
  );
  const storageSize = ref(0);

  function refreshStorageSize(): void {
    storageSize.value = estimateStorageSize(options.storage, options.namespace);
  }

  function flush(): void {
    if (!persistEnabled) return;
    const ok = persistSessionsNow(options.storage, sessions, options.namespace);
    storageWarning.value = ok ? '' : '本地存储写入失败：浏览器配额可能已满，建议导出历史后清空';
  }

  function touch(session: ChatSession): void {
    session.updatedAt = Date.now();
  }

  /* -------------------------------- 会话操作 -------------------------------- */

  function newSession(model = activeModel.value, systemPrompt = activeSystemPrompt.value): ChatSession {
    const session = createSession(model, systemPrompt);
    sessions.unshift(session);
    activeId.value = session.id;
    flush();
    options.onSessionChange?.(session);
    return session;
  }

  function selectSession(id: string): void {
    if (!sessions.some((session) => session.id === id)) return;
    activeId.value = id;
    options.onSessionChange?.(activeSession.value);
  }

  function deleteSession(id: string): void {
    const index = sessions.findIndex((session) => session.id === id);
    if (index === -1) return;

    sessions.splice(index, 1);

    if (sessions.length === 0) {
      const session = createSession(defaultModel, defaultSystemPrompt);
      sessions.push(session);
      activeId.value = session.id;
    } else if (activeId.value === id) {
      activeId.value = sortedSessions.value[0]?.id ?? '';
    }

    flush();
    options.onSessionChange?.(activeSession.value);
  }

  /** 清空所有历史（调用方需二次确认） */
  function clearAll(): void {
    sessions.splice(0, sessions.length);
    if (persistEnabled) removeStoredSessions(options.storage, options.namespace);
    const session = createSession(defaultModel, defaultSystemPrompt);
    sessions.push(session);
    activeId.value = session.id;
    flush();
    options.onSessionChange?.(session);
  }

  function renameSession(id: string, title: string): void {
    const session = sessions.find((item) => item.id === id);
    if (!session) return;
    session.title = buildTitle(title);
    touch(session);
    flush();
  }

  function updateModel(model: string): void {
    const session = activeSession.value;
    if (!session) return;
    session.model = model;
    touch(session);
    flush();
  }

  function updateSystemPrompt(prompt: string): void {
    const session = activeSession.value;
    if (!session) return;
    session.systemPrompt = prompt;
    touch(session);
    flush();
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
          model: session.model ?? defaultModel,
          systemPrompt: session.systemPrompt ?? defaultSystemPrompt,
          messages: Array.isArray(session.messages) ? (session.messages as ChatMessage[]) : [],
          createdAt: session.createdAt ?? Date.now(),
          updatedAt: session.updatedAt ?? Date.now(),
        });
        imported += 1;
      }
      if (imported > 0) flush();
      return imported;
    } catch {
      return 0;
    }
  }

  /* -------------------------------- 模型列表 -------------------------------- */

  async function loadModels(): Promise<PublicModel[]> {
    if (options.models && options.models.length > 0) {
      models.value = [...options.models];
      return models.value;
    }
    try {
      const list = await options.client.listModels();
      if (list.length > 0) models.value = list;
      modelsError.value = '';
      return models.value;
    } catch (error) {
      modelsError.value = error instanceof Error ? error.message : '获取模型列表失败';
      return models.value;
    }
  }

  /* -------------------------------- 流式对话 -------------------------------- */

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
    flush();
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
    flush();
    return message;
  }

  function stopStreaming(): void {
    abortController?.abort();
    abortController = null;
    streamingSessionId.value = '';
  }

  /** 发送一条消息并流式接收回答 */
  async function sendMessage(text: string): Promise<void> {
    const session = activeSession.value;
    if (!session || isStreaming.value) return;

    streamingSessionId.value = session.id;
    abortController = new AbortController();
    const controller = abortController;
    const startedAt = Date.now();

    addUserMessage(session, text);
    const placeholder = addAssistantPlaceholder(session, session.model);

    try {
      await options.client.streamChat(
        {
          model: session.model,
          systemPrompt: session.systemPrompt,
          messages: session.messages.filter((message) => message.id !== placeholder.id),
          signal: controller.signal,
        },
        {
          onContent: (_delta, full) => {
            placeholder.content = full;
            placeholder.status = 'streaming';
          },
          onReasoning: (_delta, full) => {
            placeholder.reasoningContent = full;
            placeholder.status = 'streaming';
          },
          onError: (message, code) => {
            options.onError?.(message, code);
          },
          onDone: (payload) => {
            const meta = payload?.meta as
              | { contentChars?: number; reasoningChars?: number }
              | undefined;
            placeholder.meta = {
              ...(placeholder.meta ?? {}),
              elapsedMs: Date.now() - startedAt,
              contentChars: meta?.contentChars ?? placeholder.content.length,
              reasoningChars: meta?.reasoningChars ?? (placeholder.reasoningContent?.length ?? 0),
            };
          },
        },
      );

      if (placeholder.content.length === 0 && !placeholder.reasoningContent) {
        placeholder.status = 'error';
        placeholder.errorMessage = '模型没有返回任何内容，请重试或更换模型';
      } else {
        placeholder.status = 'success';
        options.onMessageComplete?.(placeholder);
      }
    } catch (error) {
      const message =
        error instanceof ApiError || error instanceof Error
          ? error.message
          : '生成失败，请稍后重试';
      options.onError?.(message);
      placeholder.status = 'error';
      placeholder.errorMessage = message;
    } finally {
      streamingSessionId.value = '';
      abortController = null;
      touch(session);
      flush();
    }
  }

  /** 重新生成：删除最后一条 assistant 消息后用相同上下文重发 */
  async function regenerate(): Promise<void> {
    const session = activeSession.value;
    if (!session || isStreaming.value) return;

    const lastAssistantIndex = [...session.messages]
      .map((message, index) => ({ message, index }))
      .reverse()
      .find((item) => item.message.role === 'assistant')?.index;

    if (lastAssistantIndex === undefined) return;

    const lastUser = [...session.messages]
      .slice(0, lastAssistantIndex)
      .reverse()
      .find((message) => message.role === 'user');

    if (!lastUser) return;

    session.messages.splice(lastAssistantIndex, 1);
    await sendMessage(lastUser.content);

    // 重发会再次追加该条用户消息，去掉重复的一条
    const duplicated = session.messages.at(-2);
    if (duplicated && duplicated.role === 'user' && duplicated.content === lastUser.content) {
      session.messages.splice(-2, 1);
    }
    flush();
  }

  /* ----------------------------- 生命周期与同步 ----------------------------- */

  function onStorageEvent(event: StorageEvent): void {
    if (!persistEnabled || !event.key) return;
    if (!event.key.endsWith(`:sessions`) || !event.key.startsWith(options.namespace)) return;

    const latest = loadSessions(options.storage, options.namespace);
    sessions.splice(0, sessions.length, ...latest);
    if (!sessions.some((session) => session.id === activeId.value)) {
      activeId.value = sessions[0]?.id ?? '';
    }
  }

  onMounted(() => {
    refreshStorageSize();
    globalThis.addEventListener?.('storage', onStorageEvent);
  });

  onBeforeUnmount(() => {
    globalThis.removeEventListener?.('storage', onStorageEvent);
    abortController?.abort();
    flush();
  });

  watch(() => sessions.length, refreshStorageSize);

  // 首次进入时落盘，保证刷新后仍在
  flush();

  return {
    // state
    sessions,
    sortedSessions,
    activeId,
    activeSession,
    activeModel,
    activeSystemPrompt,
    messages,
    models,
    modelsError,
    isStreaming,
    streamingSessionId,
    totalMessages,
    storageSize,
    storageWarning,
    // actions
    newSession,
    selectSession,
    deleteSession,
    clearAll,
    renameSession,
    updateModel,
    updateSystemPrompt,
    loadModels,
    sendMessage,
    stopStreaming,
    regenerate,
    exportSessions,
    importSessions,
    flush,
  };
}

export type ChatController = ReturnType<typeof createChatController>;
