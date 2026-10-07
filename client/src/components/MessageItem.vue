<script setup lang="ts">
import { computed } from 'vue';
import AssistantBubble from './AssistantBubble.vue';
import UserBubble from './UserBubble.vue';
import type { ChatMessage } from '@/types';

const props = defineProps<{
  message: ChatMessage;
  streaming: boolean;
  canRegenerate: boolean;
}>();

const emit = defineEmits<{
  (event: 'regenerate'): void;
}>();

const isUser = computed(() => props.message.role === 'user');
</script>

<template>
  <div class="fade-in-up">
    <UserBubble v-if="isUser" :message="message" />
    <AssistantBubble
      v-else
      :message="message"
      :streaming="streaming"
      :can-regenerate="canRegenerate"
      @regenerate="emit('regenerate')"
    />
  </div>
</template>
