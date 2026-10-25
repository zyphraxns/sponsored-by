/**
 * 导出管线自检（M1 建立，M4 扩展中文闭环）。
 *
 * 在真实浏览器里跑完整导出链路，回读产物，并把 PNG base64 写进 DOM 供无头取证。
 * PASS 条件：
 *   1. PNG 魔数正确 + 尺寸 1080×1080
 *   2. 内嵌字体对照组像素差异 > 0.1%（证明用的是打包内 Inter，而非系统回退）
 *   3. 中文 PNG 内嵌了 Noto Sans SC 切片（数量 = Inter 之外的 @font-face 数）
 *   4. 中文内嵌字体对照组像素差异 > 0.1%（证明 Noto 切片真的生效）
 */
import { scene, sceneTexts } from './core/scene';
import { createDefaultState } from './app-state';
import { exportPng, rasterize, rasterizeScene } from './exporters/png';
import { notoSlicesFor, svgForRaster } from './exporters/fonts';
import { svgFileContent, svgToBlob } from './exporters/svg';

const state = createDefaultState();
const zhState = createDefaultState({ locale: 'zh' });

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

/** 两张 PNG 的差异像素占比（0~1） */
async function diffRatio(a: Blob, b: Blob): Promise<number> {
  const [ba, bb] = [await createImageBitmap(a), await createImageBitmap(b)];
  const ca = new OffscreenCanvas(ba.width, ba.height);
  const cb = new OffscreenCanvas(bb.width, bb.height);
  const ctxa = ca.getContext('2d');
  const ctxb = cb.getContext('2d');
  if (!ctxa || !ctxb) throw new Error('无法获取 OffscreenCanvas 2D 上下文');
  ctxa.drawImage(ba, 0, 0);
  ctxb.drawImage(bb, 0, 0);
  const pa = ctxa.getImageData(0, 0, ba.width, ba.height).data;
  const pb = ctxb.getImageData(0, 0, bb.width, bb.height).data;
  let diff = 0;
  for (let i = 0; i < pa.length; i += 4) {
    if (pa[i] !== pb[i] || pa[i + 1] !== pb[i + 1] || pa[i + 2] !== pb[i + 2] || pa[i + 3] !== pb[i + 3]) {
      diff++;
    }
  }
  return diff / (pa.length / 4);
}

/** canvas → base64（同步路径：FileReader 在无头虚拟时间下不可靠） */
function canvasB64(canvas: HTMLCanvasElement): string {
  const url = canvas.toDataURL('image/png');
  return url.slice(url.indexOf(',') + 1);
}

/** PNG blob 在标题带（y 6%~36%）的亮像素数：>0 说明标题真的画出来了 */
async function titleBandPixels(blob: Blob, w: number, h: number): Promise<number> {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;
  ctx.drawImage(bitmap, 0, 0);
  const top = Math.round(h * 0.06);
  const band = ctx.getImageData(0, top, w, Math.round(h * 0.3)).data;
  let n = 0;
  for (let i = 0; i < band.length; i += 4) {
    if ((band[i] ?? 0) > 160) n++;
  }
  return n;
}

async function main(): Promise<void> {
  // 1. 真实导出：内嵌 Inter → img → canvas → PNG
  const png = await exportPng(state, 0);
  set('r-png-size', `${png.size} bytes（${(png.size / 1024).toFixed(1)} KB）`);

  // 2. 回读尺寸
  const bitmap = await createImageBitmap(png);
  set('r-png-dim', `${bitmap.width} × ${bitmap.height}`);

  // 3. PNG 魔数取证
  const head = new Uint8Array(await png.slice(0, 8).arrayBuffer());
  const magic = Array.from(head, (b) => b.toString(16).padStart(2, '0')).join(' ');
  set('r-magic', magic);

  // 4. 对照组：同一场景但不注入字体 → 系统回退字体渲染
  const control = await rasterize(scene(state, 0), bitmap.width, bitmap.height);
  const diff = await diffRatio(png, control);
  set('r-font-diff', `${(diff * 100).toFixed(2)}% 像素不同`);

  // 5. SVG 文件导出（simple-icons 图标走 CDN 预取，与字体切片同款模式）
  const svgBlob = svgToBlob(await svgFileContent(state, 0));
  set('r-svg-size', `${svgBlob.size} bytes（${(svgBlob.size / 1024).toFixed(1)} KB）`);

  // 6. 取证 base64：英文卡（rasterizeScene：带墨迹校验，字体未就位会自动重试）
  const evidenceCanvas = await rasterizeScene(
    await svgForRaster(scene(state, 0), sceneTexts(state)),
    bitmap.width,
    bitmap.height,
    state,
  );
  const dataUrl = evidenceCanvas.toDataURL('image/png');
  const preview = document.getElementById('png-preview') as HTMLImageElement | null;
  if (preview) preview.src = dataUrl;
  set('png-b64', canvasB64(evidenceCanvas));

  // 7. 中文闭环：切片选择 → 内嵌 → 导出 → 回读
  const zhSlices = notoSlicesFor(sceneTexts(zhState));
  const zhSvg = await svgForRaster(scene(zhState, 0), sceneTexts(zhState));
  const embedded = (zhSvg.match(/data:font\/woff2;base64,/g) ?? []).length;
  set('r-zh-slices', `${zhSlices.length} 片（内嵌 face 数 ${embedded} = 1 Inter + ${embedded - 1} Noto）`);
  set('r-zh-slice-files', zhSlices.map((s) => s.file.replace('noto-sans-sc-', '').replace('-700-normal.woff2', '')).join(', '));

  const zhPng = await exportPng(zhState, 0);
  set('r-zh-png-size', `${zhPng.size} bytes（${(zhPng.size / 1024).toFixed(1)} KB）`);
  // 硬指标：导出 blob 的标题带必须有亮像素（字体竞态曾导致整块标题消失）
  const titlePixels = await titleBandPixels(zhPng, 1080, 1080);
  set('r-zh-title-pixels', `${titlePixels} 个亮像素`);
  const zhControl = await rasterize(scene(zhState, 0), bitmap.width, bitmap.height);
  const zhDiff = await diffRatio(zhPng, zhControl);
  set('r-zh-diff', `${(zhDiff * 100).toFixed(2)}% 像素不同`);

  const zhCanvas = await rasterizeScene(zhSvg, bitmap.width, bitmap.height, zhState);
  const zhPreview = document.getElementById('png-zh-preview') as HTMLImageElement | null;
  if (zhPreview) zhPreview.src = zhCanvas.toDataURL('image/png');
  set('png-zh-b64', canvasB64(zhCanvas));

  // 8. 判定
  const ok =
    magic === '89 50 4e 47 0d 0a 1a 0a' &&
    bitmap.width === 1080 &&
    bitmap.height === 1080 &&
    diff > 0.001 &&
    embedded === zhSlices.length + 1 &&
    zhDiff > 0.001 &&
    titlePixels > 0;
  set('r-status', ok ? 'PASS' : 'FAIL');
  const el = document.getElementById('r-status');
  if (el) el.className = ok ? 'pass' : 'fail';
  document.title = ok ? 'SELFCHECK:PASS' : 'SELFCHECK:FAIL';
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
