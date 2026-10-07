<script setup lang="ts">
/** GlintChat 应用外壳：双栏布局 + 会话管理 + 流式对话编排 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import AppHeader from '@/components/AppHeader.vue';
import ChatArea from '@/components/ChatArea.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import Sidebar from '@/components/Sidebar.vue';
import SystemPromptDialog from '@/components/SystemPromptDialog.vue';
import { confirmDialog } from '@/composables/useConfirm';
import { useSessions } from '@/composables/useSessions';
import { useTheme } from '@/composables/useTheme';
import { DEFAULT_MODEL_ID, type PublicModel } from '@/types';
import { fetchModels, streamChat } from '@/utils/stream';

const FALLBACK_MODELS: PublicModel[] = [
  { id: 'deepseek-chat', name: 'DeepSeek-V3 (通用)', description: '', provider: 'DeepSeek', reasoning: false },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek-R1 (深度思考)',
    description: '',
    provider: 'DeepSeek',
    reasoning: true,
  },
];

const {
  sessions,
  sortedSessions,
  activeId,
  activeSession,
  activeModel,
  activeSystemPrompt,
  messages,
  totalMessages,
  storageSize,
  storageWarning,
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
  persistAndCheckQuota,
} = useSessions();

const { theme, toggleTheme } = useTheme();

const models = ref<PublicModel[]>(FALLBACK_MODELS);
const health = ref<'checking' | 'online' | 'offline'>('checking');
const appError = ref('');
const promptDialogOpen = ref(false);
const sidebarOpen = ref(true);
const isDesktop = ref(true);

const streamingSessionId = ref('');
const isStreaming = computed(() => streamingSessionId.value !== '');
let abortController: AbortController | null = null;

const currentModelId = computed(() => activeModel.value || DEFAULT_MODEL_ID);
const currentModelName = computed(
  () => models.value.find((model) => model.id === currentModelId.value)?.name ?? currentModelId.value,
);

/* ------------------------------ 模型 & 健康检查 ------------------------------ */

async function loadModels(): Promise<void> {
  try {
    const list = await fetchModels();
    if (list.length > 0) {
      models.value = list;
      const preferredMeta = list.find((model) => model.id === currentModelId.value);
      if (!preferredMeta && !list.some((model) => model.id === DEFAULT_MODEL_ID)) {
        updateSessionModel(list[0]?.id ?? DEFAULT_MODEL_ID);
      }
    }
    health.value = 'online';
  } catch (error) {
    health.value = 'offline';
    appError.value =
      error instanceof Error
        ? `无法获取模型列表：${error.message}（请确认后端已启动：pnpm dev:server）`
        : '无法获取模型列表，请确认后端已启动';
  }
}

/* --------------------------------- 发送消息 --------------------------------- */

function requireSession() {
  const session = activeSession.value;
  if (!session) return null;
  return session;
}

async function sendMessage(text: string): Promise<void> {
  const session = requireSession();
  if (!session || isStreaming.value) return;

  appError.value = '';
  streamingSessionId.value = session.id;
  abortController = new AbortController();

  addUserMessage(session, text);
  const placeholder = addAssistantPlaceholder(session, session.model);

  const controller = abortController;
  const startedAt = Date.now();

  try {
    await streamChat(
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
        onError: (message) => {
          appError.value = message;
        },
        onDone: (payload) => {
          const meta = payload?.meta as { contentChars?: number; reasoningChars?: number } | undefined;
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
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '生成失败，请稍后重试';
    appError.value = message;
    placeholder.status = 'error';
    placeholder.errorMessage = message;
  } finally {
    streamingSessionId.value = '';
    abortController = null;
    setMessageStatus(session, placeholder, placeholder.status ?? 'success');
  }
}

function stopStreaming(): void {
  abortController?.abort();
  abortController = null;
  streamingSessionId.value = '';
}

/** 重新生成：删除最后一条 assistant 消息，用相同的上下文重发 */
async function regenerate(): Promise<void> {
  const session = requireSession();
  if (!session || isStreaming.value) return;

  const lastIndex = [...session.messages]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find((item) => item.message.role === 'assistant')?.index;

  if (lastIndex === undefined) return;

  const lastUser = [...session.messages]
    .slice(0, lastIndex)
    .reverse()
    .find((message) => message.role === 'user');

  if (!lastUser) return;

  session.messages.splice(lastIndex, 1);
  await sendMessage(lastUser.content);

  // 重新生成会再次追加该条用户消息，去掉重复的一条
  const duplicated = session.messages.at(-2);
  if (duplicated && duplicated.role === 'user' && duplicated.content === lastUser.content) {
    session.messages.splice(-2, 1);
  }
}

/* -------------------------------- 会话操作 --------------------------------- */

function handleNewChat(): void {
  if (isStreaming.value) stopStreaming();
  newSession(currentModelId.value, activeSystemPrompt.value);
  sidebarOpen.value = isDesktop.value;
}

async function handleDeleteSession(id: string): Promise<void> {
  const session = sessions.find((item) => item.id === id);
  if (!session) return;

  const ok = await confirmDialog({
    title: '删除该会话？',
    message: `「${session.title}」及其 ${session.messages.length} 条消息将被永久删除，此操作不可撤销。`,
    confirmText: '删除',
    danger: true,
  });
  if (ok) deleteSession(id);
}

async function handleClearAll(): Promise<void> {
  const ok = await confirmDialog({
    title: '清空所有历史会话？',
    message: `共 ${sessions.length} 个会话、${totalMessages.value} 条消息将被永久删除，且无法恢复。`,
    confirmText: '全部清空',
    danger: true,
  });
  if (!ok) return;

  if (isStreaming.value) stopStreaming();
  clearAll();
}

function handleExport(): void {
  const blob = new Blob([exportSessions()], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `glintchat-history-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function handleImport(): void {
  const element = document.createElement('input');
  element.type = 'file';
  element.accept = 'application/json,.json';
  element.onchange = async () => {
    const file = element.files?.[0];
    if (!file) return;
    const text = await file.text();
    const count = importSessions(text);
    appError.value = count > 0 ? '' : '导入失败：文件格式不正确或会话已存在';
    if (count > 0) {
      appError.value = `已导入 ${count} 个会话`;
      window.setTimeout(() => (appError.value = ''), 2600);
    }
  };
  element.click();
}

/* -------------------------------- 响应式布局 -------------------------------- */

function updateViewport(): void {
  const desktop = window.innerWidth >= 1024;
  if (desktop !== isDesktop.value) {
    isDesktop.value = desktop;
    sidebarOpen.value = desktop;
  }
}

function onGlobalKeydown(event: KeyboardEvent): void {
  // Ctrl/⌘ + K 新建对话；Ctrl/⌘ + / 打开角色设定
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key.toLowerCase() === 'k') {
    event.preventDefault();
    handleNewChat();
  }
  if (event.key === '/') {
    event.preventDefault();
    promptDialogOpen.value = true;
  }
}

watch(isDesktop, (desktop) => {
  if (!desktop) sidebarOpen.value = false;
});

watch(storageWarning, (warning) => {
  if (warning) appError.value = warning;
});

onMounted(() => {
  updateViewport();
  sidebarOpen.value = isDesktop.value;
  window.addEventListener('resize', updateViewport);
  window.addEventListener('keydown', onGlobalKeydown);
  void loadModels();
  // 关闭/刷新页面前立即落盘，避免丢失最后一段增量
  window.addEventListener('pagehide', persistAndCheckQuota);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateViewport);
  window.removeEventListener('keydown', onGlobalKeydown);
  window.removeEventListener('pagehide', persistAndCheckQuota);
  persistAndCheckQuota();
  abortController?.abort();
});
</script>

<template>
  <div class="flex h-full w-full overflow-hidden bg-gradient-to-br from-slate-100 via-slate-50 to-slate-200 dark:from-ink-900 dark:via-ink-900 dark:to-slate-900">
    <!-- 桌面端侧边栏 -->
    <Sidebar
      v-if="isDesktop && sidebarOpen"
      :sessions="sortedSessions"
      :active-id="activeId"
      :total-messages="totalMessages"
      :storage-size="storageSize"
      :mobile-open="false"
      :is-desktop="true"
      @new-chat="handleNewChat"
      @select="selectSession"
      @delete="handleDeleteSession"
      @clear-all="handleClearAll"
      @rename="renameSession"
      @export="handleExport"
      @import="handleImport"
      @close="sidebarOpen = false"
    />

    <main class="flex min-w-0 flex-1 flex-col">
      <AppHeader
        :models="models"
        :model-id="currentModelId"
        :system-prompt="activeSystemPrompt"
        :streaming="isStreaming"
        :sidebar-open="sidebarOpen"
        :is-desktop="isDesktop"
        :theme="theme"
        :health="health"
        :error="appError"
        @update:model-id="updateSessionModel"
        @edit-system-prompt="promptDialogOpen = true"
        @toggle-theme="toggleTheme"
        @toggle-sidebar="sidebarOpen = !sidebarOpen"
        @refresh-models="loadModels"
      />

      <ChatArea
        :messages="messages"
        :model-id="currentModelId"
        :model-name="currentModelName"
        :models="models"
        :streaming="isStreaming"
        :system-prompt="activeSystemPrompt"
        :error="appError"
        @send="sendMessage"
        @stop="stopStreaming"
        @regenerate="regenerate"
        @dismiss-error="appError = ''"
      />
    </main>

    <!-- 移动端抽屉 -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-200"
        enter-from-class="opacity-0"
        leave-active-class="transition duration-150"
        leave-to-class="opacity-0"
      >
        <div
          v-if="!isDesktop && sidebarOpen"
          class="fixed inset-0 z-40 flex bg-slate-900/40 backdrop-blur-sm"
          @click.self="sidebarOpen = false"
        >
          <Sidebar
            :sessions="sortedSessions"
            :active-id="activeId"
            :total-messages="totalMessages"
            :storage-size="storageSize"
            :mobile-open="true"
            :is-desktop="false"
            @new-chat="handleNewChat"
            @select="
              (id: string) => {
                selectSession(id);
                sidebarOpen = false;
              }
            "
            @delete="handleDeleteSession"
            @clear-all="handleClearAll"
            @rename="renameSession"
            @export="handleExport"
            @import="handleImport"
            @close="sidebarOpen = false"
          />
        </div>
      </Transition>
    </Teleport>

    <SystemPromptDialog
      :open="promptDialogOpen"
      :model="currentModelName"
      :value="activeSystemPrompt"
      @close="promptDialogOpen = false"
      @save="
        (value: string) => {
          updateSystemPrompt(value);
          promptDialogOpen = false;
        }
      "
    />

    <ConfirmDialog />
  </div>
</template>
