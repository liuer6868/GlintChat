<script setup lang="ts">
import Icon from './Icon.vue';
import { useConfirm } from '../composables/useConfirm.ts';

// 取当前作用域的确认服务：嵌入宿主时为面板自己的实例，应用外壳下为默认单例
const confirm = useConfirm();
const state = confirm.state;
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0"
      leave-active-class="transition duration-100 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-if="state.open"
        class="fixed inset-0 z-[60] grid place-items-center bg-slate-900/50 p-4 backdrop-blur-sm"
        @click.self="confirm.resolve(false)"
      >
        <div class="card w-full max-w-sm p-5 shadow-xl" role="alertdialog" aria-modal="true">
          <div class="flex items-start gap-3">
            <div
              class="grid size-9 shrink-0 place-items-center rounded-xl"
              :class="
                state.danger
                  ? 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400'
                  : 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300'
              "
            >
              <Icon :name="state.danger ? 'alert' : 'shield'" :size="18" />
            </div>
            <div class="min-w-0">
              <h3 class="text-[15px] font-semibold text-slate-900 dark:text-white">
                {{ state.title }}
              </h3>
              <p class="mt-1 text-[13px] leading-6 text-slate-600 dark:text-slate-300">
                {{ state.message }}
              </p>
            </div>
          </div>

          <div class="mt-4 flex justify-end gap-2">
            <button class="btn-ghost text-[13px]" type="button" @click="confirm.resolve(false)">
              {{ state.cancelText }}
            </button>
            <button
              class="btn text-[13px] text-white"
              :class="
                state.danger
                  ? 'bg-rose-600 hover:bg-rose-500'
                  : 'bg-brand-600 hover:bg-brand-500'
              "
              type="button"
              @click="confirm.resolve(true)"
            >
              {{ state.confirmText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
