/**
 * GIF 导出自检（M3 卡点里程碑的验证基础设施）。
 *
 * 在真实浏览器里跑完整 GIF 导出链路，回读首帧画面；
 * 中文标题变体是 SPEC R2（中文字在 GIF 里糊掉）的探针。
 * <2 MB 等结构化判据由 scripts/gif-inspect.mjs 对导出的字节核对。
 *
 * URL 参数覆盖（冒烟缩放用）：?fps=2&loop=1&maxColors=16&basePx=540
 */
import { canvasSize } from './core/scene';
import { createDefaultState } from './app-state';
import { exportGif } from './exporters/gif';
import type { SceneState } from './core/types';

const params = new URLSearchParams(location.search);
const base = createDefaultState();
const iconScale = params.has('iconScale') ? Number(params.get('iconScale')) : undefined;
const overridden =
  params.has('fps') || params.has('loop') || params.has('maxColors') || params.has('basePx') || iconScale !== undefined;
const state: SceneState = overridden
  ? {
      ...base,
      template: {
        ...base.template,
        canvas: {
          ...base.template.canvas,
          basePx: Number(params.get('basePx') ?? base.template.canvas.basePx),
        },
        animation: {
          ...base.template.animation,
          fps: Number(params.get('fps') ?? base.template.animation.fps),
          loopSeconds: params.has('loop') ? Number(params.get('loop')) : 'auto',
        },
        export: {
          ...base.template.export,
          gifMaxColors: Number(params.get('maxColors') ?? base.template.export.gifMaxColors),
        },
        layers:
          iconScale === undefined
            ? base.template.layers
            : base.template.layers.map((l) => (l.type === 'ticker' ? { ...l, iconScale } : l)),
      },
    }
  : base;
// R2 探针：中文标题走 locale 'en' 槽位覆盖，渲染栈 Inter→PingFang 回退
const zhState = { ...state, text: { title: { en: '由以下品牌赞助' } } };

function set(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function fail(message: string): void {
  set('r-status', `FAIL：${message}`);
  const el = document.getElementById('r-status');
  if (el) el.className = 'fail';
  document.title = 'SELFCHECK:FAIL';
}

function containsAscii(bytes: Uint8Array, ascii: string): boolean {
  const needle = Array.from(ascii, (c) => c.charCodeAt(0));
  outer: for (let i = 0; i <= bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** 主动 GC（需 --expose-gc；不存在则静默跳过）：67 帧 × 4.7MB 的垃圾不及时回收会拖垮后续提取 */
function gc(): void {
  const g = (globalThis as { gc?: () => void }).gc;
  if (typeof g === 'function') g();
}

async function firstFrame(blob: Blob): Promise<{ dataUrl: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法获取 2D 画布上下文');
  ctx.drawImage(bitmap, 0, 0);
  return { dataUrl: canvas.toDataURL('image/png'), width: bitmap.width, height: bitmap.height };
}

async function main(): Promise<void> {
  if (overridden) {
    set('r-size', `参数覆盖：fps=${state.template.animation.fps} loop=${state.template.animation.loopSeconds} maxColors=${state.template.export.gifMaxColors} basePx=${state.template.canvas.basePx}`);
  }

  // 1. 默认卡（en）；进度写进 title，CDP 轮询可见（渲染进程若崩溃，最后 title 即线索）
  const t0 = performance.now();
  const gif = await exportGif(state, (done, total) => {
    document.title = `GIFPROG:${done}/${total}`;
  });
  const elapsed = performance.now() - t0;
  set('r-size', `${gif.size} bytes（${(gif.size / 1024).toFixed(1)} KB）`);
  set('r-time', `${(elapsed / 1000).toFixed(1)} s`);

  // 2. 字节 sanity：魔数 + NETSCAPE 无限循环扩展
  const bytes = new Uint8Array(await gif.arrayBuffer());
  const magic = String.fromCharCode(...bytes.slice(0, 6));
  const netscape = containsAscii(bytes, 'NETSCAPE2.0');
  set('r-magic', `${magic}，循环扩展 ${netscape ? '有' : '无'}`);
  set('gif-b64', bytesToBase64(bytes));

  // 3. 首帧回读
  const frame = await firstFrame(gif);
  set('r-dim', `${frame.width} × ${frame.height}`);
  set('frame-b64', frame.dataUrl.slice(frame.dataUrl.indexOf(',') + 1));
  const frameImg = document.getElementById('frame-png') as HTMLImageElement | null;
  if (frameImg) frameImg.src = frame.dataUrl;

  // 4. 中文标题变体（R2 探针；?zh=0 跳过，用于参数快扫）
  gc(); // 先回收第一次导出的帧垃圾（数百 MB）
  let zh: Blob | null = null;
  if (params.get('zh') !== '0') {
    zh = await exportGif(zhState, (done, total) => {
      document.title = `GIFPROG:zh:${done}/${total}`;
    });
    gc();
    set('r-zh-size', `${zh.size} bytes（${(zh.size / 1024).toFixed(1)} KB）`);
    const zhBytes = new Uint8Array(await zh.arrayBuffer());
    set('gif-zh-b64', bytesToBase64(zhBytes));
    const zhFrame = await firstFrame(zh);
    set('frame-zh-b64', zhFrame.dataUrl.slice(zhFrame.dataUrl.indexOf(',') + 1));
    const zhImg = document.getElementById('frame-zh-png') as HTMLImageElement | null;
    if (zhImg) zhImg.src = zhFrame.dataUrl;
  }

  // 5. 回读验证：modern-gif 解码首帧与末帧，证明帧链完整（编码→解码闭环）
  const { decode, decodeFrame } = await import('modern-gif');
  const parsed = decode(bytes);
  const first = decodeFrame(bytes, 0);
  const last = decodeFrame(bytes, parsed.frames.length - 1);
  set(
    'r-roundtrip',
    `解码 ${parsed.frames.length} 帧；首帧 ${first.width}×${first.height} delay=${first.delay}ms；末帧 ${last.width}×${last.height} delay=${last.delay}ms`,
  );

  // 5. 结构判定（<2MB 等判据由 gif-inspect.mjs 对字节核对）
  const expected = canvasSize(state.template, state.ratio);
  const ok =
    magic === 'GIF89a' &&
    netscape &&
    frame.width === expected.w &&
    frame.height === expected.h &&
    gif.size > 0 &&
    (zh === null || zh.size > 0) &&
    parsed.frames.length > 0 &&
    last.width === expected.w &&
    last.height === expected.h;
  set('r-status', ok ? 'PASS' : 'FAIL');
  const el = document.getElementById('r-status');
  if (el) el.className = ok ? 'pass' : 'fail';
  document.title = ok ? 'SELFCHECK:PASS' : 'SELFCHECK:FAIL';
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
