/**
 * 工具界面双语字典（决策 2：中英双语切换）。
 *
 * 只放「工具 chrome」的字符串；版式内的文案属于模板 JSON（name / default），
 * 平台名与播放行为提示属于 presets（与阈值同源），这里不重复。
 */
import type { Locale, Ratio } from './core/types';

export interface CaptionInfo {
  template: string;
  ratio: Ratio;
  w: number;
  h: number;
  loop: number;
}

/** 体积预估文案的输入（数字与单位已在外部格式化，字典只管措辞） */
export interface EstimateInfo {
  format: string;
  w: number;
  h: number;
  /** null = 无法预估（MP4 体积由编码器决定） */
  estimate: string | null;
  /** null = 该平台无口径 */
  limit: string | null;
  over: boolean;
}

export interface UiStrings {
  docTitle: string;
  htmlLang: string;
  layoutLabel: string;
  languageLabel: string;
  ratioLabel: string;
  platformLabel: string;
  /** 图标按钮标签 */
  iconLabel: string;
  /** 标题输入框标签 */
  titleLabel: string;
  /** 行数标签 */
  rowsLabel: string;
  /** 速度标签 */
  speedLabel: string;
  /** 色板标签 */
  paletteLabel: string;
  /** 图标面板标题 */
  iconPanelTitle: string;
  /** 图标面板搜索占位 */
  iconPanelSearch: string;
  /** 图标面板加载中 */
  iconPanelLoading: string;
  /** 图标面板清空按钮 */
  iconPanelClear: string;
  /** 上传 logo 按钮 */
  uploadBtn: string;
  /** 图标面板关闭按钮 */
  iconPanelClose: string;
  /** 图标面板底部提示 */
  iconPanelHint: string;
  exportGif: string;
  exportMp4: string;
  exportPng: string;
  exportSvg: string;
  exporting: (kind: string, pct?: number) => string;
  exported: (kind: string, size: string) => string;
  /** 产物超过平台上限时的追加警告 */
  overLimit: (platform: string, size: string, limit: string) => string;
  mp4Unsupported: string;
  mp4LimitHint: string;
  failed: (message: string) => string;
  caption: (info: CaptionInfo) => string;
  estimate: (info: EstimateInfo) => string;
}

export const UI: Record<Locale, UiStrings> = {
  en: {
    docTitle: 'sponsored-by — live preview',
    htmlLang: 'en',
    layoutLabel: 'Layout',
    languageLabel: 'Language',
    ratioLabel: 'Ratio',
    platformLabel: 'Post to',
    iconLabel: 'Icons',
    titleLabel: 'Title',
    rowsLabel: 'Rows',
    speedLabel: 'Speed',
    paletteLabel: 'Palette',
    iconPanelTitle: 'Choose icons',
    iconPanelSearch: 'Search brands…',
    iconPanelLoading: 'Loading…',
    iconPanelClear: 'Clear',
    uploadBtn: 'Upload',
    iconPanelClose: 'Close',
    iconPanelHint: 'Click to toggle. simple-icons 3000+ brand marks, single-color SVG.',
    exportGif: 'Export GIF',
    exportMp4: 'Export MP4',
    exportPng: 'Export PNG',
    exportSvg: 'Export SVG',
    exporting: (kind, pct) => (pct === undefined ? `Exporting ${kind}…` : `Exporting ${kind}… ${pct}%`),
    exported: (kind, size) => `${kind} exported · ${size}`,
    overLimit: (platform, size, limit) => `over ${platform} limit (${limit}): ${size}`,
    mp4Unsupported: 'MP4 needs WebCodecs — use GIF in this browser',
    mp4LimitHint: 'MP4 does not loop on its own; most feeds replay it once',
    failed: (message) => `Export failed: ${message}`,
    caption: (i) => `${i.template} · ${i.ratio} · canvas ${i.w} × ${i.h} · ${i.loop}s loop`,
    estimate: (i) => {
      const head = `${i.format} ${i.w}×${i.h}`;
      if (i.estimate && i.limit) return `${head} · ~${i.estimate} / ${i.limit}${i.over ? ' · over limit' : ''}`;
      if (i.estimate) return `${head} · ~${i.estimate}`;
      if (i.limit) return `${head} · limit ${i.limit}`;
      return '';
    },
  },
  zh: {
    docTitle: 'sponsored-by — 实时预览',
    htmlLang: 'zh-CN',
    layoutLabel: '版式',
    languageLabel: '语言',
    ratioLabel: '比例',
    platformLabel: '发到',
    iconLabel: '图标',
    titleLabel: '标题',
    rowsLabel: '行数',
    speedLabel: '速度',
    paletteLabel: '色板',
    iconPanelTitle: '选择图标',
    iconPanelSearch: '搜索品牌…',
    iconPanelLoading: '加载中…',
    iconPanelClear: '清空',
    uploadBtn: '上传',
    iconPanelClose: '关闭',
    iconPanelHint: '点击切换选中状态。simple-icons 3000+ 品牌矢量，单色 SVG。',
    exportGif: '导出 GIF',
    exportMp4: '导出 MP4',
    exportPng: '导出 PNG',
    exportSvg: '导出 SVG',
    exporting: (kind, pct) => (pct === undefined ? `正在导出 ${kind}…` : `正在导出 ${kind}… ${pct}%`),
    exported: (kind, size) => `已导出 ${kind}，${size}`,
    overLimit: (platform, size, limit) => `超出「${platform}」上限 ${limit}：产物 ${size}`,
    mp4Unsupported: '此浏览器不支持 WebCodecs，请改用 GIF',
    mp4LimitHint: 'MP4 不会自动循环；多数信息流只播一遍',
    failed: (message) => `导出失败：${message}`,
    caption: (i) => `${i.template} · ${i.ratio} · 画布 ${i.w} × ${i.h} · 循环 ${i.loop} 秒`,
    estimate: (i) => {
      const head = `${i.format} ${i.w}×${i.h}`;
      if (i.estimate && i.limit) return `${head} · 预估 ~${i.estimate} / 上限 ${i.limit}${i.over ? ' · 超出' : ''}`;
      if (i.estimate) return `${head} · 预估 ~${i.estimate}`;
      if (i.limit) return `${head} · 上限 ${i.limit}`;
      return '';
    },
  },
};

export function ui(locale: Locale): UiStrings {
  return UI[locale];
}
