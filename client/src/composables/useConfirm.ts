/**
 * 确认弹窗服务
 * ---------------------------------------------------------------------------
 * 可嵌入设计要点：确认弹窗必须有「实例」概念。
 * 之前用模块级单例，一个页面挂两个聊天面板时，A 面板的确认框会被 B 面板的调用
 * 静默取消（resolver 被覆盖），用户的删除操作会无声失败。
 * 现在：`createConfirmService()` 产出独立实例，通过 provide/inject 下发；
 * 应用外壳（App.vue）继续使用默认单例，行为完全不变。
 */
import { inject, provide, reactive, readonly } from 'vue';
import type { InjectionKey } from 'vue';

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

/** 应用外壳的默认实例（保持既有调用方式不变） */
const defaultService = createConfirmService();

export function provideConfirm(service: ConfirmService = createConfirmService()): ConfirmService {
  provide(CONFIRM_KEY, service);
  return service;
}

/** 组件内取用：优先取注入的实例，未注入时回退到默认单例 */
export function useConfirm(): ConfirmService {
  return inject(CONFIRM_KEY, defaultService);
}

/* ------------------------- 兼容旧 API（应用外壳用） ------------------------- */

export function useConfirmState() {
  return defaultService.state;
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return defaultService.ask(options);
}

export function resolveConfirm(value: boolean): void {
  defaultService.resolve(value);
}
