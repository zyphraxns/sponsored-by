/**
 * 自托管字体资产（单一来源）。
 *
 * - Inter latin 800：@fontsource/inter 5.3.0（SIL OFL 1.1），woff2 + b64 边车，
 *   b64 由 `npm run fonts:b64` 生成，供 ?raw 导入（vitest/node 环境同样可导入）。
 * - Noto Sans SC 700 切片：@fontsource/noto-sans-sc 5.3.1（SIL OFL 1.1），
 *   97 片落在 public/fonts/noto-sans-sc/，映射表由 `npm run fonts:slices` 生成。
 *   运行时只 fetch 文本实际命中的切片（通常 3~4 片），再 base64 内嵌进 SVG。
 */
import interLatin800B64 from './fonts/inter-latin-800-normal.woff2.b64?raw';
import notoManifest from './font-slices.json';
import type { FontSlice } from '../core/font-slices';

/** PNG 栅格化用：内嵌 data-URI（见 exporters/fonts.ts） */
export const INTER_LATIN_800 = `data:font/woff2;base64,${interLatin800B64}`;

/** SVG 文件导出用：CDN 引用，版本与 devDependency 锁定一致 */
export const INTER_LATIN_800_URL =
  'https://cdn.jsdelivr.net/npm/@fontsource/inter@5.3.0/files/inter-latin-800-normal.woff2';

/** 中文字体族名（scene() 的字体栈第二项；嵌入后可在 <img> 上下文解析） */
export const NOTO_FAMILY = 'Noto Sans SC';
/** 字重：700 与 Inter 800 的笔画厚度接近，混排不跳 */
export const NOTO_WEIGHT = 700;

/** 切片清单（构建期生成，见 scripts/build-font-slices.mjs） */
export const NOTO_SLICES: FontSlice[] = notoManifest as FontSlice[];

/** 本地切片目录（相对文档 baseURI，GitHub Pages 子路径托管同样成立） */
export const NOTO_LOCAL_DIR = 'fonts/noto-sans-sc/';

/** SVG 文件导出用：CDN 目录（版本与 devDependency 锁定一致） */
export const NOTO_CDN_DIR =
  'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.3.1/files/';
