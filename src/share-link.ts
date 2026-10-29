/**
 * 分享链接：State ↔ URL hash（纯前端，零后端，不上传数据）。
 * 只序列化 Selection 可恢复部分；上传图片（iconSvgs 里的 SVG 字符串 / 位图 dataURL）
 * 不含在链接里——打开链接时若状态指向上传内容则提示「需要原设备」。
 */
import type { DefaultStateOptions } from './app-state';
import type { Locale, Ratio, SceneState } from './core/types';

export interface ShareStateCompact {
  t?: string; // templateId
  v?: string; // variantId
  l?: Locale;
  r?: Ratio;
  p?: string; // platform
  i?: Array<{ icon: string; label?: string; phase?: number; speed?: number }>;
  tx?: Record<string, string>; // text overrides by locale? 简化为 {en?, zh?}
  pal?: { bg?: string; fg?: string };
  rows?: number;
  s?: number; // speed
}

export function encodeShare(options: DefaultStateOptions): string {
  const c: ShareStateCompact = {};
  if (options.templateId) c.t = options.templateId;
  if (options.variantId) c.v = options.variantId;
  if (options.locale) c.l = options.locale;
  if (options.ratio) c.r = options.ratio;
  if (options.icons && options.icons.length > 0) {
    // 只保留可回复的图标引用（emoji / simple-icons / svgl:），放弃 upload 引用
    c.i = options.icons.map((it) => ({
      icon: it.icon,
      label: it.label,
      phase: it.phase,
      speed: it.speed,
    })).filter((it) =>
      !it.icon.startsWith('upload:')
    );
  }
  if (options.text && Object.keys(options.text).length > 0) {
    const tx: Record<string, string> = {};
    for (const [k, v] of Object.entries(options.text as Partial<Record<string, string>>)) {
      if (v) tx[k] = v;
    }
    if (Object.keys(tx).length > 0) c.tx = tx as Record<string, string>;
  }
  if (options.palette && (options.palette.bg || options.palette.fg)) {
    c.pal = {
      bg: options.palette.bg,
      fg: options.palette.fg,
    };
  }
  if (options.rows !== undefined) c.rows = options.rows;
  if (options.speed !== undefined) c.s = options.speed;
  return '#' + encodeURIComponent(JSON.stringify(c));
}

export function decodeShare(hash: string): Partial<DefaultStateOptions> | null {
  const raw = hash.replace(/^#/, '');
  if (!raw) return null;
  try {
    const c = JSON.parse(decodeURIComponent(raw)) as ShareStateCompact;
    const out: Partial<DefaultStateOptions> = {};
    if (c.t) out.templateId = c.t;
    if (c.v) out.variantId = c.v;
    if (c.l) out.locale = c.l;
    if (c.r) out.ratio = c.r;
    // platform 不在序列化里（它是导出设置非渲染状态）
    if (c.i) out.icons = c.i.map((it) => ({
      icon: it.icon,
      label: it.label,
      phase: it.phase,
      speed: it.speed,
    }));
    if (c.tx) {
      const text = Object.fromEntries(
        Object.entries(c.tx as Record<string, string>).filter(([, v]) => typeof v === 'string'),
      ) as SceneState['text'];
      out.text = text;
    }
    if (c.pal) out.palette = { bg: c.pal.bg, fg: c.pal.fg };
    if (c.rows !== undefined) out.rows = c.rows;
    if (c.s !== undefined) out.speed = c.s;
    return out;
  } catch {
    return null;
  }
}
