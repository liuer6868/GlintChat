#!/usr/bin/env node
/**
 * 通过 CDP 读取某个页面的渲染结果并断言关键内容。
 * 用于：Chrome 无法由 Node 直接拉起的环境（沙箱），改为外部先启动 Chrome，
 * 本脚本只负责连接调试端口。
 *
 * 用法：
 *   node scripts/dom-probe.mjs <url> <标记1> [标记2 ...]
 */
import process from 'node:process';

const [url, ...needles] = process.argv.slice(2);
const PORT = process.env.CDP_PORT || '9333';

if (!url || needles.length === 0) {
  console.error('用法: node scripts/dom-probe.mjs <url> <标记...>');
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  // 等待调试端口
  let targets = null;
  for (let i = 0; i < 40; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (response.ok) {
        targets = await response.json();
        break;
      }
    } catch {
      /* 继续等 */
    }
    await sleep(400);
  }

  if (!targets) throw new Error(`连接不到 Chrome 调试端口 ${PORT}`);

  const page = targets.find((target) => target.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('未找到页面目标');

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('WebSocket 连接失败')), { once: true });
  });

  let id = 0;
  const pending = new Map();
  const logs = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.consoleAPICalled') {
      const args = (message.params?.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ');
      logs.push(`[console.${message.params?.type}] ${args}`);
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const d = message.params?.exceptionDetails;
      logs.push(`[exception] ${d?.exception?.description ?? d?.text ?? ''}`);
    }
    if (message.method === 'Log.entryAdded') {
      const entry = message.params?.entry;
      logs.push(`[log.${entry?.level}] ${entry?.text ?? ''}`);
    }
    if (message.id && pending.has(message.id)) {
      const { resolve } = pending.get(message.id);
      pending.delete(message.id);
      resolve(message.result);
    }
  });

  const send = (method, params = {}) => {
    const messageId = ++id;
    socket.send(JSON.stringify({ id: messageId, method, params }));
    return new Promise((resolve) => pending.set(messageId, { resolve }));
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.navigate', { url });
  await sleep(6000);

  const result = await send('Runtime.evaluate', {
    expression: `(() => ({
      title: document.title,
      html: document.body ? document.body.innerHTML : '',
      text: document.body ? document.body.innerText : '',
    }))()`,
    returnByValue: true,
  });

  const value = result?.result?.value ?? {};
  const haystack = `${value.html ?? ''}\n${value.text ?? ''}`;

  console.log(`页面标题: ${value.title}`);
  console.log(`DOM 长度: ${(value.html ?? '').length}`);

  let failures = 0;
  for (const needle of needles) {
    const ok = haystack.includes(needle);
    if (!ok) failures += 1;
    console.log(`[${ok ? 'PASS' : 'FAIL'}] 包含「${needle}」`);
  }

  console.log('');
  if (logs.length > 0) {
    console.log('页面控制台输出：');
    for (const line of logs.slice(0, 20)) console.log(`  ${line}`);
    console.log('');
  }

  console.log(value.text?.replace(/\s+/g, ' ').slice(0, 400) ?? '(无文本)');
  socket.close();
  process.exit(failures === 0 ? 0 : 1);
}

await main().catch((error) => {
  console.error('[dom-probe] 失败:', error.message);
  process.exit(1);
});
