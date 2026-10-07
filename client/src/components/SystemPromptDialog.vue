<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Icon from './Icon.vue';
import { DEFAULT_SYSTEM_PROMPT } from '@/types';

const props = defineProps<{
  open: boolean;
  model: string;
  value: string;
}>();

const emit = defineEmits<{
  (event: 'save', value: string): void;
  (event: 'close'): void;
}>();

const PRESETS: { label: string; value: string }[] = [
  { label: '默认助手', value: DEFAULT_SYSTEM_PROMPT },
  { label: '前端专家', value: '你是一位资深前端工程师，精通 Vue3、TypeScript 与工程化实践，回答时给出可直接运行的代码并解释关键点。' },
  { label: '后端架构师', value: '你是一位后端架构师，擅长 Node.js、数据库设计与高并发方案，回答时先给结论，再给权衡取舍。' },
  { label: '代码审查员', value: '你是严格的代码审查员，逐条指出潜在缺陷、边界情况与性能问题，并给出修改后的代码。' },
  { label: '翻译官', value: '你是专业中英互译译者，只输出译文，保持术语准确、语气自然。' },
  { label: '苏格拉底导师', value: '你用提问引导我思考，不直接给出答案，每次只问一个最关键的问题。' },
];

const draft = ref(props.value);

watch(
  () => props.open,
  (open) => {
    if (open) draft.value = props.value;
  },
  { immediate: true },
);

const charCount = computed(() => draft.value.length);
const dirty = computed(() => draft.value !== props.value);

function save(): void {
  emit('save', draft.value.trim() || DEFAULT_SYSTEM_PROMPT);
}

function applyPreset(value: string): void {
  draft.value = value;
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-6"
        @click.self="emit('close')"
      >
        <div
          class="card w-full max-w-2xl overflow-hidden rounded-b-none p-4 shadow-xl sm:rounded-2xl sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-label="系统角色设定"
          @keydown.esc="emit('close')"
        >
          <div class="mb-3 flex items-start gap-2">
            <div class="min-w-0 flex-1">
              <h2 class="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
                <Icon name="shield" :size="17" class="text-brand-500" />
                系统角色设定
              </h2>
              <p class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                该设定会作为 system 消息随每次请求发送，作用于当前会话（模型：{{ model }}）
              </p>
            </div>
            <button class="btn-ghost !p-1.5" type="button" @click="emit('close')">
              <Icon name="close" :size="16" />
            </button>
          </div>

          <div class="mb-2 flex flex-wrap gap-1.5">
            <button
              v-for="preset in PRESETS"
              :key="preset.label"
              class="rounded-lg border border-slate-200 px-2 py-1 text-[11.5px] text-slate-600 transition hover:border-brand-400 hover:text-brand-600 dark:border-white/10 dark:text-slate-300 dark:hover:border-cyan-400/60 dark:hover:text-cyan-300"
              type="button"
              @click="applyPreset(preset.value)"
            >
              {{ preset.label }}
            </button>
          </div>

          <textarea
            v-model="draft"
            class="scrollbar-slim field h-40 resize-y font-mono text-[13px] leading-6"
            placeholder="例如：你是一个严谨的前端专家，回答附带可运行代码。"
            @keydown.ctrl.enter.prevent="save"
            @keydown.meta.enter.prevent="save"
          />

          <div class="mt-3 flex items-center justify-between gap-2">
            <span class="text-[11px] text-slate-400 dark:text-slate-500">
              {{ charCount }} 字符 · Ctrl/⌘ + Enter 保存
            </span>
            <div class="flex items-center gap-2">
              <button
                class="btn-ghost text-[13px]"
                type="button"
                @click="applyPreset(DEFAULT_SYSTEM_PROMPT)"
              >
                恢复默认
              </button>
              <button class="btn-ghost text-[13px]" type="button" @click="emit('close')">取消</button>
              <button class="btn-primary text-[13px]" type="button" :disabled="!dirty" @click="save">
                <Icon name="check" :size="15" />
                保存设定
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
