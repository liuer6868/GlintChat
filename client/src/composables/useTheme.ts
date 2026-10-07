/**
 * 亮 / 暗主题切换
 * ---------------------------------------------------------------------------
 * 可嵌入设计要点（很重要）：
 * 1. **不在模块顶层产生副作用**。之前的实现在 import 时就写 <html> 的 class 和
 *    localStorage，作为库被宿主 import 时会污染宿主页面；现在改为「首次调用时惰性应用」。
 * 2. 主题类与存储 key 都可配置，多个实例（一个页面挂两个面板）互不打架。
 * 3. `applyOnInit: false` 时只读取状态、不写 DOM，交给宿主自己控制。
 */
import { ref } from 'vue';

export const THEME_STORAGE_KEY = 'glintchat_theme';

export type ThemeValue = 'light' | 'dark';

export interface ThemeOptions {
  /** localStorage key，嵌入时建议加命名空间前缀 */
  storageKey?: string;
  /** 存储介质，传 null 表示不持久化（内存态） */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** 主题类挂在哪个元素上，默认 document.documentElement */
  target?: () => HTMLElement | null;
  /** 深色模式使用的类名，默认 'dark' */
  darkClass?: string;
  /** 首次使用时是否立即把主题写到 DOM，默认 true */
  applyOnInit?: boolean;
}

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

function createThemeController(options: ThemeOptions = {}) {
  const storageKey = options.storageKey ?? THEME_STORAGE_KEY;
  const darkClass = options.darkClass ?? 'dark';
  const storage = resolveStorage(options);
  const target = options.target ?? (() => (typeof document === 'undefined' ? null : document.documentElement));

  function readStored(): ThemeValue | null {
    try {
      const stored = storage?.getItem(storageKey);
      return stored === 'light' || stored === 'dark' ? stored : null;
    } catch {
      return null;
    }
  }

  const theme = ref<ThemeValue>(readStored() ?? (systemPrefersDark() ? 'dark' : 'light'));

  function write(value: ThemeValue, applyToDom: boolean): void {
    theme.value = value;
    if (applyToDom) {
      const element = target();
      element?.classList.toggle(darkClass, value === 'dark');
    }
    try {
      storage?.setItem(storageKey, value);
    } catch {
      /* 忽略写入失败（隐私模式等） */
    }
  }

  let initialized = false;
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
    /** 跟随系统，并且不写入 localStorage */
    followSystem() {
      write(systemPrefersDark() ? 'dark' : 'light', true);
    },
  };
}

export type ThemeController = ReturnType<typeof createThemeController>;

/** 应用外壳使用的默认实例（与之前行为一致，只是不再在 import 时生效） */
const defaultController = createThemeController();

export function useTheme(options?: ThemeOptions) {
  if (options) return createThemeController(options);

  defaultController.ensureInitialized();

  return {
    theme: defaultController.theme,
    toggleTheme: () => defaultController.toggleTheme(),
    setTheme: (value: ThemeValue) => defaultController.setTheme(value),
  };
}

/** 供 main.ts 等入口显式初始化（避免首帧闪烁） */
export function initTheme(options?: ThemeOptions): ThemeController {
  const controller = options ? createThemeController(options) : defaultController;
  controller.ensureInitialized();
  return controller;
}

export { createThemeController };
