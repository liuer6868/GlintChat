<script setup lang="ts">
/**
 * GlintChat 可嵌入对话面板
 * ---------------------------------------------------------------------------
 * 宿主只需一个标签即可获得完整的「侧栏 + 对话区」体验：
 *   <GlintChatPanel api-base="/api/ai" namespace="admin-ai" />
 *
 * 设计约束：
 * - 不写 document.documentElement（主题跟随宿主，需要独立主题时自己在面板外层加 .dark）；
 * - 不注册全局快捷键、不监听 window resize（避免抢占宿主行为）；
 * - 所有依赖（apiBase / 命名空间 / 存储 / 模型）都来自 props，可多实例共存。
 */
import { computed, onMounted, provide, ref, toRef, watch } from 'vue';
import ChatArea from './ChatArea.vue';
import ConfirmDialog from './ConfirmDialog.vue';
import PanelHeader from './PanelHeader.vue';
import Sidebar from './Sidebar.vue';
import SystemPromptDialog from './SystemPromptDialog.vue';
import { createGlintChatContext, provideGlintChat } from '../context';
import { createChatController } from '../composables/useChat';
import { createConfirmService, provideConfirm } from '../composables/useConfirm';
import { renderMarkdown as defaultRenderMarkdown } from '../core/markdown';
import type { ChatMessage, ChatSession, PublicModel } from '../core/types';
import { DEFAULT_NAMESPACE, DEFAULT_SYSTEM_PROMPT } from '../core/types';

const props = withDefaults(
  defineProps<{
    /** 后端地址前缀（含路由前缀），默认 '/api'；跨域时写完整地址 */
    apiBase?: string;
    /** 存储命名空间，多个面板必须不同 */
    namespace?: string;
    /** 是否持久化到 localStorage，默认 true */
    persist?: boolean;
    /** 默认模型 id */
    defaultModel?: string;
    /** 默认系统提示词 */
    defaultSystemPrompt?: string;
    /** 外部已有模型列表时可传入，省一次请求 */
    models?: PublicModel[];
    /** 是否显示左侧会话列表，默认 true */
    showSidebar?: boolean;
    /** 整体替换 Markdown 渲染实现 */
    renderMarkdown?: (source: string) => string;
    /** 额外请求头，支持函数形式动态取 token */
    headers?: Record<string, string> | (() => Record<string, string>);
    /** 自定义 fetch */
    fetch?: typeof globalThis.fetch;
  }>(),
  {
    apiBase: '/api',
    namespace: DEFAULT_NAMESPACE,
    persist: true,
    showSidebar: true,
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
  },
);

const emit = defineEmits<{
  (event: 'session-change', session: ChatSession | undefined): void;
  (event: 'message-complete', message: ChatMessage): void;
  (event: 'error', payload: { message: string; code?: string }): void;
  (event: 'models-loaded', models: PublicModel[]): void;
}>();

/* ------------------------- 上下文（多实例互不干扰） ------------------------- */

const confirmService = createConfirmService();
provideConfirm(confirmService);

const context = createGlintChatContext({
  apiBase: props.apiBase,
  namespace: props.namespace,
  persist: props.persist,
  defaultModel: props.defaultModel,
  defaultSystemPrompt: props.defaultSystemPrompt,
  models: props.models,
  headers: props.headers,
  fetch: props.fetch,
  renderMarkdown: props.renderMarkdown,
});
provideGlintChat(context);

const controller = createChatController({
  storage: context.storage,
  namespace: context.options.namespace,
  client: context.client,
  defaultModel: context.options.defaultModel,
  defaultSystemPrompt: context.options.defaultSystemPrompt,
  persist: context.options.persist,
  models: props.models,
  onError: (message, code) => emit('error', { message, code }),
  onMessageComplete: (message) => emit('message-complete', message),
  onSessionChange: (session) => emit('session-change', session),
});

// 把控制器状态同步进上下文，子组件（如 Header）可直接取用
watch(
  () => controller.activeModel.value,
  (value) => (context.modelId.value = value),
  { immediate: true },
);
watch(
  () => controller.activeSystemPrompt.value,
  (value) => (context.systemPrompt.value = value),
  { immediate: true },
);
watch(
  () => controller.models.value,
  (value) => (context.models.value = value),
  { immediate: true, deep: true },
);

/* --------------------------------- 局部 UI --------------------------------- */

const sidebarOpen = ref(props.showSidebar);
const promptDialogOpen = ref(false);
const status = ref<'checking' | 'online' | 'offline'>('checking');
const panelError = ref('');

/** 窄屏默认收起侧栏（面板自己的响应式，不监听 window resize，避免干扰宿主） */
function syncSidebarForViewport(): void {
  try {
    const narrow = globalThis.matchMedia?.('(max-width: 640px)').matches ?? false;
    sidebarOpen.value = props.showSidebar && !narrow;
  } catch {
    sidebarOpen.value = props.showSidebar;
  }
}

const currentModelName = computed(
  () =>
    controller.models.value.find((model) => model.id === controller.activeModel.value)?.name ??
    controller.activeModel.value,
);

const renderer = toRef(props, 'renderMarkdown');

async function refreshModels(): Promise<void> {
  status.value = 'checking';
  const list = await controller.loadModels();
  status.value = list.length > 0 ? 'online' : 'offline';
  if (list.length > 0) emit('models-loaded', list);
  if (controller.modelsError.value) panelError.value = controller.modelsError.value;
}

onMounted(() => {
  syncSidebarForViewport();
  void refreshModels();
});

async function handleDeleteSession(id: string): Promise<void> {
  const session = controller.sessions.find((item) => item.id === id);
  if (!session) return;

  const ok = await confirmService.ask({
    title: '删除该会话？',
    message: `「${session.title}」及其 ${session.messages.length} 条消息将被永久删除，此操作不可撤销。`,
    confirmText: '删除',
    danger: true,
  });
  if (ok) controller.deleteSession(id);
}

async function handleClearAll(): Promise<void> {
  const ok = await confirmService.ask({
    title: '清空所有历史会话？',
    message: `共 ${controller.sessions.length} 个会话、${controller.totalMessages.value} 条消息将被永久删除，且无法恢复。`,
    confirmText: '全部清空',
    danger: true,
  });
  if (!ok) return;

  if (controller.isStreaming.value) controller.stopStreaming();
  controller.clearAll();
}

function handleExport(): void {
  const blob = new Blob([controller.exportSessions()], { type: 'application/json;charset=utf-8' });
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
    const count = controller.importSessions(await file.text());
    panelError.value = count > 0 ? `已导入 ${count} 个会话` : '导入失败：文件格式不正确或会话已存在';
    if (count > 0) window.setTimeout(() => (panelError.value = ''), 2600);
  };
  element.click();
}

defineExpose({
  /** 便利方法：供宿主在外部触发一次发送 */
  send: (text: string) => controller.sendMessage(text),
  stop: () => controller.stopStreaming(),
  newSession: () => controller.newSession(),
  controller,
});
</script>

<template>
  <div
    class="flex h-full min-h-[420px] w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50 text-slate-800 dark:border-white/10 dark:bg-ink-900 dark:text-slate-200"
  >
    <!-- 会话侧栏 -->
    <Sidebar
      v-if="sidebarOpen"
      class="hidden sm:flex"
      :sessions="controller.sortedSessions.value"
      :active-id="controller.activeId.value"
      :total-messages="controller.totalMessages.value"
      :storage-size="controller.storageSize.value"
      :mobile-open="false"
      :is-desktop="true"
      @new-chat="controller.newSession()"
      @select="controller.selectSession"
      @delete="handleDeleteSession"
      @clear-all="handleClearAll"
      @rename="controller.renameSession"
      @export="handleExport"
      @import="handleImport"
      @close="sidebarOpen = false"
    />

    <main class="flex min-w-0 flex-1 flex-col">
      <PanelHeader
        :models="controller.models.value"
        :model-id="controller.activeModel.value"
        :system-prompt="controller.activeSystemPrompt.value"
        :streaming="controller.isStreaming.value"
        :status="status"
        :error="panelError"
        :show-sidebar-toggle="sidebarOpen"
        @update:model-id="controller.updateModel"
        @edit-system-prompt="promptDialogOpen = true"
        @toggle-sidebar="sidebarOpen = !sidebarOpen"
        @refresh-models="refreshModels"
      >
        <template #actions><slot name="header-actions" /></template>
      </PanelHeader>

      <ChatArea
        :messages="controller.messages.value"
        :model-id="controller.activeModel.value"
        :model-name="currentModelName"
        :models="controller.models.value"
        :streaming="controller.isStreaming.value"
        :system-prompt="controller.activeSystemPrompt.value"
        :error="panelError"
        :renderer="renderer"
        @send="controller.sendMessage"
        @stop="controller.stopStreaming"
        @regenerate="controller.regenerate"
        @dismiss-error="panelError = ''"
      >
        <template #empty><slot name="empty" /></template>
      </ChatArea>
    </main>

    <SystemPromptDialog
      :open="promptDialogOpen"
      :model="currentModelName"
      :value="controller.activeSystemPrompt.value"
      @close="promptDialogOpen = false"
      @save="
        (value: string) => {
          controller.updateSystemPrompt(value);
          promptDialogOpen = false;
        }
      "
    />

    <ConfirmDialog />
  </div>
</template>
