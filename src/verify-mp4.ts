/**
 * MP4 导出自检（M5）。
 *
 * 在真实浏览器里跑完整 MP4 链路，再做一次**独立回读**：用 mediabunny 的
 * 解封装器 + 解码器把产出的字节读回来，取首帧画面并检查标题墨迹。
 *
 * 为什么不用「编码器说成功」当证据：编码成功但封装损坏、或解码器拿不到
 * 关键帧，都会产出打不开的文件。只有「解封装 → 解码 → 像素里有字」
 * 这一条链走通，才算真的能发出去。
 *
 * URL 参数（冒烟缩放）：?fps=6&basePx=540
 */
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { canvasSize, loopSecondsFor } from './core/scene';
import { createDefaultState } from './app-state';
import { exportMp4, pickMp4Codec, webCodecsAvailable } from './exporters/mp4';
import { textInkRatio } from './exporters/png';
import type { SceneState } from './core/types';

const params = new URLSearchParams(location.search);
const base = createDefaultState();
const basePx = params.has('basePx') ? Number(params.get('basePx')) : base.template.canvas.basePx;
const fpsOverride = params.has('fps') ? Number(params.get('fps')) : undefined;
const state: SceneState =
  basePx === base.template.canvas.basePx
    ? base
    : { ...base, template: { ...base.template, canvas: { ...base.template.canvas, basePx } } };

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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** 主动 GC（需 --expose-gc；不存在则静默跳过）：120 帧 × 4.7MB 的垃圾需及时回收 */
function gc(): void {
  const g = (globalThis as { gc?: () => void }).gc;
  if (typeof g === 'function') g();
}

/** 把可能为 OffscreenCanvas 的解码帧统一画到 HTMLCanvasElement 上 */
function toHtmlCanvas(source: HTMLCanvasElement | OffscreenCanvas): HTMLCanvasElement {
  if (source instanceof HTMLCanvasElement) return source;
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法获取 2D 画布上下文');
  ctx.drawImage(source, 0, 0);
  return canvas;
}

async function main(): Promise<void> {
  const expected = canvasSize(state.template, state.ratio);
  const loop = loopSecondsFor(state);
  const fps = fpsOverride ?? 30;

  // 1. 能力检测（SPEC 5.2：不支持时须显式降级，而不是静默失败）
  const supported = webCodecsAvailable();
  set('r-support', supported ? '是（VideoEncoder + VideoFrame）' : '否');
  if (!supported) {
    fail('此浏览器不支持 WebCodecs，MP4 导出应降级为 GIF');
    return;
  }
  const codec = await pickMp4Codec(expected.w, expected.h);
  if (!codec) {
    fail('找不到可用的视频编码器');
    return;
  }

  // 2. 真实编码
  const t0 = performance.now();
  const result = await exportMp4(
    state,
    (done, total) => {
      document.title = `MP4PROG:${done}/${total}`;
    },
    { fps },
  );
  const elapsed = performance.now() - t0;
  set('r-codec', `${result.codec}（${result.width}×${result.height}，${result.frames} 帧，${(result.blob.size / 1024).toFixed(0)} KB）`);
  set('r-size', `${result.blob.size} bytes（${(result.blob.size / 1024).toFixed(1)} KB）`);
  set('r-time', `${(elapsed / 1000).toFixed(1)} s`);
  gc();

  const bytes = new Uint8Array(await result.blob.arrayBuffer());
  set('mp4-b64', bytesToBase64(bytes));

  // 3. 文件头：ftyp 在 bytes[4..8]，主品牌在 bytes[8..12]
  const boxType = String.fromCharCode(...bytes.slice(4, 8));
  const brand = String.fromCharCode(...bytes.slice(8, 12));
  set('r-ftyp', `${boxType} / ${brand}`);

  // 4. 独立回读：解封装 + 解码
  const input = new Input({ source: new BlobSource(result.blob), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) {
    fail('回读失败：文件里没有视频轨');
    return;
  }
  const [readCodec, duration, stats] = await Promise.all([
    track.getCodec(),
    track.computeDuration(),
    track.computePacketStats(),
  ]);
  set('r-dim', `${track.displayWidth} × ${track.displayHeight}（codec ${readCodec}）`);
  set(
    'r-playback',
    `${duration.toFixed(2)} s / ${stats.packetCount} 帧 / ${stats.averagePacketRate.toFixed(1)} fps / ${(stats.averageBitrate / 1e6).toFixed(2)} Mbps`,
  );

  const sink = new CanvasSink(track);
  const first = await sink.getCanvas(0);
  if (!first) {
    fail('回读失败：取不到首帧');
    return;
  }
  const frameCanvas = toHtmlCanvas(first.canvas);
  const ink = textInkRatio(frameCanvas, state);
  set('r-ink', `${(ink * 100).toFixed(2)}% 非背景像素`);
  const dataUrl = frameCanvas.toDataURL('image/png');
  set('frame-b64', dataUrl.slice(dataUrl.indexOf(',') + 1));
  const frameImg = document.getElementById('frame-png') as HTMLImageElement | null;
  if (frameImg) frameImg.src = dataUrl;

  const video = document.getElementById('mp4-video') as HTMLVideoElement | null;
  if (video) video.src = URL.createObjectURL(result.blob);

  // 5. 判定：尺寸、时长（±1 帧）、帧数、标题墨迹
  const expectedFrames = Math.max(1, Math.round(loop * fps));
  const ok =
    boxType === 'ftyp' &&
    track.displayWidth === expected.w &&
    track.displayHeight === expected.h &&
    Math.abs(duration - loop) <= 1 / fps + 0.02 &&
    Math.abs(stats.packetCount - expectedFrames) <= 2 &&
    ink > 0.002;

  set('r-status', ok ? 'PASS' : 'FAIL');
  const el = document.getElementById('r-status');
  if (el) el.className = ok ? 'pass' : 'fail';
  document.title = ok ? 'SELFCHECK:PASS' : 'SELFCHECK:FAIL';
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
