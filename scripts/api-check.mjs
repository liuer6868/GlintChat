#!/usr/bin/env node
/**
 * API 一键体检：验证某个 OpenAI 兼容服务是否可用于本项目
 * ---------------------------------------------------------------------------
 * 用法：
 *   node scripts/api-check.mjs --key sk-xxx --base https://api.deepseek.com/v1
 *   node scripts/api-check.mjs --key sk-xxx --base https://open.bigmodel.cn/api/paas/v4 --model glm-4-flash
 *   node scripts/api-check.mjs --preset siliconflow --key sk-xxx
 *   node scripts/api-check.mjs --list-presets
 *   node scripts/api-check.mjs --base http://127.0.0.1:11434/v1 --key ollama   # 本地 Ollama
 *
 * 会依次检查：
 *   1) GET  {base}/models          服务可达性与模型清单（失败不致命）
 *   2) POST {base}/chat/completions 非流式，能否正常回答
 *   3) POST {base}/chat/completions stream:true，SSE 增量是否正常
 *   4) 探测是否返回 reasoning_content（思维链，决定前端是否显示「深度思考」面板）
 * 最后打印可直接粘贴进 server/.env 的配置片段。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TIMEOUT_MS = 45_000;

/* --------------------------- 常见渠道预设 --------------------------- */

const PRESETS = {
  zhipu: {
    label: '智谱 AI BigModel（推荐主力·永久免费模型）',
    base: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4.7-flash',
    note: 'glm-4.7-flash 免费、200K 上下文、支持 thinking 思维链；旧 glm-4-flash/4.5-flash 已下线',
  },
  siliconflow: {
    label: '硅基流动 SiliconFlow',
    base: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen3-8B',
    note: '免费模型限流较宽松（约 1000 RPM）；注意旧的 Qwen2.5-7B-Instruct 已转为付费',
  },
  modelscope: {
    label: 'ModelScope 魔搭（免费 API-Inference）',
    base: 'https://api-inference.modelscope.cn/v1',
    model: 'Qwen/Qwen3.5-27B',
    note: '需绑定阿里云账号并实名，约 2000 次/天（单模型 ≤500）',
  },
  dashscope: {
    label: '阿里云百炼 DashScope（OpenAI 兼容）',
    base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-turbo',
    note: '新用户一次性赠送额度；官方推荐改用 {WorkspaceId}.cn-beijing.maas.aliyuncs.com，且 Key 与地域绑定（跨区报 401）',
  },
  volcengine: {
    label: '火山引擎方舟（豆包）',
    base: 'https://ark.cn-beijing.volces.com/api/v3',
    model: '',
    note: '必须用 --model 指定你控制台里的模型名或推理接入点 ID（如 doubao-seed-2.0-code）',
  },
  hunyuan: {
    label: '腾讯混元',
    base: 'https://api.hunyuan.cloud.tencent.com/v1',
    model: 'hunyuan-turbos-latest',
    note: '一次性赠送额度（1 年有效），默认并发仅 5；老接口计划 2026-12 下线',
  },
  deepseek: {
    label: 'DeepSeek 官方（无免费额度，按量付费）',
    base: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    note: 'deepseek-reasoner 支持思维链；新模型 deepseek-flash 支持 1M 上下文',
  },
  openrouter: {
    label: 'OpenRouter（含 :free 模型）',
    base: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    note: '免费模型共享配额（约 20 RPM / 50~200 RPD），大陆访问不稳定',
  },
  gemini: {
    label: 'Google AI Studio Gemini（免费层）',
    base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    note: '免注册门槛低，但免费层数据会被用于训练（含人工审阅），勿传隐私数据；大陆需自备网络',
  },
  groq: {
    label: 'Groq',
    base: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    note: '免费层无需信用卡，速度极快，但 TPM 偏低',
  },
  cerebras: {
    label: 'Cerebras',
    base: 'https://api.cerebras.ai/v1',
    model: 'gpt-oss-120b',
    note: '免费层无需信用卡，日额度较大（约 14,400 RPD）',
  },
  moonshot: {
    label: 'Moonshot Kimi（无免费额度）',
    base: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    note: '需充值；平台已迁移至 platform.kimi.com，base_url 请以控制台为准',
  },
  ollama: {
    label: '本地 Ollama',
    base: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:7b',
    note: '完全离线免费；推理模型可试 deepseek-r1:7b',
  },
  lmstudio: {
    label: '本地 LM Studio',
    base: 'http://localhost:1234/v1',
    model: 'local-model',
    note: '完全离线免费，需在 LM Studio 里启动本地服务',
  },
  vllm: {
    label: '本地 vLLM',
    base: 'http://localhost:8000/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    note: '自建推理服务，OpenAI 兼容',
  },
};

/* ------------------------------- 参数解析 ------------------------------- */

function parseArgs(argv) {
  const options = { key: '', base: '', model: '', preset: '', listPresets: false, skipStream: false };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = () => argv[++i] ?? '';

    if (token === '--key' || token === '-k') options.key = next();
    else if (token === '--base' || token === '-b') options.base = next();
    else if (token === '--model' || token === '-m') options.model = next();
    else if (token === '--preset' || token === '-p') options.preset = next();
    else if (token === '--list-presets') options.listPresets = true;
    else if (token === '--no-stream') options.skipStream = true;
    else if (token === '--help' || token === '-h') options.help = true;
  }

  return options;
}

const colors = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  red: '\u001b[31m',
  cyan: '\u001b[36m',
};
const paint = (color, text) => (process.stdout.isTTY ? `${colors[color]}${text}${colors.reset}` : text);

const ok = (text) => console.log(`  ${paint('green', '✔')} ${text}`);
const bad = (text) => console.log(`  ${paint('red', '✘')} ${text}`);
const warn = (text) => console.log(`  ${paint('yellow', '!')} ${text}`);
const info = (text) => console.log(`  ${paint('dim', text)}`);

/** 从 server/.env 里读默认值，方便直接体检当前配置 */
function readEnvFile() {
  const file = join(ROOT, 'server', '.env');
  if (!existsSync(file)) return {};

  const result = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match) continue;
    const value = (match[2] ?? '').trim().replace(/^["']|["']$/g, '');
    result[match[1]] = value;
  }
  return result;
}

/* ------------------------------- 检测逻辑 ------------------------------- */

async function withTimeout(url, init = {}, ms = TIMEOUT_MS) {
  const signal = AbortSignal.timeout(ms);
  return fetch(url, { ...init, signal });
}

/** 1) 模型列表 */
async function checkModels(base, key) {
  try {
    const response = await withTimeout(`${base}/models`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    });

    if (!response.ok) {
      bad(`GET /models 返回 HTTP ${response.status}（不影响对话，可忽略）`);
      return [];
    }

    const payload = await response.json().catch(() => null);
    const list = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
    const ids = list.map((item) => item?.id).filter((id) => typeof id === 'string');

    ok(`GET /models 正常，共 ${ids.length} 个模型`);
    if (ids.length > 0) {
      const preview = ids.slice(0, 8).join(', ');
      info(`前几个模型：${preview}${ids.length > 8 ? ` …（共 ${ids.length} 个）` : ''}`);
    }
    return ids;
  } catch (error) {
    bad(`GET /models 失败：${error.message}`);
    return [];
  }
}

/** 2) 非流式对话 */
async function checkChat(base, key, model) {
  try {
    const response = await withTimeout(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: '只回复两个字：可用' }],
        max_tokens: 32,
        stream: false,
      }),
    });

    const text = await response.text();
    const contentType = response.headers.get('content-type') ?? '';

    if (!response.ok) {
      bad(`POST /chat/completions 返回 HTTP ${response.status}`);
      info(text.slice(0, 300));
      if (response.status === 404) {
        warn('404 通常是 base_url 少写或多写了路径段，例如应为 https://host/v1');
      }
      if (response.status === 401 || response.status === 403) {
        warn('鉴权失败：检查 Key 是否正确、是否已实名/开通该模型');
      }
      return { ok: false, status: response.status };
    }

    // 有些服务商忽略 stream:false，仍然返回 SSE；这不算错，友好提示即可
    if (contentType.includes('text/event-stream') || text.trimStart().startsWith('data:')) {
      warn('该服务在 stream:false 时仍返回流式响应（服务端行为，不影响本项目使用）');
      return { ok: true, streamOnly: true };
    }

    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      bad('返回内容不是 JSON，可能不是 OpenAI 兼容接口');
      info(text.slice(0, 200));
      return { ok: false };
    }

    if (payload?.error) {
      bad(`服务返回错误：${payload.error.message ?? JSON.stringify(payload.error).slice(0, 200)}`);
      return { ok: false };
    }

    const content = payload?.choices?.[0]?.message?.content ?? '';
    if (!content) {
      bad('响应里没有 choices[0].message.content，可能模型名不被支持');
      info(JSON.stringify(payload).slice(0, 300));
      return { ok: false };
    }

    ok(`POST /chat/completions 正常，模型回答：${JSON.stringify(String(content).slice(0, 40))}`);
    if (payload?.usage) {
      info(
        `用量：prompt ${payload.usage.prompt_tokens ?? '?'} + completion ${payload.usage.completion_tokens ?? '?'} tokens`,
      );
    }
    return { ok: true };
  } catch (error) {
    bad(`POST /chat/completions 失败：${error.message}`);
    return { ok: false };
  }
}

/** 3) 流式对话 + 思维链探测 */
async function checkStream(base, key, model) {
  const started = Date.now();

  try {
    const response = await withTimeout(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: '用一句话说明什么是 SSE。' }],
        stream: true,
        max_tokens: 64,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      bad(`流式请求返回 HTTP ${response.status}`);
      info(detail.slice(0, 300));
      return { ok: false };
    }

    if (!response.body) {
      bad('流式请求没有响应体');
      return { ok: false };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let reasoning = '';
    let chunks = 0;
    let sawDone = false;
    let firstChunkMs = 0;

    outer: for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');

        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        if (data === '[DONE]') {
          sawDone = true;
          break outer;
        }

        let event;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }

        const delta = event?.choices?.[0]?.delta ?? {};
        if (typeof delta.reasoning_content === 'string') reasoning += delta.reasoning_content;
        if (typeof delta.reasoning === 'string') reasoning += delta.reasoning;
        if (typeof delta.content === 'string' && delta.content) {
          content += delta.content;
          chunks += 1;
          if (firstChunkMs === 0) firstChunkMs = Date.now() - started;
        }
      }
    }

    if (chunks === 0) {
      bad('没有收到任何增量内容（可能模型名不对，或该渠道不支持 stream）');
      return { ok: false };
    }

    ok(`流式正常：${chunks} 个增量、${content.length} 字，首字延迟约 ${firstChunkMs}ms`);
    info(`内容片段：${JSON.stringify(content.slice(0, 60))}`);
    if (!sawDone) warn('未收到标准 [DONE] 结束标记（不影响使用）');

    if (reasoning) {
      ok(`检测到思维链字段，共 ${reasoning.length} 字 —— 前端会显示「深度思考」面板`);
      info(`思维链片段：${JSON.stringify(reasoning.slice(0, 60))}`);
    } else {
      info('未检测到 reasoning_content（该模型不是推理模型，属正常）');
    }

    return { ok: true, reasoning: reasoning.length > 0 };
  } catch (error) {
    bad(`流式请求失败：${error.message}`);
    return { ok: false };
  }
}

/* ------------------------------- 主流程 ------------------------------- */

const options = parseArgs(process.argv.slice(2));

if (options.listPresets || options.help) {
  console.log('');
  console.log(paint('cyan', '  GlintChat API 体检 · 内置渠道预设'));
  console.log(`  ${paint('dim', '─'.repeat(72))}`);
  for (const [name, preset] of Object.entries(PRESETS)) {
    console.log(`  ${name.padEnd(14)} ${preset.label}`);
    console.log(`  ${' '.repeat(14)} ${paint('dim', `${preset.base}  →  ${preset.model}`)}`);
    console.log(`  ${' '.repeat(14)} ${paint('dim', preset.note)}`);
  }
  console.log('');
  console.log('  用法: node scripts/api-check.mjs --preset <名字> --key <你的Key>');
  console.log('        node scripts/api-check.mjs --base <base_url> --key <Key> --model <模型id>');
  console.log('');
  process.exit(0);
}

const envFile = readEnvFile();
const preset = options.preset ? PRESETS[options.preset] : undefined;

if (options.preset && !preset) {
  console.error(paint('red', `[api-check] 未知预设「${options.preset}」，用 --list-presets 查看可用预设`));
  process.exit(1);
}

const base = (options.base || preset?.base || envFile.OPENAI_BASE_URL || '').replace(/\/+$/, '');
const key = options.key || preset?.key || envFile.OPENAI_API_KEY || '';
const model = options.model || preset?.model || '';

if (!base) {
  console.error(paint('red', '[api-check] 缺少 base_url：用 --base 指定，或 --preset <名字>'));
  console.error('             node scripts/api-check.mjs --list-presets');
  process.exit(1);
}

console.log('');
console.log(paint('cyan', '  GlintChat API 体检'));
console.log(`  ${paint('dim', '─'.repeat(72))}`);
console.log(`  接口地址 : ${base}`);
console.log(`  API Key  : ${key ? `${key.slice(0, 6)}…${key.slice(-4)}` : paint('yellow', '(未提供，部分渠道本地服务可留空)')}`);
console.log(`  测试模型 : ${model || paint('yellow', '(未指定，将从 /models 里挑一个)')}`);
if (preset) console.log(`  预设说明 : ${paint('dim', preset.note)}`);
if (!options.key && envFile.OPENAI_API_KEY) info('Key 来自 server/.env（可用 --key 覆盖）');
console.log(`  ${paint('dim', '─'.repeat(72))}`);

let activeModel = model;

// 1) 模型列表
const modelIds = await checkModels(base, key);

// 没指定模型时，从列表里挑一个「看起来能聊天」的
if (!activeModel && modelIds.length > 0) {
  const preferred =
    modelIds.find((id) => /flash|turbo|mini|free|instruct|chat/i.test(id)) ?? modelIds[0];
  activeModel = preferred;
  warn(`未指定模型，自动选用：${activeModel}`);
}

if (!activeModel) {
  console.log('');
  bad('无法确定要测试的模型，请用 --model 指定（例如 --model glm-4-flash）');
  console.log('');
  process.exit(1);
}

// 2) 非流式
const chatResult = await checkChat(base, key, activeModel);

// 3) 流式
let streamResult = { ok: false, reasoning: false };
if (!options.skipStream) {
  streamResult = await checkStream(base, key, activeModel);
}

/* ------------------------------- 结论 ------------------------------- */

const passed = chatResult.ok && streamResult.ok;

console.log('');
console.log(`  ${paint('dim', '─'.repeat(72))}`);
const verdict = passed
  ? paint('green', '结论：该渠道可直接用于 GlintChat ✔')
  : paint('red', '结论：该渠道当前不可用 ✘（看上面的失败原因）');
console.log(`  ${verdict}`);
console.log('');

if (passed) {
  console.log(`  ${paint('cyan', '把下面几行写进 server/.env 即可：')}`);
  console.log('');
  console.log(`    OPENAI_API_KEY="${options.key || key || 'your-key'}"`);
  console.log(`    OPENAI_BASE_URL="${base}"`);
  if (streamResult.reasoning) {
    console.log(`    # 该模型支持思维链，前端会自动显示「深度思考」面板`);
  }
  console.log('');
  console.log(`  ${paint('cyan', '可选：把它作为下拉框里的一个模型（MODELS_JSON 示例）')}`);
  console.log('');
  console.log(
    `    MODELS_JSON='[{"id":"${activeModel}","name":"${preset?.label ?? activeModel}","description":"${preset?.note ?? ''}","provider":"${options.preset ?? 'custom'}","reasoning":${streamResult.reasoning}}]'`,
  );
  console.log('');
}

process.exit(passed ? 0 : 1);
