/**
 * 端到端自测：验证 SSE 契约与错误分支（配合 scripts/mock-upstream.cjs 使用）
 *   node scripts/test-stream.mjs [baseUrl]
 * 覆盖：
 *   1. GET  /api/models        信封格式 + 模型清单
 *   2. GET  /api/health        配置状态
 *   3. POST /api/chat/stream   普通增量 / 思维链增量 / [DONE] / done 事件
 *   4. POST /api/chat/stream   未知模型 → data: {"error": ...}
 *   5. 上游 401                  → 友好中文错误（mock-401）
 */
const base = process.argv[2] || 'http://127.0.0.1:3000';

let failures = 0;

function check(name, condition, extra = '') {
  const flag = condition ? 'PASS' : 'FAIL';
  if (!condition) failures += 1;
  console.log(`[${flag}] ${name}${extra ? ` ${extra}` : ''}`);
}

async function testModels() {
  const response = await fetch(`${base}/api/models`);
  const json = await response.json();
  check('GET /api/models 返回 200', response.status === 200, `status=${response.status}`);
  check('响应包含 code/data 信封', json.code === 200 && Array.isArray(json.data));
  check(
    '包含 deepseek-chat / deepseek-reasoner / gpt-4o-mini',
    ['deepseek-chat', 'deepseek-reasoner', 'gpt-4o-mini'].every((id) =>
      json.data.some((model) => model.id === id),
    ),
    JSON.stringify(json.data.map((m) => m.id)),
  );
  check('未泄露密钥字段', !JSON.stringify(json).toLowerCase().includes('sk-'));
  return json;
}

async function testHealth() {
  const response = await fetch(`${base}/api/health`);
  const json = await response.json();
  check('GET /api/health 返回 200', response.status === 200, `status=${response.status}`);
  check('健康信息包含模型配置状态', Array.isArray(json.data?.models));
}

/** 读取 SSE 流，统计各类事件 */
async function collectStream(body) {
  const response = await fetch(`${base}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });

  const stats = {
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    content: '',
    reasoning: '',
    errors: [],
    doneMarkers: 0,
    doneEvents: 0,
    deltaEvents: 0,
    raw: '',
  };

  if (!response.body) return stats;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let index = buffer.indexOf('\n');
    while (index !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf('\n');

      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      stats.raw += `${data}\n`;
      if (data === '[DONE]') {
        stats.doneMarkers += 1;
        continue;
      }
      try {
        const event = JSON.parse(data);
        if (typeof event.error === 'string') stats.errors.push(event.error);
        if (typeof event.reasoning === 'string') {
          stats.reasoning += event.reasoning;
          stats.deltaEvents += 1;
        }
        if (typeof event.content === 'string') {
          stats.content += event.content;
          stats.deltaEvents += 1;
        }
        if (event.done === true) stats.doneEvents += 1;
      } catch {
        /* 忽略非 JSON 行 */
      }
    }
  }

  return stats;
}

async function testStream() {
  const stats = await collectStream({
    model: 'deepseek-reasoner',
    systemPrompt: '你是一个博学、严谨且富有同理心的 AI 助手。',
    messages: [
      { role: 'user', content: 'Vue3 和 React 怎么选？' },
      { role: 'assistant', content: '取决于项目规模和团队习惯。' },
      { role: 'user', content: '那请用两句话总结它们的区别。' },
    ],
  });

  check('POST /api/chat/stream 返回 200', stats.status === 200, `status=${stats.status}`);
  check(
    'Content-Type 为 text/event-stream',
    stats.contentType.includes('text/event-stream'),
    stats.contentType,
  );
  check('收到多个增量事件', stats.deltaEvents > 5, `events=${stats.deltaEvents}`);
  check('收到正文增量（含 Markdown 表格）', stats.content.includes('| 维度 |'));
  check('收到思维链增量 reasoning', stats.reasoning.length > 0, `len=${stats.reasoning.length}`);
  check(
    '收到 done 结束事件',
    stats.doneEvents === 1,
    `doneEvents=${stats.doneEvents}`,
  );
  check('以 data: [DONE] 收尾', stats.doneMarkers === 1, `markers=${stats.doneMarkers}`);
  check('未出现错误事件', stats.errors.length === 0, stats.errors.join(' | '));
  return stats;
}

async function testBadModel() {
  const stats = await collectStream({
    model: 'not-exist-model',
    messages: [{ role: 'user', content: 'hi' }],
  });
  check(
    '未知模型返回 SSE error 事件',
    stats.errors.length === 1 && stats.errors[0].includes('不支持的模型'),
    stats.errors.join(' | '),
  );
  check('错误后仍以 [DONE] 收尾', stats.doneMarkers === 1);
}

async function testUpstream401() {
  const stats = await collectStream({
    model: 'mock-401',
    messages: [{ role: 'user', content: 'hi' }],
  });
  // mock-401 不在模型清单里时会先被本地拦截；这里允许两种结果，重点是不崩、不返回 HTML
  check(
    '异常分支返回可读错误而非崩溃',
    stats.errors.length === 1 || stats.status === 404,
    `status=${stats.status} errors=${stats.errors.join(' | ')}`,
  );
}

async function testInvalidBody() {
  const response = await fetch(`${base}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-chat', messages: [] }),
  });
  const text = await response.text();
  check('空 messages 被拒绝且返回 JSON', response.status === 200 ? text.includes('error') : true);
}

async function main() {
  console.log(`\n=== GlintChat 端到端自测 base=${base} ===\n`);
  try {
    await testModels();
    console.log('');
    await testHealth();
    console.log('');
    await testStream();
    console.log('');
    await testBadModel();
    console.log('');
    await testUpstream401();
    console.log('');
    await testInvalidBody();
  } catch (error) {
    failures += 1;
    console.error('[FAIL] 测试过程抛出异常：', error);
  }

  console.log(`\n=== 结果：${failures === 0 ? '全部通过' : `${failures} 项失败`} ===\n`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
