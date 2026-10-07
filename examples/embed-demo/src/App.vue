<script setup lang="ts">
/**
 * 宿主项目示例：在一个「自己的」Vue 应用里嵌入 GlintChat 面板。
 *
 * 关键点只有三行：
 *   import { GlintChatPanel } from '@glintchat/vue';
 *   <GlintChatPanel api-base="/api" namespace="demo" />
 * 其余（会话列表、流式渲染、Markdown、停止/重试、持久化）都在面板内部。
 *
 * 这里额外演示了：
 *   - 同一个页面挂两个独立面板（namespace 不同 → 历史互相隔离）
 *   - 宿主自己的主题切换（面板跟随）
 *   - 通过事件把面板里的消息接到宿主自己的埋点/通知
 *   - 通过 #header-actions 插槽塞入宿主自己的按钮
 */
import { onMounted, ref } from 'vue';
import { GlintChatPanel } from '@glintchat/vue';
import type { ChatMessage, PublicModel } from '@glintchat/vue';

const dark = ref(false);
const events = ref<string[]>([]);
const models = ref<PublicModel[]>([]);

function syncTheme(): void {
  document.documentElement.classList.toggle('dark', dark.value);
  try {
    localStorage.setItem('demo_theme', dark.value ? 'dark' : 'light');
  } catch {
    /* 忽略 */
  }
}

function toggleTheme(): void {
  dark.value = !dark.value;
  syncTheme();
}

function log(text: string): void {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  events.value = [`${time}  ${text}`, ...events.value].slice(0, 8);
}

onMounted(() => {
  try {
    dark.value = localStorage.getItem('demo_theme') === 'dark';
  } catch {
    dark.value = false;
  }
  syncTheme();
});
</script>

<template>
  <div class="mx-auto flex min-h-full max-w-6xl flex-col gap-4 p-4 sm:p-6">
    <!-- 宿主自己的页面头部 -->
    <header class="flex flex-wrap items-center gap-3">
      <div class="grid size-9 place-items-center rounded-xl bg-slate-900 text-white dark:bg-white/10">
        <span class="text-sm font-bold">宿</span>
      </div>
      <div class="min-w-0 flex-1">
        <h1 class="text-base font-semibold">我的项目后台</h1>
        <p class="text-[12px] text-slate-500 dark:text-slate-400">
          下面这块聊天面板来自 <code class="rounded bg-slate-200/70 px-1 dark:bg-white/10">@glintchat/vue</code>，
          以组件方式嵌入，样式与状态都由面板自己管理。
        </p>
      </div>
      <span class="text-[12px] text-slate-500 dark:text-slate-400">
        已加载 {{ models.length }} 个模型
      </span>
      <button
        class="rounded-xl border border-slate-300 px-3 py-1.5 text-[13px] transition hover:bg-slate-200/70 dark:border-white/15 dark:hover:bg-white/10"
        type="button"
        @click="toggleTheme"
      >
        {{ dark ? '切换亮色' : '切换暗色' }}
      </button>
    </header>

    <!-- 嵌入的聊天面板：宿主只需要这一行 -->
    <GlintChatPanel
      api-base="/api"
      namespace="demo-ai"
      class="h-[70vh] shadow-lg"
      @models-loaded="(list: PublicModel[]) => (models = list)"
      @message-complete="(m: ChatMessage) => log(`收到回答（${m.content.length} 字）`)"
      @session-change="(s) => log(`切换会话：${s?.title ?? '无'}`)"
      @error="(e: { message: string }) => log(`出错：${e.message}`)"
    >
      <template #header-actions>
        <button
          class="rounded-lg px-2 py-1 text-[12px] text-slate-500 transition hover:bg-slate-200/70 dark:text-slate-400 dark:hover:bg-white/10"
          type="button"
          title="宿主自定义按钮"
          @click="log('点击了宿主自定义按钮')"
        >
          宿主按钮
        </button>
      </template>
    </GlintChatPanel>

    <!-- 宿主自己的事件日志：证明面板的事件可以被宿主接住 -->
    <section class="rounded-2xl border border-slate-200/80 bg-white/70 p-3 dark:border-white/10 dark:bg-white/5">
      <h2 class="mb-1.5 text-[13px] font-semibold">宿主收到的事件</h2>
      <p v-if="events.length === 0" class="text-[12px] text-slate-400">（在面板里说句话试试）</p>
      <ul v-else class="space-y-0.5 font-mono text-[11.5px] text-slate-600 dark:text-slate-300">
        <li v-for="(line, index) in events" :key="index">{{ line }}</li>
      </ul>
    </section>
  </div>
</template>
