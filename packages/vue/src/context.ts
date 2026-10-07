/**
 * 闈㈡澘涓婁笅鏂囷細鎶婇厤缃€佸鎴风銆佸瓨鍌ㄣ€佺‘璁ゅ脊绐楁墦鍖呮垚涓€涓璞★紝
 * 閫氳繃 provide/inject 涓嬪彂鍒板瓙缁勪欢锛堝瀹炰緥鍦烘櫙涓嬫瘡涓潰鏉夸竴浠斤級銆?
 */
import { inject, provide, ref, type InjectionKey, type Ref } from 'vue';
import { createChatClient, type ChatClient } from '../core/stream.ts';
import {
  createLocalStorage,
  createMemoryStorage,
  type GlintChatStorage,
} from '../core/storage.ts';
import { DEFAULT_NAMESPACE, DEFAULT_SYSTEM_PROMPT, type PublicModel } from '../core/types.ts';

export interface GlintChatOptions {
  /** 鍚庣鍦板潃鍓嶇紑锛堝惈璺敱鍓嶇紑锛夛紝榛樿 '/api'锛涜法鍩熸椂鍐欏畬鏁村湴鍧€ */
  apiBase?: string;
  /** 瀛樺偍鍛藉悕绌洪棿锛屽涓潰鏉垮繀椤讳笉鍚岋紝榛樿 'glintchat' */
  namespace?: string;
  /** 鏄惁鎸佷箙鍖栧埌 localStorage锛岄粯璁?true */
  persist?: boolean;
  /** 鑷畾涔夊瓨鍌ㄩ€傞厤鍣紙浼樺厛绾ч珮浜?persist锛?*/
  storage?: GlintChatStorage;
  /** 棰濆璇锋眰澶达紝鏀寔鍑芥暟褰㈠紡鍔ㄦ€佸彇 token */
  headers?: Record<string, string> | (() => Record<string, string>);
  /** 鑷畾涔?fetch */
  fetch?: typeof globalThis.fetch;
  /** 榛樿妯″瀷 id */
  defaultModel?: string;
  /** 榛樿绯荤粺鎻愮ず璇?*/
  defaultSystemPrompt?: string;
  /** 澶栭儴宸叉嬁鍒版ā鍨嬪垪琛ㄦ椂鍙洿鎺ヤ紶鍏ワ紝鐪佷竴娆¤姹?*/
  models?: PublicModel[];
  /** 鏁翠綋鏇挎崲 Markdown 娓叉煋鍣?*/
  renderMarkdown?: (source: string) => string;
  /** 涓婚锛?inherit'锛堣窡闅忓涓?html.dark锛岄粯璁わ級| 'light' | 'dark' | 'auto' */
  theme?: 'inherit' | 'light' | 'dark' | 'auto';
}

export interface GlintChatContext {
  options: Required<Omit<GlintChatOptions, 'storage' | 'headers' | 'fetch' | 'renderMarkdown' | 'models'>> &
    Pick<GlintChatOptions, 'storage' | 'headers' | 'fetch' | 'renderMarkdown'>;
  client: ChatClient;
  storage: GlintChatStorage;
  /** 鍏变韩鐨勬ā鍨嬪垪琛紙header 涓庨潰鏉垮叡鐢ㄤ竴浠斤級 */
  models: Ref<PublicModel[]>;
  /** 褰撳墠浼氳瘽鐨勬ā鍨?id */
  modelId: Ref<string>;
  /** 褰撳墠浼氳瘽鐨勭郴缁熸彁绀鸿瘝 */
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

/** 瀛愮粍浠跺彇涓婁笅鏂囷紱鏈彁渚涙椂杩斿洖 undefined锛堢粍浠舵嵁姝ら€€鍖栦负绾睍绀虹粍浠讹級 */
export function useGlintChatContext(): GlintChatContext | undefined {
  return inject(GLINTCHAT_KEY, undefined);
}
