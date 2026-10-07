/**
 * @glintchat/vue —— 可嵌入的 AI 对话面板
 * ---------------------------------------------------------------------------
 * 两种用法：
 *
 * 1) 组件方式（推荐，样式可控）：
 *      import { GlintChatPanel } from '@glintchat/vue';
 *      <GlintChatPanel api-base="/api/ai" namespace="admin-ai" class="h-[70vh]" />
 *
 * 2) 插件方式（全局注册组件）：
 *      import GlintChat from '@glintchat/vue';
 *      app.use(GlintChat, { apiBase: '/api/ai', namespace: 'admin-ai' });
 *
 * 面板默认使用相对路径 '/api'，需要独立部署时传完整地址：
 *      <GlintChatPanel api-base="https://ai.example.com/api" />
 *
 * 主题跟随宿主：面板内所有深色样式都写成 `.dark ...`，
 * 宿主自己的深色模式（html.dark）会自动生效，面板不会去改宿主页面。
 */
import type { App, Plugin } from 'vue';
import GlintChatPanel from './GlintChatPanel.vue';
import ChatArea from './components/ChatArea.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import Icon from './components/Icon.vue';
import MessageActions from './components/MessageActions.vue';
import MessageItem from './components/MessageItem.vue';
import AssistantBubble from './components/AssistantBubble.vue';
import UserBubble from './components/UserBubble.vue';
import PanelHeader from './components/PanelHeader.vue';
import Sidebar from './components/Sidebar.vue';
import SystemPromptDialog from './components/SystemPromptDialog.vue';
import ThinkingPanel from './components/ThinkingPanel.vue';
import type { GlintChatOptions } from './context.ts';

export interface GlintChatPluginOptions extends GlintChatOptions {
  /**
   * 是否注册全局组件 `<GlintChatPanel>`，默认 true。
   * 只想要 composable 时设为 false。
   */
  registerComponents?: boolean;
  /** 全局组件的标签名前缀，默认 'GlintChat'（即 <GlintChatPanel>） */
  prefix?: string;
}

export const GlintChat: Plugin<[GlintChatPluginOptions?]> = {
  install(app: App, options: GlintChatPluginOptions = {}) {
    if (options.registerComponents === false) return;

    const prefix = options.prefix ?? 'GlintChat';
    app.component(`${prefix}Panel`, GlintChatPanel);
    app.component(`${prefix}Sidebar`, Sidebar);
    app.component(`${prefix}ChatArea`, ChatArea);
    app.component(`${prefix}MessageItem`, MessageItem);
    app.component(`${prefix}UserBubble`, UserBubble);
    app.component(`${prefix}AssistantBubble`, AssistantBubble);
    app.component(`${prefix}ThinkingPanel`, ThinkingPanel);
    app.component(`${prefix}MessageActions`, MessageActions);
    app.component(`${prefix}SystemPromptDialog`, SystemPromptDialog);
    app.component(`${prefix}ConfirmDialog`, ConfirmDialog);
    app.component(`${prefix}PanelHeader`, PanelHeader);
    app.component(`${prefix}Icon`, Icon);
  },
};

export default GlintChat;

/* --------------------------------- 组件 --------------------------------- */
export {
  GlintChatPanel,
  Sidebar,
  ChatArea,
  MessageItem,
  UserBubble,
  AssistantBubble,
  ThinkingPanel,
  MessageActions,
  SystemPromptDialog,
  ConfirmDialog,
  PanelHeader,
  Icon,
};

/* ------------------------------ 组合式与上下文 ------------------------------ */
export {
  createGlintChatContext,
  provideGlintChat,
  useGlintChatContext,
  GLINTCHAT_KEY,
  type GlintChatContext,
  type GlintChatOptions,
} from './context.ts';
export {
  createChatController,
  createSession,
  buildTitle,
  type ChatController,
  type ChatControllerOptions,
} from './composables/useChat.ts';
export {
  createConfirmService,
  provideConfirm,
  useConfirm,
  CONFIRM_KEY,
  type ConfirmService,
  type ConfirmOptions,
} from './composables/useConfirm.ts';
export {
  createThemeController,
  type ThemeController,
  type ThemeOptions,
  type ThemeValue,
} from './composables/useTheme.ts';

/* --------------------------------- 核心层 --------------------------------- */
export {
  createChatClient,
  createSseParser,
  ApiError,
  type ChatClient,
  type ChatClientOptions,
  type ChatRequestPayload,
  type SseEventPayload,
  type StreamCallbacks,
  type StreamResult,
  type StreamStats,
} from './core/stream.ts';
export {
  createLocalStorage,
  createMemoryStorage,
  estimateStorageSize,
  loadSessions,
  persistSessionsNow,
  removeStoredSessions,
  sessionsKey,
  type GlintChatStorage,
} from './core/storage.ts';
export {
  renderMarkdown,
  highlightCode,
  escapeHtml,
  type HighlightResult,
} from './core/markdown.ts';
export { uuid } from './core/uuid.ts';
export * from './core/types.ts';
