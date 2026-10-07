/**
 * 主题控制（实例化，无 import 副作用）
 * ---------------------------------------------------------------------------
 * 注意：不要在模块顶层写 DOM。作为库被宿主 import 时，那会污染宿主页面。
 */
import { ref } from 'vue';

export type ThemeValue = 'light' | 'dark';

export interface ThemeOptions {
  /** 存储 key，嵌入时建议加命名空间前缀 */
  storageKey?: string;
  /** 存储介质，传 null 表示不持久化 */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** 主题类挂在哪个元素上，默认 document.documentElement */
  target?: () => HTMLElement | null;
  /** 深色模式使用的类名，默认 'dark' */
  darkClass?: string;
  /** 首次使用时是否立即把主题写到 DOM，默认 true */
  applyOnInit?: boolean;
}

const DEFAULT_THEME_KEY = 'glintchat:theme';

function resolveStorage(options: ThemeOptions): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (options.storage === null) return null;
  if (options.storage) return options.storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function systemPrefersDark(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  } catch {
    return false;
  }
}

export function createThemeController(options: ThemeOptions = {}) {
  const storageKey = options.storageKey ?? DEFAULT_THEME_KEY;
  const darkClass = options.darkClass ?? 'dark';
  const storage = resolveStorage(options);
  const target =
    options.target ?? (() => (typeof document === 'undefined' ? null : document.documentElement));

  function readStored(): ThemeValue | null {
    try {
      const stored = storage?.getItem(storageKey);
      return stored === 'light' || stored === 'dark' ? stored : null;
    } catch {
      return null;
    }
  }

  const theme = ref<ThemeValue>(readStored() ?? (systemPrefersDark() ? 'dark' : 'light'));
  let initialized = false;

  function write(value: ThemeValue, applyToDom: boolean): void {
    theme.value = value;
    if (applyToDom) {
      target()?.classList.toggle(darkClass, value === 'dark');
    }
    try {
      storage?.setItem(storageKey, value);
    } catch {
      /* 忽略写入失败 */
    }
  }

  /** 惰性初始化：第一次真正用到主题时才动 DOM */
  function ensureInitialized(): void {
    if (initialized) return;
    initialized = true;
    if (options.applyOnInit !== false) write(theme.value, true);
  }

  return {
    theme,
    ensureInitialized,
    setTheme(value: ThemeValue, applyToDom = true) {
      write(value, applyToDom);
    },
    toggleTheme(applyToDom = true) {
      write(theme.value === 'dark' ? 'light' : 'dark', applyToDom);
    },
  };
}

export type ThemeController = ReturnType<typeof createThemeController>;
