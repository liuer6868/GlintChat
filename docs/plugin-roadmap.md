# GlintChat 插件化改造方案

> 目标：**同一份代码，既能单独跑成完整应用（现状），又能作为库/插件被其它项目直接引用。**

## 1. 结论：主方案 + 补充方案

| 形态 | 作用 | 结论 |
| --- | --- | --- |
| **pnpm monorepo 多包** | 物理分发结构 | ✅ **主方案**。按需安装，`vue`/`express` 走 peer，不污染宿主依赖 |
| **Vue 插件 API** | 对外接口形态 | ✅ **主方案**。`app.use(GlintChat, {...})` 宿主心智负担最低 |
| Vite 插件 | dev 阶段自动化 | 🔸 阶段 2 的薄壳补充（`plugins: [glintchat()]` 自动挂代理），不作为主方案 |
| 单包多入口 | 分发结构 | ❌ 会被依赖污染：只想用前端的宿主被迫装 `express`/`cors`/`dotenv` |
| Web Component / iframe | 隔离手段 | 🔸 只作为 Shadow DOM 隔离的落地手段，不做分发形态 |

**为什么不是 Vite 插件当主方案**：它只在 dev 阶段闭环，生产环境挂载仍要宿主自己做；而且 dev middleware 代理 SSE 极易踩缓冲坑（本项目 Vite 代理里就得专门设 `Accept-Encoding: identity`）。

## 2. 目标结构

```
GlintChat/
├── packages/
│   ├── core/          @glintchat/core    零运行时依赖：types / storage / stream / sse-parse / markdown
│   ├── vue/           @glintchat/vue     peer: vue        面板组件 + Vue 插件 + 样式
│   ├── server/        @glintchat/server  peer: express(可选)  路由工厂 + fetch handler
│   ├── vite-plugin/   @glintchat/vite    阶段 2
│   └── cli/           @glintchat/cli     bin: glintchat   一条命令独立启动
├── client/            【形态 A 外壳，保留】main.ts + App.vue + index.html + app.css
├── server/            【形态 A 外壳，保留】index.ts = 加载 .env → createChatConfig → createApp → listen
├── scripts/           不动
└── glintchat.mjs/.cmd 不动
```

形态 A 通过「薄壳保留」零成本保住：`client` / `server` 不删，改成只 re-export 新包的入口，`pnpm dev` 与 `glintchat.cmd` 全部不变。

## 3. 分阶段落地

### 阶段 0：解耦（**已完成 ✅**）

这四项是**所有形态的前置条件**，不改就做不成库：

| 项 | 改动 | 状态 |
| --- | --- | --- |
| 服务端配置去掉 import 副作用 | `config.ts` 顶层不再 `import 'dotenv/config'`，改为 `createChatConfig(input)` 纯工厂；`.env` 只在应用外壳 `index.ts` 里通过 `loadEnvFile()` 加载 | ✅ |
| 服务端全局单例 → 显式注入 | `createModelsRouter(config)` / `createChatRouter(config)` / `createCorsOptions(origins)`；不再读模块级 `env`、`models` | ✅ |
| 主题不再在 import 时写 DOM | `useTheme` 改惰性初始化 + 可配置 key/类名/目标元素；`initTheme()` 供入口显式调用 | ✅ |
| 确认弹窗从模块单例 → 实例 | `createConfirmService()` + `provide/inject`，保留默认单例兼容外壳 | ✅ |
| HTTP 客户端运行时可注入 | `createChatClient({ apiBase, headers, fetch })`；默认值改为相对路径 `/api`，不再依赖 `import.meta.env` 固化 | ✅ |

已验证：类型检查、构建、`scripts/test-stream.mjs` 全部通过；`import './dist/config.js'` 不再有副作用、`PORT=0` 也不会抛错。

### 阶段 1：抽包 + 面板组件（形态 A 零回归）

新增：
```
packages/core/{package.json,tsconfig.json,src/index.ts}
packages/core/src/{types,storage,stream,uuid,markdown,sse-parse}.ts
packages/vue/{package.json,tsconfig.json,tsconfig.lib.json}
packages/vue/src/{index.ts,plugin.ts,context.ts}
packages/vue/src/components/*.vue          ← 从 client/src/components 迁入
packages/vue/src/composables/*.ts          ← useSessions / useTheme / useConfirm
packages/vue/src/styles/lib.css            ← 从 main.css 拆出（去掉 preflight）
packages/vue/src/panel/GlintChatPanel.vue  ← 新增自治面板，承接 App.vue 的编排逻辑
```

改动要点：
- `client/src/assets/main.css` 拆成两份：外壳 `app.css`（`@import 'tailwindcss'` + html/body 规则）与库 `lib.css`（只保留组件类与动画，`@layer theme, base, components, utilities` + `@import 'tailwindcss/theme.css' layer(theme)` + `utilities.css ... prefix(gc)`，**不带 preflight**）
- 组件里的 `@/` 别名改相对路径（发布产物里的别名会变成运行时 404）
- 三处 `Teleport to="body"` 改成可注入的 `teleportTarget`（Shadow DOM 模式下必须）
- `markdown.ts` 里 JS 字符串拼的 class（`"code-block group/code"`）要手工加前缀，Tailwind 的 `prefix()` 不会改写 JS 字符串

风险：别名遗漏（`vue-tsc` 会报出来）、Tailwind 扫描路径变化导致类丢失、构建顺序（core 必须先于 client）。

### 阶段 2：隔离 + 库产物

新增 `packages/vue/vite.config.ts`（lib 模式 + `vite-plugin-dts`）、`packages/vite-plugin/`、`scripts/verify-lib.mjs`（构建后断言：产物不含 `import.meta.env` / `process.env`、`dist/style.css` 存在、`.d.ts` 存在）。

样式隔离三档（默认第一档）：
1. 拆分 `@import` 去掉 preflight + `prefix(gc)` + CSS layer ← 默认
2. `.gc-root` 作用域 + `@scope` ← 可选
3. Shadow DOM（`isolation="shadow"`）← 宿主样式完全不可控时

### 阶段 3：发布 + CLI + Serverless

```
packages/server/src/{fetch.ts,express.ts}   fetch handler（Workers/Vercel/Deno/Bun）
packages/cli/src/cli.ts                     bin: glintchat --port 3000 --open
examples/{vue-embed,express-mount,cloudflare-worker}/
docs/embedding.md
```

## 4. 宿主接入长什么样

### 4.1 Vue 项目里嵌入面板

```ts
// main.ts
import GlintChat from '@glintchat/vue';
import '@glintchat/vue/style.css';

app.use(GlintChat, {
  apiBase: '/api/ai',        // 默认 '/api'；跨域时写完整地址
  namespace: 'admin-ai',     // 多实例必须不同
  persist: true,
  globalShortcuts: false,    // 嵌入时建议关掉 Ctrl+K 抢占
});
```

```vue
<GlintChatPanel
  api-base="/api/ai"
  namespace="admin-ai"
  isolation="shadow"
  class="h-[70vh] rounded-xl"
  @message-complete="(m) => track(m)"
  @error="(e) => toast(e.message)"
>
  <template #header-actions><MyUserMenu /></template>
  <template #empty><MyOnboarding /></template>
</GlintChatPanel>
```

### 4.2 已有 Express 项目挂路由

```ts
import { createChatRouter, createModelsRouter, createChatConfig } from '@glintchat/server';

const config = createChatConfig({
  OPENAI_API_KEY: process.env.MY_KEY,
  OPENAI_BASE_URL: 'https://open.bigmodel.cn/api/paas/v4',
  MODELS_JSON: JSON.stringify([
    { id: 'glm-4.7-flash', name: 'GLM-4.7-Flash (免费)', provider: '智谱', reasoning: true },
  ]),
});

app.use('/internal/ai', createModelsRouter(config)); // GET  /internal/ai/models
app.use('/internal/ai', createChatRouter(config));   // POST /internal/ai/chat/stream
```

**注意**：这里完全没有 `process.env` 和 `.env` 的副作用，宿主自己的环境变量不会被碰。

### 4.3 独立启动（形态 A）

```bash
pnpm dev                      # 开发
.\glintchat.cmd dev           # 同上（自动处理 Node/pnpm）
npx @glintchat/cli --open     # 阶段 3 之后：一条命令起完整应用
```

## 5. 三个最容易踩的坑（已在阶段 0 规避）

1. **`import.meta.env` 是编译期替换**。打进库产物后宿主运行时改不了；若留了绝对地址，宿主上线后会请求到用户自己的 localhost。→ 已改为运行时 `apiBase` 注入，默认相对路径。
2. **服务端配置的 import 副作用**。宿主 Serverless 冷启动时若因缺 `.env` 或 `PORT` 形态不同而抛错，宿主整个函数崩掉。→ 已改为纯工厂 + 显式加载。
3. **模块级单例**（确认弹窗、主题）。一页两个面板必然互相干扰。→ 已改为实例 + `provide/inject`，外壳保留默认单例。

## 6. 待确认（动阶段 1 之前）

- 包名 scope：`@glintchat/*` 还是你自己的 npm scope？
- 是否真的要发布到 npm？（不发布也可以只在仓库内用 `workspace:*` 引用，或在别的项目里用 `file:` / git 依赖）
- 宿主主要是 Vue 3 吗？（库的样式隔离与构建按 Vue 3 设计，React 宿主只能走 iframe/Web Component）

确认后即可按阶段 1 的清单开始拆分。
