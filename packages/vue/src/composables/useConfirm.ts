/**
 * 确认弹窗服务（实例化）
 * ---------------------------------------------------------------------------
 * 必须是「实例」而不是模块单例：一个页面挂两个面板时，
 * 模块单例会让一个面板的确认框被另一个面板的调用静默取消。
 */
import { inject, provide, reactive, readonly, type InjectionKey } from 'vue';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface ConfirmState extends Required<Omit<ConfirmOptions, 'danger'>> {
  open: boolean;
  danger: boolean;
}

export interface ConfirmService {
  state: Readonly<ConfirmState>;
  ask(options: ConfirmOptions): Promise<boolean>;
  resolve(value: boolean): void;
}

export const CONFIRM_KEY: InjectionKey<ConfirmService> = Symbol('glintchat:confirm');

export function createConfirmService(): ConfirmService {
  const state = reactive<ConfirmState>({
    open: false,
    title: '',
    message: '',
    confirmText: '确认',
    cancelText: '取消',
    danger: false,
  });

  let resolver: ((value: boolean) => void) | null = null;

  function settle(value: boolean): void {
    state.open = false;
    resolver?.(value);
    resolver = null;
  }

  return {
    state: readonly(state) as Readonly<ConfirmState>,
    ask(options: ConfirmOptions): Promise<boolean> {
      // 上一个弹窗未关闭时视为取消，避免 Promise 悬挂
      resolver?.(false);

      state.title = options.title;
      state.message = options.message;
      state.confirmText = options.confirmText ?? '确认';
      state.cancelText = options.cancelText ?? '取消';
      state.danger = options.danger ?? false;
      state.open = true;

      return new Promise<boolean>((resolve) => {
        resolver = resolve;
      });
    },
    resolve: settle,
  };
}

export function provideConfirm(service: ConfirmService = createConfirmService()): ConfirmService {
  provide(CONFIRM_KEY, service);
  return service;
}

export function useConfirm(): ConfirmService {
  const injected = inject(CONFIRM_KEY, null);
  if (injected) return injected;

  // 没有注入时退化到一个进程内单例（直接单独使用 ConfirmDialog 时可用）
  return (fallback ??= createConfirmService());
}

let fallback: ConfirmService | null = null;
