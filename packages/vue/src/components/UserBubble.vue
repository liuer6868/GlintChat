<script setup lang="ts">
import { computed } from 'vue';
import type { ChatMessage } from '../core/types';
import { renderMarkdown } from '../core/markdown';

const props = defineProps<{
  message: ChatMessage;
  /** 可选：整体替换 Markdown 渲染实现 */
  renderer?: (source: string) => string;
}>();

const html = computed(() => (props.renderer ?? renderMarkdown)(props.message.content));
</script>

<template>
  <div class="flex justify-end gap-2.5">
    <div class="max-w-[85%] sm:max-w-[75%]">
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div
        class="markdown-body rounded-2xl rounded-br-md bg-gradient-to-br from-brand-600 to-cyan-500 px-4 py-2.5 text-white shadow-sm [&_*]:text-white"
        v-html="html"
      />
      <p class="mt-1 text-right text-[11px] text-slate-400 dark:text-slate-500">
        {{ new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}
      </p>
    </div>
    <div
      class="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-slate-300"
    >
      <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" stroke-linecap="round" />
      </svg>
    </div>
  </div>
</template>
