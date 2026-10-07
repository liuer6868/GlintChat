<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Icon from './Icon.vue';

const props = defineProps<{
  content: string;
  streaming: boolean;
  /** 思考耗时（毫秒），流式结束后由父组件计算 */
  durationMs?: number;
}>();

const collapsed = ref(false);
const userToggled = ref(false);

// 思考结束后自动收起，给正文让位（用户手动操作过则不干预）
watch(
  () => props.streaming,
  (streaming) => {
    if (!streaming && !userToggled.value) collapsed.value = true;
    if (streaming) collapsed.value = false;
  },
);

const durationText = computed(() => {
  if (props.streaming) return '思考中…';
  if (!props.durationMs || props.durationMs < 0) return '已完成思考';
  const seconds = props.durationMs / 1000;
  return `已思考 ${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} 秒`;
});

function toggle(): void {
  userToggled.value = true;
  collapsed.value = !collapsed.value;
}
</script>

<template>
  <div
    class="mb-2 overflow-hidden rounded-xl border border-violet-200/70 bg-violet-50/60 dark:border-violet-400/20 dark:bg-violet-500/10"
  >
    <button
      class="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[12.5px] font-medium text-violet-700 dark:text-violet-300"
      type="button"
      @click="toggle"
    >
      <Icon name="brain" :size="15" :class="streaming ? 'animate-pulse' : ''" />
      <span :class="streaming ? 'thinking-shimmer' : ''">{{ durationText }}</span>
      <Icon
        name="chevron-down"
        :size="14"
        class="ml-auto transition-transform"
        :class="collapsed ? '-rotate-90' : ''"
      />
    </button>

    <div
      v-show="!collapsed"
      class="scrollbar-slim max-h-72 overflow-y-auto border-t border-violet-200/70 px-3 py-2 text-[13px] leading-6 whitespace-pre-wrap text-slate-600 dark:border-violet-400/20 dark:text-slate-300"
    >
      {{ content }}
      <span v-if="streaming" class="typing-caret ml-0.5 text-violet-500" />
    </div>
  </div>
</template>
