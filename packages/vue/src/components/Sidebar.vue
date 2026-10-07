<script setup lang="ts">
import { computed, ref } from 'vue';
import Icon from './Icon.vue';
import type { ChatSession } from '../core/types';

const props = defineProps<{
  sessions: ChatSession[];
  activeId: string;
  totalMessages: number;
  storageSize: number;
  /** 移动端抽屉是否需要显示 */
  mobileOpen: boolean;
  isDesktop: boolean;
}>();

const emit = defineEmits<{
  (event: 'new-chat'): void;
  (event: 'select', id: string): void;
  (event: 'delete', id: string): void;
  (event: 'clear-all'): void;
  (event: 'rename', id: string, title: string): void;
  (event: 'import'): void;
  (event: 'export'): void;
  (event: 'close'): void;
}>();

const keyword = ref('');
const renamingId = ref('');
const renameValue = ref('');

const filteredSessions = computed(() => {
  const key = keyword.value.trim().toLowerCase();
  if (!key) return props.sessions;
  return props.sessions.filter((session) => session.title.toLowerCase().includes(key));
});

const sizeText = computed(() => {
  const kb = props.storageSize / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
});

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDay) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
  }
  return date.toLocaleDateString('zh-CN', { year: '2-digit', month: '2-digit', day: '2-digit' });
}

function startRename(session: ChatSession): void {
  renamingId.value = session.id;
  renameValue.value = session.title;
}

function commitRename(): void {
  if (!renamingId.value) return;
  const title = renameValue.value.trim();
  if (title) emit('rename', renamingId.value, title);
  renamingId.value = '';
}
</script>

<template>
  <aside
    class="flex h-full w-72 shrink-0 flex-col border-r border-slate-200/80 bg-white/80 backdrop-blur-xl dark:border-white/10 dark:bg-ink-800/70"
  >
    <!-- 品牌区 -->
    <div class="flex items-center gap-2.5 px-4 pt-4 pb-3">
      <div
        class="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-cyan-400 text-white shadow-md shadow-brand-500/25"
      >
        <Icon name="sparkles" :size="18" />
      </div>
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-semibold text-slate-900 dark:text-white">GlintChat</p>
        <p class="truncate text-[11px] text-slate-500 dark:text-slate-400">轻量级 AI 对话助手</p>
      </div>
      <button
        v-if="!isDesktop"
        class="btn-ghost !px-1.5"
        type="button"
        title="收起侧边栏"
        @click="emit('close')"
      >
        <Icon name="close" :size="16" />
      </button>
    </div>

    <!-- 新建对话 -->
    <div class="px-3">
      <button class="btn-primary w-full py-2.5" type="button" @click="emit('new-chat')">
        <Icon name="plus" :size="16" />
        新建对话
      </button>
    </div>

    <!-- 搜索 -->
    <div class="px-3 pt-3">
      <input
        v-model="keyword"
        class="field !py-1.5 text-[13px]"
        type="search"
        placeholder="搜索历史会话…"
        aria-label="搜索历史会话"
      />
    </div>

    <!-- 会话列表 -->
    <nav class="scrollbar-slim mt-3 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
      <p
        v-if="filteredSessions.length === 0"
        class="px-3 py-6 text-center text-xs text-slate-400 dark:text-slate-500"
      >
        {{ keyword ? '没有匹配的会话' : '还没有历史会话' }}
      </p>

      <div
        v-for="session in filteredSessions"
        :key="session.id"
        class="group relative flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-2 text-sm transition"
        :class="
          session.id === activeId
            ? 'bg-brand-50 text-brand-700 shadow-sm dark:bg-white/10 dark:text-white'
            : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5'
        "
        @click="emit('select', session.id)"
        @dblclick="startRename(session)"
      >
        <Icon name="chat" :size="15" class="opacity-70" />
        <div class="min-w-0 flex-1">
          <input
            v-if="renamingId === session.id"
            v-model="renameValue"
            class="field !px-1.5 !py-0.5 text-[13px]"
            @click.stop
            @keydown.enter.prevent="commitRename"
            @keydown.esc.prevent="renamingId = ''"
            @blur="commitRename"
          />
          <template v-else>
            <p class="truncate leading-5">{{ session.title }}</p>
            <p class="flex items-center gap-1 text-[10.5px] text-slate-400 dark:text-slate-500">
              <span>{{ formatTime(session.updatedAt) }}</span>
              <span>·</span>
              <span>{{ session.messages.length }} 条</span>
            </p>
          </template>
        </div>

        <button
          class="btn-ghost !p-1 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
          type="button"
          title="删除该会话"
          @click.stop="emit('delete', session.id)"
        >
          <Icon name="trash" :size="14" />
        </button>
      </div>
    </nav>

    <!-- 底部操作区 -->
    <div class="space-y-2 border-t border-slate-200/80 px-3 py-3 dark:border-white/10">
      <div class="flex items-center justify-between px-1 text-[11px] text-slate-400 dark:text-slate-500">
        <span>{{ sessions.length }} 个会话 · {{ totalMessages }} 条消息</span>
        <span>{{ sizeText }}</span>
      </div>
      <div class="flex gap-2">
        <button class="btn-ghost flex-1 !py-1.5 text-xs" type="button" @click="emit('export')">
          <Icon name="download" :size="14" />
          导出
        </button>
        <button class="btn-ghost flex-1 !py-1.5 text-xs" type="button" @click="emit('import')">
          <Icon name="refresh" :size="14" />
          导入
        </button>
      </div>
      <button class="btn-danger w-full !py-1.5 text-xs" type="button" @click="emit('clear-all')">
        <Icon name="broom" :size="14" />
        清空所有历史
      </button>
    </div>
  </aside>
</template>
