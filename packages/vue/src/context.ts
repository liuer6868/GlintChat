/**
 * 面板上下文：把配置、客户端、存储、确认弹窗打包成一个对象，
 * 通过 provide/inject 下发到子组件（多实例场景下每个面板一份）。
 */
import { inject, provide, ref, type InjectionKey, type Ref } from 'vue';
import { createChatClient, type ChatClient } from '../core/stream';
import {
  createLocalStorage,
  createMemoryStorage,
  type GlintChatStorage,
} from '../core/storage';
import { DEFAULT_NAMESPACE, DEFAULT_SYSTEM_PROMPT, type PublicModel } from '../core/types';

export interface GlintChatOptions {
  /** 后端地址前缀（含路由前缀），默认 '/api'；跨域时写完整地址 */
  apiBase?: string;
  /** 存储命名空间，多个面板必须不同，默认 'glintchat' */
  namespace?: string;
  /** 是否持久化到 localStorage，默认 true */
  persist?: boolean;
  /** 自定义存储适配器（优先级高于 persist） */
  storage?: GlintChatStorage;
  /** 额外请求头，支持函数形式动态取 token */
  headers?: Record<string, string> | (() => Record<string, string>);
  /** 自定义 fetch */
  fetch?: typeof globalThis.fetch;
  /** 默认模型 id */
  defaultModel?: string;
  /** 默认系统提示词 */
  defaultSystemPrompt?: string;
  /** 外部已拿到模型列表时可直接传入，省一次请求 */
  models?: PublicModel[];
  /** 整体替换 Markdown 渲染器 */
  renderMarkdown?: (source: string) => string;
  /** 主题：'inherit'（跟随宿主 html.dark，默认）| 'light' | 'dark' | 'auto' */
  theme?: 'inherit' | 'light' | 'dark' | 'auto';
}

export interface GlintChatContext {
  options: Required<Omit<GlintChatOptions, 'storage' | 'headers' | 'fetch' | 'renderMarkdown' | 'models'>> &
    Pick<GlintChatOptions, 'storage' | 'headers' | 'fetch' | 'renderMarkdown'>;
  client: ChatClient;
  storage: GlintChatStorage;
  /** 共享的模型列表（header 与面板共用一份） */
  models: Ref<PublicModel[]>;
  /** 当前会话的模型 id */
  modelId: Ref<string>;
  /** 当前会话的系统提示词 */
  systemPrompt: Ref<string>;
}

export const GLINTCHAT_KEY: InjectionKey<GlintChatContext> = Symbol('glintchat:context');

export function createGlintChatContext(options: GlintChatOptions = {}): GlintChatContext {
  const persist = options.persist ?? true;
  const storage =
    options.storage ?? (persist ? createLocalStorage() : createMemoryStorage());

  const client = createChatClient({
    apiBase: options.apiBase,
    headers: options.headers,
    fetch: options.fetch,
  });

  const resolved = {
    apiBase: client.apiBase,
    namespace: options.namespace ?? DEFAULT_NAMESPACE,
    persist,
    defaultModel: options.defaultModel ?? 'deepseek-chat',
    defaultSystemPrompt: options.defaultSystemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    theme: options.theme ?? 'inherit',
    storage: options.storage,
    headers: options.headers,
    fetch: options.fetch,
    renderMarkdown: options.renderMarkdown,
  } as GlintChatContext['options'];

  const models = ref<PublicModel[]>(options.models ? [...options.models] : []);
  const modelId = ref<string>(resolved.defaultModel);
  const systemPrompt = ref<string>(resolved.defaultSystemPrompt);

  return { options: resolved, client, storage, models, modelId, systemPrompt };
}

export function provideGlintChat(context: GlintChatContext): GlintChatContext {
  provide(GLINTCHAT_KEY, context);
  return context;
}

/** 子组件取上下文；未提供时返回 undefined（组件据此退化为纯展示组件） */
export function useGlintChatContext(): GlintChatContext | undefined {
  return inject(GLINTCHAT_KEY, undefined);
}
