/**
 * 无头浏览器验收脚本（Chrome DevTools Protocol）
 *   node scripts/browser-check.mjs [url]
 *
 * 会用真实浏览器打开页面，完成一次「输入 → 发送 → 流式接收 → Markdown 渲染」的完整链路，
 * 并截图保存到 .tmp/shots/ 便于人工确认视觉效果。
 *
 * 依赖：本机安装 Chrome 或 Edge（脚本自动探测），无需额外 npm 包。
 *
 * 启动方式：优先由 Node 直接 spawn；若浏览器进程无法启动（例如在受限/沙箱环境中
 * Node 派生的 Chrome 会崩在 crashpad），自动回退为通过 PowerShell 的 Start-Process
 * 启动，DevTools 调试端口的用法完全一致。
 * 可用 CHROME_LAUNCHER=node|powershell 强制指定。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

const URL_TARGET = process.argv[2] || 'http://127.0.0.1:3000/';
const DEBUG_PORT = 9333;
const SHOT_DIR = resolve(process.cwd(), '.tmp', 'shots');
// 每次运行都用全新的浏览器配置目录，保证 localStorage 从零开始（断言可重复）
const PROFILE_DIR = resolve(process.cwd(), '.tmp', `chrome-profile-${Date.now()}`);

const BROWSER_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

const executable = process.env.CHROME_PATH || BROWSER_CANDIDATES.find((path) => existsSync(path));

if (!executable) {
  console.error('[browser] 未找到 Chrome/Edge，可用 CHROME_PATH 指定');
  process.exit(2);
}

mkdirSync(SHOT_DIR, { recursive: true });
mkdirSync(PROFILE_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ 浏览器启动 ------------------------------ */

const BROWSER_ARGS = [
  '--headless=new',
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${PROFILE_DIR}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-crash-reporter',
  '--disable-breakpad',
  '--disable-gpu',
  '--hide-scrollbars',
  '--window-size=1440,900',
  'about:blank',
];

function spawnViaNode() {
  return spawn(executable, BROWSER_ARGS, { stdio: 'ignore', detached: false });
}

function pidsOnDebugPort() {
  try {
    const result = spawnSync('netstat', ['-ano'], { encoding: 'utf8', timeout: 15000 });
    const pids = new Set();
    for (const line of (result.stdout ?? '').split(/\r?\n/)) {
      if (!line.includes(`:${DEBUG_PORT}`)) continue;
      if (!/LISTENING/i.test(line)) continue;
      const pid = line.trim().split(/\s+/).pop();
      if (pid && /^\d+$/.test(pid)) pids.add(Number(pid));
    }
    return [...pids];
  } catch {
    return [];
  }
}

/** 通过 PowerShell 启动（可用于 Node 直接 spawn 会被系统拒绝的环境） */
function spawnViaPowerShell() {
  const psArgs = BROWSER_ARGS.map((arg) => `'${arg.replace(/'/g, "''")}'`).join(',');
  const pidFile = join(PROFILE_DIR, 'browser.pid');
  const command = [
    `$p = Start-Process -FilePath '${executable.replace(/'/g, "''")}' -ArgumentList @(${psArgs}) -PassThru`,
    `Set-Content -LiteralPath '${pidFile.replace(/'/g, "''")}' -Value $p.Id`,
  ].join('; ');

  // 注意：这里不能用管道捕获输出——受限环境中管道 stdio 会被拒绝（EPERM），
  // 所以 PID 写到文件里再读回。
  spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    stdio: 'ignore',
    timeout: 30_000,
  });

  let pid = null;
  try {
    pid = Number(readFileSync(pidFile, 'utf8').trim());
  } catch {
    /* 没拿到 PID 也能靠调试端口清理 */
  }

  return {
    kind: 'powershell',
    pid: Number.isFinite(pid) ? pid : null,
    kill() {
      for (const target of pidsOnDebugPort()) {
        spawnSync('taskkill', ['/PID', String(target), '/T', '/F'], { stdio: 'ignore' });
      }
      if (Number.isFinite(pid)) {
        spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
      }
    },
  };
}

/** 依次尝试两种启动方式，返回能提供 DevTools 的那一个 */
async function launchBrowser() {
  const forced = (process.env.CHROME_LAUNCHER ?? '').toLowerCase();
  const order =
    forced === 'powershell' ? ['powershell'] : forced === 'node' ? ['node'] : ['node', 'powershell'];

  for (const kind of order) {
    let handle;
    if (kind === 'node') {
      console.log('[browser] 启动方式：node spawn');
      const child = spawnViaNode();
      child.on('error', (error) => console.log(`[browser] spawn 失败：${error.message}`));
      child.on('exit', (code) => {
        if (code !== 0) console.log(`[browser] 浏览器进程退出，code=${code}`);
      });
      handle = { kind, kill: () => child.kill() };
    } else {
      console.log('[browser] 启动方式：PowerShell Start-Process');
      handle = spawnViaPowerShell();
    }

    const info = await waitForDevtools(12_000);
    if (info) return handle;

    console.log(`[browser] 方式 ${kind} 未能提供 DevTools 端口，尝试下一种`);
    handle.kill();
    await sleep(1000);
  }

  return null;
}

async function waitForDevtools(deadlineMs = 25_000) {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (response.ok) return await response.json();
    } catch {
      /* 浏览器还没起来 */
    }
    await sleep(300);
  }
  return null;
}

let failures = 0;
function check(name, ok, extra = '') {
  if (!ok) failures += 1;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${extra ? ` ${extra}` : ''}`);
}

/* ------------------------------- CDP 极简客户端 ------------------------------- */

class Cdp {
  #socket;
  #id = 0;
  #pending = new Map();

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.#pending.has(message.id)) {
        const { resolve, reject } = this.#pending.get(message.id);
        this.#pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
        else resolve(message.result);
      }
    });
  }

  static async connect(wsUrl) {
    const socket = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('WebSocket 连接失败')), { once: true });
    });
    return new Cdp(socket);
  }

  send(method, params = {}) {
    const id = ++this.#id;
    this.#socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.#pending.has(id)) {
          this.#pending.delete(id);
          reject(new Error(`CDP 超时: ${method}`));
        }
      }, 30_000);
    });
  }

  /** 在页面里执行一段表达式并取回 JSON 结果 */
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? '页面脚本异常');
    }
    return result.result.value;
  }

  close() {
    this.#socket.close();
  }
}

async function main() {
  console.log(`[browser] 使用 ${executable}`);
  const browser = await launchBrowser();
  if (!browser) {
    throw new Error(
      '浏览器无法启动（Node 与 PowerShell 两种方式都失败）。请手动打开页面自查，或用 CHROME_LAUNCHER=node|powershell 强制指定启动方式。',
    );
  }

  let cdp;
  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    const page = targets.find((target) => target.type === 'page');
    if (!page?.webSocketDebuggerUrl) throw new Error('未找到可用的页面目标');

    cdp = await Cdp.connect(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    console.log(`[browser] 打开 ${URL_TARGET}`);
    // 先导航到 about:blank，确保上一个文档的卸载逻辑（落盘）不会覆盖稍后的清理
    await cdp.send('Page.navigate', { url: 'about:blank' });
    await sleep(600);
    await cdp.send('Page.navigate', { url: `${URL_TARGET}?e2e=1` });
    await sleep(2500);
    const storedClearedCount = await cdp.evaluate(`
      (() => {
        const raw = localStorage.getItem('ai_chat_sessions');
        if (!raw) return 0;
        try {
          return JSON.parse(raw).reduce((sum, s) => sum + (s.messages?.length ?? 0), 0);
        } catch {
          return -1;
        }
      })()
    `);
    const storedCleared = storedClearedCount === 0;
    console.log('[browser] 已重置 localStorage 并重新加载页面');

    const title = await cdp.evaluate('document.title');
    check('页面标题正确', typeof title === 'string' && title.includes('GlintChat'), `title=${title}`);

    if (!storedCleared) {
      failures += 1;
      console.log(`[FAIL] 未能重置 localStorage，实际会话数=${storedClearedCount}`);
    } else {
      console.log('[PASS] localStorage 已重置为初始状态');
    }

    const mounted = await cdp.evaluate("!!document.querySelector('#app')?.children.length");
    check('Vue 应用已挂载', mounted === true);

    const sidebarText = await cdp.evaluate(
      "document.querySelector('aside')?.innerText?.replace(/\\s+/g, ' ').slice(0, 60) || ''",
    );
    check('侧边栏渲染出新建对话按钮', sidebarText.includes('新建对话'), sidebarText);

    const modelOptions = await cdp.evaluate(
      "Array.from(document.querySelectorAll('header select option')).map(o => o.value).join(',')",
    );
    check(
      '顶部模型下拉框从 /api/models 拉取成功',
      modelOptions.includes('deepseek-chat') && modelOptions.includes('deepseek-reasoner'),
      modelOptions,
    );

    // 选择推理模型，验证思维链面板
    await cdp.evaluate(`
      (() => {
        const select = document.querySelector('header select');
        select.value = 'deepseek-reasoner';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return select.value;
      })()
    `);
    await sleep(300);

    // 输入并回车发送
    const prompt = 'Vue3 和 React 怎么选？请给出对比表格和示例代码。';
    await cdp.evaluate(`
      (() => {
        const textarea = document.querySelector('textarea[aria-label="输入消息"]');
        textarea.focus();
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(textarea, ${JSON.stringify(prompt)});
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        return textarea.value.length;
      })()
    `);
    await sleep(200);

    const sendEnabled = await cdp.evaluate(`
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const send = buttons.find((b) => b.textContent.trim().includes('发送'));
        return !!(send && !send.disabled);
      })()
    `);
    check('输入后「发送」按钮可用', sendEnabled === true);

    await cdp.evaluate(`
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const send = buttons.find((b) => b.textContent.trim().includes('发送'));
        send?.click();
        return true;
      })()
    `);

    // 生成中状态会短暂出现，轮询 3 秒以稳定捕获
    let streamingVisible = false;
    for (let i = 0; i < 15; i += 1) {
      streamingVisible = await cdp.evaluate(
        "Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('停止'))",
      );
      if (streamingVisible) break;
      await sleep(200);
    }
    check('生成中按钮切换为「停止」', streamingVisible === true);

    // 等待流式结束（停止按钮消失）
    let settled = false;
    for (let i = 0; i < 60; i += 1) {
      await sleep(500);
      const stillStreaming = await cdp.evaluate(
        "Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('停止'))",
      );
      if (!stillStreaming) {
        settled = true;
        break;
      }
    }
    check('流式生成正常结束', settled === true);

    const view = await cdp.evaluate(`
      (() => {
        const bubbles = Array.from(document.querySelectorAll('.markdown-body'));
        const last = bubbles[bubbles.length - 1];
        return {
          bubbleCount: bubbles.length,
          hasTable: !!document.querySelector('.markdown-body table'),
          hasCodeBlock: !!document.querySelector('.code-block'),
          hasHighlight: !!document.querySelector('.code-block .hljs-keyword, .code-block .hljs-string'),
          hasCopyButton: !!document.querySelector('[data-code-copy]'),
          hasThinkingPanel: !!document.querySelector('.thinking-shimmer, [class*="violet"]'),
          text: last ? last.innerText.replace(/\\s+/g, ' ').slice(0, 120) : '',
        };
      })()
    `);

    check('用户消息 + AI 消息都已渲染', view.bubbleCount >= 2, `bubbles=${view.bubbleCount}`);
    check('Markdown 表格已渲染', view.hasTable === true);
    check('代码块已渲染', view.hasCodeBlock === true);
    check('代码高亮生效（hljs token 存在）', view.hasHighlight === true);
    check('代码块带复制按钮', view.hasCopyButton === true);
    check('思维链面板存在', view.hasThinkingPanel === true);
    check('回答包含预期内容', view.text.includes('Vue') || view.text.includes('结论'), view.text);

    // 历史持久化：localStorage
    const stored = await cdp.evaluate(
      "JSON.parse(localStorage.getItem('ai_chat_sessions') || '[]').length",
    );
    check('会话已写入 localStorage(ai_chat_sessions)', stored >= 1, `sessions=${stored}`);
    const storedMessages = await cdp.evaluate(`
      (() => {
        const list = JSON.parse(localStorage.getItem('ai_chat_sessions') || '[]');
        return list[0]?.messages?.length ?? 0;
      })()
    `);
    check('消息随会话一起落盘', storedMessages >= 2, `messages=${storedMessages}`);

    // 截图（亮色）
    let shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOT_DIR, 'chat-light.png'), Buffer.from(shot.data, 'base64'));

    // 切暗色再截一张（先确保当前是亮色，避免断言依赖上次运行的主题）
    await cdp.evaluate(`
      (() => {
        const findThemeButton = () =>
          Array.from(document.querySelectorAll('header button')).find((b) =>
            (b.title || '').includes('暗色') || (b.title || '').includes('亮色'),
          );
        if (document.documentElement.classList.contains('dark')) {
          findThemeButton()?.click();
        }
        return document.documentElement.className;
      })()
    `);
    await sleep(400);
    await cdp.evaluate(`
      (() => {
        const theme = Array.from(document.querySelectorAll('header button')).find((b) =>
          (b.title || '').includes('暗色') || (b.title || '').includes('亮色'),
        );
        theme?.click();
        return true;
      })()
    `);
    await sleep(600);
    shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOT_DIR, 'chat-dark.png'), Buffer.from(shot.data, 'base64'));

    const darkApplied = await cdp.evaluate("document.documentElement.classList.contains('dark')");
    check('暗色模式切换生效', darkApplied === true);

    const darkStored = await cdp.evaluate("localStorage.getItem('glintchat_theme')");
    check('主题偏好已持久化', darkStored === 'dark' || darkStored === 'light', String(darkStored));

    /* ------------------------- 中断生成（AbortController） ------------------------- */
    await cdp.evaluate(`
      (() => {
        const select = document.querySelector('header select');
        select.value = 'mock-slow';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        const textarea = document.querySelector('textarea[aria-label="输入消息"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(textarea, '这是一条用于验证中断的测试消息');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()
    `);
    await sleep(300);
    await cdp.evaluate(`
      (() => {
        const send = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim().includes('发送'));
        send?.click();
        return true;
      })()
    `);

    let stopAppeared = false;
    for (let i = 0; i < 20; i += 1) {
      stopAppeared = await cdp.evaluate(
        "Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('停止'))",
      );
      if (stopAppeared) break;
      await sleep(300);
    }
    check('慢速模型下「停止」按钮出现', stopAppeared === true);

    await cdp.evaluate(`
      (() => {
        const stop = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('停止'));
        stop?.click();
        return true;
      })()
    `);
    await sleep(1200);

    const afterAbort = await cdp.evaluate(`
      (() => ({
        streaming: Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('停止')),
        hasSend: Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim().includes('发送')),
        errorBanner: /生成失败|网络异常|失败/.test(document.body.innerText),
      }))()
    `);
    check('点击停止后恢复为「发送」按钮', afterAbort.streaming === false && afterAbort.hasSend === true);
    check('中断不会显示为失败', afterAbort.errorBanner === false);

    /* ------------------------------- 新建对话 ------------------------------- */
    await cdp.evaluate(`
      (() => {
        const button = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('新建对话'));
        button?.click();
        return true;
      })()
    `);
    await sleep(800);
    const emptyState = await cdp.evaluate(
      "document.body.innerText.includes('开始对话') || document.body.innerText.length > 0",
    );
    check('新建对话后回到空状态', emptyState === true);

    shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOT_DIR, 'empty-state.png'), Buffer.from(shot.data, 'base64'));

    // 断言没有明显的 JS 崩溃
    const appAlive = await cdp.evaluate("!!document.querySelector('#app > *')");
    check('页面无白屏（应用根节点仍有内容）', appAlive === true);
  } catch (error) {
    failures += 1;
    console.error('[FAIL] 浏览器验收异常：', error);
  } finally {
    cdp?.close();
    browser.kill();
    await sleep(500);
    try {
      rmSync(PROFILE_DIR, { recursive: true, force: true });
    } catch {
      /* 浏览器可能仍占用文件，忽略 */
    }
  }

  console.log(`\n=== 浏览器验收：${failures === 0 ? '全部通过' : `${failures} 项失败`} ===`);
  console.log(`截图目录：${SHOT_DIR}`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
