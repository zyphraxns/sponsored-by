#!/usr/bin/env node
/**
 * CDP 无头驱动（验证基础设施，零依赖，Node 22+）。
 *
 *   node scripts/cdp-selfcheck.mjs <url> <outDir> [titlePrefix] [timeoutMs] [viewport]
 *
 * 行为：起 Chrome（headless + remote debugging）→ 导航到 <url> →
 * 轮询等 document.title 以 titlePrefix 开头 → 按约定提取取证数据 → 截图 →
 * 退出码 0（信号正常）/ 1。
 *
 * viewport 形如 "1200x860"（默认 Chrome 的 800×600）——页面高的截图（比如
 * 要看页脚）必须显式给，否则截不到。
 *
 * 页面约定：
 * - [data-result="key"] 元素：textContent 进报告
 * - [data-b64="file.ext"] 元素：textContent 按 base64 解码落盘到 <outDir>/file.ext
 *
 * 为什么不用 --dump-dom：它在页面 load 事件后即 dump，等不到
 * img.decode() / canvas.toBlob() / GIF 编码等真实异步操作，
 * 会截到管线跑一半的 DOM（实测两次停在不同步进）。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, outDir, titlePrefix = 'SELFCHECK:', timeoutMsArg, viewportArg] = process.argv.slice(2);
if (!url || !outDir) {
  console.error('usage: node scripts/cdp-selfcheck.mjs <url> <outDir> [titlePrefix] [timeoutMs] [WxH]');
  process.exit(2);
}
const timeoutMs = Number(timeoutMsArg ?? 30000);
const [vw, vh] = (viewportArg ?? '').split('x').map(Number);

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9300 + (process.pid % 500);

// 用 mkdtemp 而不是 `cdp-sb-${pid}`：PID 会被复用，撞上残留的旧 profile 时
// Chrome 认为目录已被占用而静默退出（无任何 stderr），表现为「devtools endpoint unreachable」。
const USER_DATA_DIR = mkdtempSync(join(tmpdir(), 'cdp-sb-'));

const chrome = spawn(
  CHROME,
  [
    // Chrome 132 起只剩 new headless（--headless=old 已被移除，传旧值会直接不启动）。
    // 纯 --headless 在 112+ 等价于 new headless，跨版本最稳。
    '--headless',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-proxy-server',
    '--js-flags=--expose-gc', // 验证页在导出间隙主动 gc()，避免帧垃圾拖垮后续提取
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${USER_DATA_DIR}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);

const chromeStderr = [];
chrome.stderr?.on('data', (chunk) => {
  chromeStderr.push(chunk.toString());
  if (chromeStderr.length > 200) chromeStderr.shift();
});

let nextId = 1;
const pending = new Map();
let ws = null;

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression, timeoutMs = 90000) {
  const call = send('Runtime.evaluate', { expression, returnByValue: true });
  const guard = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`evaluate 超时（渲染进程可能已崩溃）：${expression.slice(0, 60)}`)), timeoutMs);
  });
  const res = await Promise.race([call, guard]);
  if (res.exceptionDetails) {
    throw new Error(`eval failed: ${res.exceptionDetails.exception?.description ?? expression}`);
  }
  return res.result.value;
}

async function findPageTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      // new headless（Chrome 132+）把初始 target 的 type 报成 "other" 而非 "page"，
      // 死等 type === 'page' 会一直空转到超时。优先 page，退而取任何可连的 target。
      const page = list.find((t) => t.type === 'page') ?? list.find((t) => t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* 端口尚未就绪 */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('devtools endpoint unreachable');
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const target = await findPageTarget();

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('websocket failed')), { once: true });
  });
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });

  await send('Page.enable');
  if (vw && vh) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: vw,
      height: vh,
      deviceScaleFactor: 1,
      mobile: false,
    });
  }
  await send('Page.navigate', { url });

  const deadline = Date.now() + timeoutMs;
  let title = '';
  let lastSeen = '';
  while (Date.now() < deadline) {
    title = await evaluate('document.title');
    lastSeen = title;
    if (typeof title === 'string' && title.startsWith(titlePrefix)) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!title.startsWith(titlePrefix)) {
    throw new Error(`timeout waiting for ${titlePrefix}* (last title: ${lastSeen || '<empty>'})`);
  }

  const report = { url, title };

  // 结果字段：[data-result]（先落盘再继续，失败时也留得下线索）
  const results = await evaluate(
    `Array.from(document.querySelectorAll('[data-result]')).map(el => [el.getAttribute('data-result'), el.textContent])`,
  );
  for (const [key, value] of results) report[key] = value;
  writeFileSync(join(outDir, 'selfcheck.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  // base64 工件：[data-b64="文件名"]（分块读取：单条 5MB 级 returnByValue 会挂起）
  const blobCount = await evaluate(`document.querySelectorAll('[data-b64]').length`);
  for (let i = 0; i < blobCount; i++) {
    const name = await evaluate(`document.querySelectorAll('[data-b64]')[${i}].getAttribute('data-b64')`);
    if (!name) continue;
    const length = await evaluate(`document.querySelectorAll('[data-b64]')[${i}].textContent.length`);
    const chunkSize = 512 * 1024;
    let b64 = '';
    for (let offset = 0; offset < length; offset += chunkSize) {
      b64 += await evaluate(
        `document.querySelectorAll('[data-b64]')[${i}].textContent.slice(${offset}, ${offset + chunkSize})`,
      );
    }
    const bytes = Buffer.from(b64, 'base64');
    writeFileSync(join(outDir, name), bytes);
    report[`file:${name}`] = bytes.length;
    console.log(`工件 ${name}: ${bytes.length} bytes（${Math.ceil(length / chunkSize)} 片）`);
  }
  writeFileSync(join(outDir, 'selfcheck.json'), JSON.stringify(report, null, 2));

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, 'selfcheck-page.png'), Buffer.from(shot.data, 'base64'));

  writeFileSync(join(outDir, 'selfcheck.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  // 信号正常 = 等到预期前缀，且未报 FAIL / TIMEOUT
  const ok = title.startsWith(titlePrefix) && !title.includes('FAIL') && !title.includes('TIMEOUT');
  if (!ok) {
    console.error(`signal NOT OK (title=${title})`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(`CDP selfcheck failed: ${err.message}`);
    const noise = chromeStderr.join('').split('\n').filter((l) => /ERROR|FATAL|crash|oom/i.test(l));
    if (noise.length) console.error('chrome stderr（过滤）:\n' + noise.slice(-10).join('\n'));
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    chrome.kill();
    // 清掉本次的临时 profile（不清理会无限堆积，且下次可能撞锁）
    try {
      rmSync(USER_DATA_DIR, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });
