/**
 * 本地假上游（OpenAI 兼容）服务，仅用于开发自测：
 *   node scripts/mock-upstream.cjs
 * 然后让后端指向它：
 *   OPENAI_BASE_URL="http://127.0.0.1:8787/v1"  OPENAI_API_KEY="sk-mock"  npm run dev:server
 *
 * 它会按 OpenAI / DeepSeek 的 SSE 格式返回思维链 + 正文 + usage，
 * 用于验证「后端透传 → 前端打字机渲染」整条链路，无需真实 API Key。
 */
const http = require('node:http');

const PORT = Number(process.env.MOCK_PORT || 8787);
const CHUNK_DELAY_MS = Number(process.env.MOCK_DELAY || 10);

const ANSWER = [
  '## 结论\n\n',
  '**Vue 3** 与 **React** 的主要区别在于「模板 vs JSX」与「响应式系统」：\n\n',
  '| 维度 | Vue 3 | React |\n| --- | --- | --- |\n',
  '| 模板 | SFC 模板 + 指令 | JSX 表达式 |\n',
  '| 更新粒度 | 组件级 + 编译优化 | 组件级 diff |\n\n',
  '下面是一段可直接运行的 Vue 3 组合式函数：\n\n',
  '```ts\n// 防抖组合式函数\n',
  'import { ref, watch } from "vue";\n\n',
  'export function useDebounced<T>(source: Ref<T>, delay = 300) {\n',
  '  const value = ref(source.value);\n',
  '  let timer: number | undefined;\n',
  '  watch(source, (next) => {\n',
  '    window.clearTimeout(timer);\n',
  '    timer = window.setTimeout(() => (value.value = next), delay);\n',
  '  });\n',
  '  return value;\n}\n```\n\n',
  '> 小结：小团队、重交付速度选 Vue；生态与人才池更大选 React。\n',
];

const THINKING = '用户想比较 Vue3 和 React；先给结论，再给对比表，最后补一段可运行代码。';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sseChunk(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

const server = http.createServer((req, res) => {
  // OpenAI 兼容的模型列表，方便 scripts/api-check.mjs 这类工具做体检
  if (req.url && req.url.endsWith('/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        object: 'list',
        data: [
          { id: 'mock-fast', object: 'model', owned_by: 'mock' },
          { id: 'deepseek-chat', object: 'model', owned_by: 'mock' },
          { id: 'deepseek-reasoner', object: 'model', owned_by: 'mock' },
          { id: 'mock-slow', object: 'model', owned_by: 'mock' },
        ],
      }),
    );
    return;
  }

  if (!req.url || !req.url.endsWith('/chat/completions')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'mock: not found' } }));
    return;
  }

  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });

  req.on('end', async () => {
    const auth = req.headers.authorization || '';
    console.log(`[mock] ${req.method} ${req.url} auth=${auth.slice(0, 12)}`);

    let parsed = {};
    try {
      parsed = JSON.parse(body || '{}');
    } catch (error) {
      console.error('[mock] 请求体解析失败:', error.message);
    }

    // 方便测试后端错误分支：model 传 "mock-401" 即返回 401
    if (parsed.model === 'mock-401') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'mock: invalid api key' } }));
      return;
    }

    // 非流式请求：一次性返回完整答案（用于 api-check 的第二步）
    if (parsed.stream !== true) {
      const answer = THINKING + '\n\n' + ANSWER.join('');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          id: 'mock-completion',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: parsed.model || 'mock-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: answer },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 42, completion_tokens: 128, total_tokens: 170 },
        }),
      );
      console.log('[mock] 非流式响应完成');
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    const base = {
      id: 'mock-completion',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: parsed.model || 'mock-model',
    };

    let closed = false;
    // 注意：req 的 close 在请求体读完后就可能触发，不能用它判断客户端断开，
    // 必须监听 res 的 close（且此时响应尚未写完）。
    res.on('close', () => {
      if (!res.writableEnded) {
        closed = true;
        console.log('[mock] 客户端提前断开');
      }
    });

    try {
      // 1) 思维链逐字输出
      for (const char of THINKING) {
        if (closed) return;
        res.write(sseChunk({ ...base, choices: [{ index: 0, delta: { reasoning_content: char }, finish_reason: null }] }));
        await sleep(CHUNK_DELAY_MS);
      }

      // 2) 正文按片段输出
      for (const piece of ANSWER) {
        if (closed) return;
        res.write(sseChunk({ ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] }));
        await sleep(CHUNK_DELAY_MS * 3);
      }

      // 3) 结束帧 + usage
      res.write(sseChunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
      res.write(
        sseChunk({
          ...base,
          choices: [],
          usage: { prompt_tokens: 42, completion_tokens: 256, total_tokens: 298 },
        }),
      );
      res.write('data: [DONE]\n\n');
      res.end();
      console.log('[mock] 流结束');
    } catch (error) {
      console.error('[mock] 写入失败:', error.name, error.message);
      try {
        res.end();
      } catch {
        /* 连接可能已断开 */
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`[mock] 假上游已启动: http://127.0.0.1:${PORT}/v1/chat/completions`);
  console.log(`[mock] 分片间隔 ${CHUNK_DELAY_MS}ms（可用 MOCK_DELAY 调整）`);
});
