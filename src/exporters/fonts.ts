import {
  INTER_LATIN_800,
  INTER_LATIN_800_URL,
  NOTO_CDN_DIR,
  NOTO_FAMILY,
  NOTO_LOCAL_DIR,
  NOTO_SLICES,
  NOTO_WEIGHT,
} from '../assets/fonts';
import { selectSlices } from '../core/font-slices';
import type { FontSlice } from '../core/font-slices';

/**
 * 导出用字体注入。
 *
 * scene() 的字体栈以 "Inter" 开头、第二可解析项是 "Noto Sans SC"。两条导出路径
 * 各自让这两个名字可解析：
 *
 * - raster（PNG / GIF 用）：拉丁用 woff2 data URI；中文按文本命中的 unicode-range
 *   切片，逐片 fetch → base64 → 内嵌。`<img>` 渲染 SVG 时自取内嵌字体，
 *   不依赖页面已加载字体、也不依赖系统字体——导出的 PNG 在任何机器上字形一致
 *   （M1 判据），中文同理（M4 闭环）。
 *
 * - file（.svg 下载）：按 SPEC 3.2「不内嵌字体」，只放 CDN 引用 + unicode-range；
 *   离线打开时回退字体栈，允许字形差异（已确认接受）。
 *
 * ⚠️ M4 实测的坑（别删这段注释）：`<img>` 里的内嵌字体是**异步**解码的，
 * 首次栅格化常常赶不上——`font-display:block` 会让文字整块消失，`swap` 会静默
 * 回退系统字体且**不会重绘**（同一 data URI 的后续栅格化才恢复正常）。
 * 因此栅格化前必须用「探针字形」逐切片确认字体已就位（ensureFacesReady）。
 */

const INTER_FAMILY = 'Inter';

/** raster 用：block 让「字形未就位」变成可检测的空白（探针信号） */
const RASTER_DISPLAY = 'block';
/** file 用：真实浏览器里按正常加载流程走，块期不可见不合适 */
const FILE_DISPLAY = 'swap';

function face(family: string, weight: number, src: string, display: string, ranges?: string): string {
  const rangeRule = ranges ? `;unicode-range:${ranges}` : '';
  return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:${display};src:url('${src}') format('woff2')${rangeRule}}`;
}

/** 在根 <svg> 开标签之后注入 <style>；输入不是 SVG 时原样返回 */
function injectStyle(svg: string, style: string): string {
  if (!svg.startsWith('<svg')) return svg;
  const openEnd = svg.indexOf('>');
  if (openEnd === -1) return svg;
  return svg.slice(0, openEnd + 1) + `<style>${style}</style>` + svg.slice(openEnd + 1);
}

/** CJK 起跳点：U+2E80（CJK 部首）——低于此由 Inter / 系统字体负责 */
const CJK_START = 0x2e80;

/** 只保留 CJK 及全角区字符（拉丁与通用标点交给 Inter，避免英文卡白背中文切片） */
function cjkOnly(text: string): string {
  let out = '';
  for (const ch of text) {
    if ((ch.codePointAt(0) ?? 0) >= CJK_START) out += ch;
  }
  return out;
}

/** 文本命中的中文切片（确定性顺序，便于缓存与断言） */
export function notoSlicesFor(texts: string[]): FontSlice[] {
  return selectSlices(cjkOnly(texts.join('\n')), NOTO_SLICES);
}

function bytesToBase64(bytes: Uint8Array): string {
  // 切片是二进制，btoa 安全；分块避免展开运算符触及调用栈上限
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** 切片 data URI 缓存：GIF 67 帧只 fetch 一次 */
const dataUriCache = new Map<string, Promise<string>>();

function sliceUrl(file: string): string {
  // 以文档 baseURI 解析：dist 部署在任意子路径（GitHub Pages 项目页）都成立
  return new URL(`${NOTO_LOCAL_DIR}${file}`, document.baseURI).href;
}

function sliceDataUri(file: string): Promise<string> {
  let task = dataUriCache.get(file);
  if (!task) {
    task = (async () => {
      const res = await fetch(sliceUrl(file));
      if (!res.ok) throw new Error(`字体切片加载失败：${file}（HTTP ${res.status}）`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      return `data:font/woff2;base64,${bytesToBase64(bytes)}`;
    })();
    // 失败不缓存：允许重试，避免一次网络抖动把会话锁死
    task.catch(() => dataUriCache.delete(file));
    dataUriCache.set(file, task);
  }
  return task;
}

// —— 样式构建与缓存 ——

interface RasterStyle {
  css: string;
  slices: FontSlice[];
}

const styleCache = new Map<string, Promise<RasterStyle>>();

function rasterStyle(texts: string[]): Promise<RasterStyle> {
  const key = texts.join('\n');
  let task = styleCache.get(key);
  if (!task) {
    task = (async () => {
      const slices = notoSlicesFor(texts);
      const notoFaces = await Promise.all(
        slices.map(async (s) =>
          face(NOTO_FAMILY, NOTO_WEIGHT, await sliceDataUri(s.file), RASTER_DISPLAY, s.ranges),
        ),
      );
      const css = [face(INTER_FAMILY, 800, INTER_LATIN_800, RASTER_DISPLAY), ...notoFaces].join('');
      return { css, slices };
    })();
    task.catch(() => styleCache.delete(key));
    styleCache.set(key, task);
  }
  return task;
}

/**
 * PNG / GIF 栅格化专用：注入内嵌字体（拉丁 + 中文按需切片）。
 *
 * 调用方必须自己确认「文字真的画出来了」——字体在 `<img>` 里是异步解码的，
 * 首次栅格化可能整块空白。校验与重试见 exporters/png.ts 的 rasterizeScene。
 */
export async function svgForRaster(svg: string, texts: string[] = []): Promise<string> {
  const style = await rasterStyle(texts);
  return injectStyle(svg, style.css);
}

/** SVG 文件导出：注入 CDN 引用，不内嵌字节 */
export function svgForFile(svg: string, texts: string[] = []): string {
  const faces = [face(INTER_FAMILY, 800, INTER_LATIN_800_URL, FILE_DISPLAY)];
  for (const s of notoSlicesFor(texts)) {
    faces.push(face(NOTO_FAMILY, NOTO_WEIGHT, `${NOTO_CDN_DIR}${s.file}`, FILE_DISPLAY, s.ranges));
  }
  return injectStyle(svg, faces.join(''));
}
