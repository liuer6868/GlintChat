<script setup lang="ts">
/** 面板顶部栏：模型选择 + 系统角色设定 + 连接状态（不含宿主品牌与主题控制） */
import { computed } from 'vue';
import Icon from './Icon.vue';
import type { PublicModel } from '../core/types';

const props = defineProps<{
  models: PublicModel[];
  modelId: string;
  systemPrompt: string;
  streaming: boolean;
  status: 'checking' | 'online' | 'offline';
  error: string;
  showSidebarToggle: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:modelId', value: string): void;
  (event: 'edit-system-prompt'): void;
  (event: 'toggle-sidebar'): void;
  (event: 'refresh-models'): void;
}>();

const currentModel = computed(() => props.models.find((model) => model.id === props.modelId));

const statusView = computed(() => {
  if (props.status === 'checking') {
    return { dot: 'bg-amber-400', text: '检测中', cls: 'text-amber-600 dark:text-amber-400' };
  }
  if (props.status === 'online') {
    return {
      dot: 'bg-emerald-500',
      text: '已连接',
      cls: 'text-emerald-600 dark:text-emerald-400',
    };
  }
  return { dot: 'bg-rose-500', text: '未连接', cls: 'text-rose-600 dark:text-rose-400' };
});

const promptBadge = computed(() => {
  const text = props.systemPrompt.trim();
  if (!text) return '未设置角色';
  return text.length > 12 ? `${text.slice(0, 12)}…` : text;
});

function onModelChange(event: Event): void {
  emit('update:modelId', (event.target as HTMLSelectElement).value);
}
</script>

<template>
  <header
    class="flex flex-wrap items-center gap-2 border-b border-slate-200/80 bg-white/70 px-3 py-2.5 backdrop-blur-xl dark:border-white/10 dark:bg-ink-800/60"
  >
    <button
      class="btn-ghost !px-2"
      type="button"
      :title="showSidebarToggle ? '收起会话列表' : '展开会话列表'"
      @click="emit('toggle-sidebar')"
    >
      <Icon name="menu" :size="18" />
    </button>

    <div class="relative">
      <select
        :value="modelId"
        class="field appearance-none !py-1.5 pr-8 pl-3 text-[13px] font-medium"
        aria-label="选择模型"
        :disabled="streaming"
        @change="onModelChange"
      >
        <option v-for="model in models" :key="model.id" :value="model.id">
          {{ model.name }}
        </option>
        <option v-if="models.length === 0" :value="modelId">{{ modelId }}</option>
      </select>
      <Icon
        name="chevron-down"
        :size="14"
        class="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-slate-400"
      />
    </div>

    <span
      v-if="currentModel?.reasoning"
      class="hidden items-center gap-1 rounded-lg bg-violet-100 px-2 py-1 text-[11px] font-medium text-violet-700 sm:inline-flex dark:bg-violet-500/15 dark:text-violet-300"
      title="该模型支持思维链输出"
    >
      <Icon name="brain" :size="13" />
      深度思考
    </span>

    <button
      class="btn-ghost max-w-[14rem] gap-1.5 border border-slate-200/80 text-[12.5px] dark:border-white/10"
      type="button"
      title="编辑系统角色设定"
      @click="emit('edit-system-prompt')"
    >
      <Icon name="edit" :size="14" />
      <span class="truncate">{{ promptBadge }}</span>
    </button>

    <div class="ml-auto flex items-center gap-1.5">
      <span
        class="hidden items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] md:inline-flex"
        :class="statusView.cls"
        :title="error || 'GET /api/health'"
      >
        <span class="size-1.5 rounded-full" :class="statusView.dot" />
        {{ statusView.text }}
      </span>

      <button
        class="btn-ghost !px-2"
        type="button"
        title="重新拉取模型列表"
        @click="emit('refresh-models')"
      >
        <Icon name="refresh" :size="16" />
      </button>

      <!-- 宿主可在这里插入自己的操作（用户菜单等） -->
      <slot name="actions" />
    </div>
  </header>
</template>
