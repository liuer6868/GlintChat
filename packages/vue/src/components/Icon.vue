<script setup lang="ts">
/** 内联 SVG 图标集合，避免引入额外图标库 */
import { computed } from 'vue';

type IconName =
  | 'plus'
  | 'menu'
  | 'close'
  | 'trash'
  | 'broom'
  | 'sun'
  | 'moon'
  | 'send'
  | 'stop'
  | 'settings'
  | 'copy'
  | 'check'
  | 'alert'
  | 'brain'
  | 'chevron-down'
  | 'arrow-down'
  | 'sparkles'
  | 'refresh'
  | 'download'
  | 'edit'
  | 'clock'
  | 'chat'
  | 'shield';

const props = withDefaults(
  defineProps<{
    name: IconName;
    size?: number | string;
    strokeWidth?: number;
  }>(),
  { size: 18, strokeWidth: 1.8 },
);

const paths: Record<IconName, string> = {
  plus: 'M12 5v14M5 12h14',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6L6 18',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2',
  broom: 'M19 4l-6.5 6.5M13 21l-3-3 3-6 3 3-3 6zM8 12l4 4M3 21l3-3',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M18.4 5.6l1.4-1.4M4.2 19.8l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
  send: 'M4 12l16-8-6 16-2.5-6.5L4 12z',
  stop: 'M8 8h8v8H8zM4 12a8 8 0 1 0 16 0 8 8 0 0 0-16 0z',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 2.6 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.7-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.6a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21.4 11a2 2 0 1 1 0 4 1.7 1.7 0 0 0-1.7 1z',
  copy: 'M9 9V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-4M5 9h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z',
  check: 'M5 13l4 4L19 7',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  brain: 'M9.5 3A2.5 2.5 0 0 0 7 5.5v.6A3 3 0 0 0 5 9v1a3 3 0 0 0 1.5 2.6V14a3 3 0 0 0 3 3h.5V3h-.5zM14.5 3A2.5 2.5 0 0 1 17 5.5v.6A3 3 0 0 1 19 9v1a3 3 0 0 1-1.5 2.6V14a3 3 0 0 1-3 3H14V3h.5z',
  'chevron-down': 'M6 9l6 6 6-6',
  'arrow-down': 'M12 5v14M5 12l7 7 7-7',
  sparkles: 'M12 3l1.8 4.8L18.5 9.5 13.8 11 12 16l-1.8-5L5.5 9.5 10.2 7.8 12 3zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z',
  refresh: 'M20 11a8 8 0 1 0-2.3 6.4M20 5v6h-6',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z',
  clock: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  chat: 'M21 12a8 8 0 0 1-8 8H8l-5 3 1.5-4.5A8 8 0 0 1 13 4a8 8 0 0 1 8 8z',
  shield: 'M12 3l8 3v6c0 4.5-3.2 8.3-8 9.5C7.2 20.3 4 16.5 4 12V6l8-3z',
};

const viewBox = '0 0 24 24';
const sizeValue = computed(() => (typeof props.size === 'number' ? `${props.size}px` : props.size));
const d = computed(() => paths[props.name]);
</script>

<template>
  <svg
    :width="sizeValue"
    :height="sizeValue"
    :viewBox="viewBox"
    fill="none"
    :stroke-width="strokeWidth"
    stroke="currentColor"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="shrink-0"
  >
    <path :d="d" />
  </svg>
</template>
