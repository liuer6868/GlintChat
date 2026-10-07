<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import Icon from './Icon.vue';
import MessageActions from './MessageActions.vue';
import ThinkingPanel from './ThinkingPanel.vue';
import type { ChatMessage } from '../core/types.ts';
import { renderMarkdown } from '../core/markdown.ts';

const props = defineProps<{
  message: ChatMessage;
  streaming: boolean;
  /** 是否是整个会话的最后一条 assistant 消息（决定能否重新生成） */
  canRegenerate: boolean;
  /** 可选：整体替换 Markdown 渲染实现 */
  renderer?: (source: string) => string;
}>();

const emit = defineEmits<{
  (event: 'regenerate'): void;
}>();

const bodyRef = ref<HTMLElement | null>(null);
const startedAt = props.message.createdAt;
const thinkingElapsed = ref(0);

const html = computed(() => (props.renderer ?? renderMarkdown)(props.message.content));

const reasoningText = computed(() => props.message.reasoningContent ?? '');
const showThinking = computed(() => reasoningText.value.length > 0);

/** 思考耗时：每次重渲染时刷新，流式结束后即为最终值 */
function refreshElapsed(): void {
  thinkingElapsed.value = Date.now() - startedAt;
}

onMounted(refreshElapsed);

const reasoningDone = computed(() => props.message.content.length > 0 || !props.streaming);

const statusText = computed(() => {
  if (props.message.status === 'sending') return '连接模型中…';
  if (props.streaming) return '正在生成…';
  return '';
});

/** 代码块复制按钮：事件委托处理 [data-code-copy] */
async function onClick(event: MouseEvent): Promise<void> {
  const target = event.target as HTMLElement | null;
  const button = target?.closest<HTMLElement>('[data-code-copy]');
  if (!button || !bodyRef.value) return;

  const block = button.closest('.code-block');
  const code = block?.querySelector('code')?.textContent ?? '';
  if (!code) return;

  try {
    await navigator.clipboard.writeText(code);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = code;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }

  button.textContent = '已复制';
  window.setTimeout(() => (button.textContent = '复制'), 1600);
}
</script>

<template>
  <div class="flex gap-2.5">
    <div
      class="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-cyan-400 text-white shadow-sm shadow-brand-500/25"
    >
      <Icon name="sparkles" :size="16" />
    </div>

    <div class="min-w-0 max-w-[92%] flex-1 sm:max-w-[85%]">
      <div
        class="card rounded-2xl rounded-tl-md px-4 py-3"
        :class="message.status === 'error' ? 'border-rose-300/70 dark:border-rose-400/30' : ''"
      >
        <!-- 思维链 -->
        <ThinkingPanel
          v-if="showThinking"
          :content="reasoningText"
          :streaming="streaming && !reasoningDone"
          :duration-ms="thinkingElapsed"
        />

        <!-- 正文 -->
        <div
          v-if="message.content"
          ref="bodyRef"
          class="markdown-body"
          @click="onClick"
          v-html="html"
        />

        <!-- 生成中的打字光标 -->
        <p v-if="streaming && message.content" class="markdown-body">
          <span class="typing-caret text-brand-500 dark:text-cyan-300" />
        </p>

        <!-- 等待首个 token -->
        <p
          v-if="streaming && !message.content && !showThinking"
          class="flex items-center gap-2 text-[13px] text-slate-500 dark:text-slate-400"
        >
          <span class="thinking-shimmer font-medium">{{ statusText }}</span>
        </p>

        <!-- 错误提示 -->
        <p
          v-if="message.status === 'error'"
          class="mt-2 flex items-start gap-1.5 rounded-lg bg-rose-50 px-2.5 py-2 text-[12.5px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
        >
          <Icon name="alert" :size="14" class="mt-0.5" />
          <span>{{ message.errorMessage || '生成失败，请重试' }}</span>
        </p>
      </div>

      <MessageActions
        v-if="!streaming && message.content"
        :content="message.content"
        :can-regenerate="canRegenerate"
        @regenerate="emit('regenerate')"
      />
    </div>
  </div>
</template>
