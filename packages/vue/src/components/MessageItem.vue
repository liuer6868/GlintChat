<script setup lang="ts">
import { computed } from 'vue';
import AssistantBubble from './AssistantBubble.vue';
import UserBubble from './UserBubble.vue';
import type { ChatMessage } from '../core/types.ts';

const props = defineProps<{
  message: ChatMessage;
  streaming: boolean;
  canRegenerate: boolean;
  /** 可选：整体替换 Markdown 渲染实现 */
  renderer?: (source: string) => string;
}>();

const emit = defineEmits<{
  (event: 'regenerate'): void;
}>();

const isUser = computed(() => props.message.role === 'user');
</script>

<template>
  <div class="fade-in-up">
    <UserBubble v-if="isUser" :message="message" :renderer="renderer" />
    <AssistantBubble
      v-else
      :message="message"
      :streaming="streaming"
      :can-regenerate="canRegenerate"
      :renderer="renderer"
      @regenerate="emit('regenerate')"
    />
  </div>
</template>
