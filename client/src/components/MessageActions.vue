<script setup lang="ts">
import { computed, ref } from 'vue';
import Icon from './Icon.vue';

const props = defineProps<{
  content: string;
  /** 是否允许重新生成（最后一条 assistant 消息且未在生成中） */
  canRegenerate: boolean;
}>();

const emit = defineEmits<{
  (event: 'regenerate'): void;
}>();

const copied = ref(false);

async function copy(): Promise<void> {
  if (!props.content) return;
  try {
    await navigator.clipboard.writeText(props.content);
  } catch {
    // 回退方案：clipboard API 在非 https 或旧浏览器不可用
    const textarea = document.createElement('textarea');
    textarea.value = props.content;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
  copied.value = true;
  window.setTimeout(() => (copied.value = false), 1600);
}

const charText = computed(() => `${props.content.length} 字`);
</script>

<template>
  <div class="mt-1.5 flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500">
    <button
      class="btn-ghost !gap-1 !px-1.5 !py-0.5 text-[11px]"
      type="button"
      :title="copied ? '已复制' : '复制回答'"
      @click="copy"
    >
      <Icon :name="copied ? 'check' : 'copy'" :size="13" />
      {{ copied ? '已复制' : '复制' }}
    </button>

    <button
      v-if="canRegenerate"
      class="btn-ghost !gap-1 !px-1.5 !py-0.5 text-[11px]"
      type="button"
      title="重新生成这条回答"
      @click="emit('regenerate')"
    >
      <Icon name="refresh" :size="13" />
      重新生成
    </button>

    <span class="ml-auto tabular-nums opacity-80">{{ charText }}</span>
  </div>
</template>
