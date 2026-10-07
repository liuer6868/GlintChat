<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import Icon from './Icon.vue';
import MessageItem from './MessageItem.vue';
import type { ChatMessage, PublicModel } from '../core/types';

const props = defineProps<{
  messages: ChatMessage[];
  modelId: string;
  modelName: string;
  models: PublicModel[];
  streaming: boolean;
  systemPrompt: string;
  error: string;
  /** 可选：整体替换 Markdown 渲染实现 */
  renderer?: (source: string) => string;
}>();

const emit = defineEmits<{
  (event: 'send', text: string): void;
  (event: 'stop'): void;
  (event: 'regenerate'): void;
  (event: 'dismiss-error'): void;
}>();

const MAX_LENGTH = 8000;
const QUICK_PROMPTS = [
  '用三句话解释什么是闭包，并配一段 JavaScript 示例',
  '帮我写一个 Vue3 + TypeScript 的防抖组合式函数',
  '把下面的 SQL 优化一下，并说明索引设计思路：',
  '写一封向客户致歉并说明补偿方案的邮件',
];

const input = ref('');
const scroller = ref<HTMLElement | null>(null);
const autoScroll = ref(true);
const composing = ref(false);
const textarea = ref<HTMLTextAreaElement | null>(null);

const canSend = computed(
  () => !props.streaming && input.value.trim().length > 0 && input.value.length <= MAX_LENGTH,
);

const isEmpty = computed(() => props.messages.length === 0);

/** 自动调整输入框高度（自适应到 8 行） */
function resize(): void {
  const element = textarea.value;
  if (!element) return;
  element.style.height = 'auto';
  element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
}

watch(input, () => nextTick(resize));

const lastMessage = computed<ChatMessage | undefined>(() => props.messages.at(-1));
const lastAssistantId = computed<string | undefined>(() => {
  for (let index = props.messages.length - 1; index >= 0; index -= 1) {
    const message = props.messages[index];
    if (message && message.role === 'assistant') return message.id;
  }
  return undefined;
});

function distanceFromBottom(element: HTMLElement): number {
  return element.scrollHeight - element.scrollTop - element.clientHeight;
}

function onScroll(): void {
  const element = scroller.value;
  if (!element) return;
  autoScroll.value = distanceFromBottom(element) < 80;
}

async function scrollToBottom(behavior: ScrollBehavior = 'auto'): Promise<void> {
  await nextTick();
  const element = scroller.value;
  if (!element) return;
  element.scrollTo({ top: element.scrollHeight, behavior });
  autoScroll.value = true;
}

// 消息数量 / 最后一条内容变化时跟随滚动
watch(
  () => [props.messages.length, lastMessage.value?.content.length, lastMessage.value?.reasoningContent?.length],
  () => {
    if (autoScroll.value) void scrollToBottom('auto');
  },
);

watch(
  () => props.messages.length,
  (length) => {
    if (length > 0) autoScroll.value = true;
  },
);

onMounted(() => {
  void scrollToBottom('auto');
  resize();
});

function submit(): void {
  if (!canSend.value) return;
  const text = input.value.trim();
  input.value = '';
  autoScroll.value = true;
  emit('send', text);
  void nextTick(() => {
    resize();
    textarea.value?.focus();
  });
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey) return;
  // 中文输入法组词中不触发发送
  if (composing.value || event.isComposing) return;
  event.preventDefault();
  submit();
}

function useQuickPrompt(prompt: string): void {
  input.value = prompt;
  void nextTick(() => {
    resize();
    textarea.value?.focus();
  });
}

function focusInput(): void {
  textarea.value?.focus();
}

defineExpose({ focusInput });
</script>

<template>
  <section class="relative flex min-h-0 flex-1 flex-col">
    <!-- 消息滚动区 -->
    <div
      ref="scroller"
      class="scrollbar-slim flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-6"
      @scroll.passive="onScroll"
    >
      <!-- 空状态：宿主可用 #empty 插槽整体替换 -->
      <div
        v-if="isEmpty"
        class="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-5 text-center"
      >
        <slot name="empty">
          <div
            class="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-cyan-400 text-white shadow-lg shadow-brand-500/25"
          >
            <Icon name="sparkles" :size="26" />
          </div>
          <div>
            <h2 class="text-lg font-semibold text-slate-900 dark:text-white">
              和 {{ modelName }} 开始对话
            </h2>
            <p class="mt-1 text-[13px] text-slate-500 dark:text-slate-400">
              历史记录仅保存在本机浏览器，后端不存任何数据
            </p>
          </div>
          <div class="grid w-full gap-2 sm:grid-cols-2">
            <button
              v-for="prompt in QUICK_PROMPTS"
              :key="prompt"
              class="card cursor-pointer px-3.5 py-3 text-left text-[12.5px] leading-5 text-slate-600 transition hover:-translate-y-0.5 hover:border-brand-400 hover:text-brand-700 dark:text-slate-300 dark:hover:border-cyan-400/50 dark:hover:text-cyan-200"
              type="button"
              @click="useQuickPrompt(prompt)"
            >
              {{ prompt }}
            </button>
          </div>
          <p class="text-[11.5px] text-slate-400 dark:text-slate-500">
            当前系统设定：{{ systemPrompt.slice(0, 40) }}{{ systemPrompt.length > 40 ? '…' : '' }}
          </p>
        </slot>
      </div>

      <!-- 消息列表 -->
      <div v-else class="mx-auto flex w-full max-w-3xl flex-col gap-5 pb-2">
        <MessageItem
          v-for="message in messages"
          :key="message.id"
          :message="message"
          :streaming="streaming && message.id === lastMessage?.id"
          :renderer="renderer"
          :can-regenerate="
            !streaming && message.id === lastAssistantId && message.status !== 'error' && !!message.content
          "
          @regenerate="emit('regenerate')"
        />
      </div>
    </div>

    <!-- 回到底部 -->
    <Transition
      enter-active-class="transition duration-150"
      enter-from-class="opacity-0 translate-y-2"
      leave-active-class="transition duration-100"
      leave-to-class="opacity-0 translate-y-2"
    >
      <button
        v-if="!autoScroll && !isEmpty"
        class="btn absolute right-4 bottom-40 z-10 size-9 !rounded-full bg-white/90 shadow-md backdrop-blur dark:bg-ink-800/90 sm:bottom-36"
        type="button"
        title="回到底部"
        @click="scrollToBottom('smooth')"
      >
        <Icon name="arrow-down" :size="16" />
      </button>
    </Transition>

    <!-- 错误提示条 -->
    <div
      v-if="error"
      class="mx-3 mb-1 flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700 sm:mx-6 dark:bg-rose-500/10 dark:text-rose-300"
    >
      <Icon name="alert" :size="15" class="mt-0.5" />
      <span class="flex-1 leading-5">{{ error }}</span>
      <button class="btn-ghost !p-1" type="button" title="关闭" @click="emit('dismiss-error')">
        <Icon name="close" :size="14" />
      </button>
    </div>

    <!-- 输入区 -->
    <div class="border-t border-slate-200/80 bg-white/60 px-3 py-3 backdrop-blur-xl sm:px-6 dark:border-white/10 dark:bg-ink-800/50">
      <div class="mx-auto w-full max-w-3xl">
        <div
          class="card flex items-end gap-2 p-2 transition focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-500/20"
        >
          <textarea
            ref="textarea"
            v-model="input"
            rows="1"
            :maxlength="MAX_LENGTH"
            class="scrollbar-slim max-h-[200px] flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-[14.5px] leading-6 text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
            placeholder="输入问题... (Enter 发送, Shift + Enter 换行)"
            aria-label="输入消息"
            @keydown="onKeydown"
            @compositionstart="composing = true"
            @compositionend="composing = false"
            @input="resize"
          />

          <button
            v-if="streaming"
            class="btn-danger !rounded-xl border border-rose-200 bg-rose-50 !px-3 !py-2 dark:border-rose-400/30 dark:bg-rose-500/10"
            type="button"
            title="停止生成"
            @click="emit('stop')"
          >
            <Icon name="stop" :size="16" />
            <span class="hidden text-[12.5px] sm:inline">停止</span>
          </button>
          <button
            v-else
            class="btn-primary !rounded-xl !px-3.5 !py-2"
            type="button"
            :disabled="!canSend"
            title="发送 (Enter)"
            @click="submit"
          >
            <Icon name="send" :size="16" />
            <span class="hidden text-[12.5px] sm:inline">发送</span>
          </button>
        </div>

        <div class="mt-1.5 flex items-center justify-between px-1 text-[11px] text-slate-400 dark:text-slate-500">
          <span>Enter 发送 · Shift + Enter 换行 · 生成中可点击「停止」中断</span>
          <span :class="input.length > MAX_LENGTH * 0.9 ? 'text-amber-500' : ''">
            {{ input.length }} / {{ MAX_LENGTH }}
          </span>
        </div>
      </div>
    </div>
  </section>
</template>
