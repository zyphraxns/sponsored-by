import type { SceneState, Template, TextLayer, TickerLayer, TickerItem } from './types';
import { fitFontSize } from './layout';
import { loopDuration, tickerPositions } from './ticker';

/**
 * 预览期字体栈（system font stack 秒开，不等字体加载；导出字体策略见 SPEC 3.2）。
 *
 * 顺序即优先级，M4 踩过的坑：系统 CJK 字体（PingFang SC / Microsoft YaHei）
 * 若排在 "Noto Sans SC" 之前，导出时内嵌切片永远轮不到——同一台机器看不出问题，
 * 换台电脑字形就漂移。因此 Noto 必须紧跟 Inter，系统 CJK 只作末位回退。
 */
const DISPLAY_FONT = '"Inter", "Noto Sans SC", "PingFang SC", "Helvetica Neue", Arial, sans-serif';
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

/** loopSeconds: 'auto' 时的基准周期（秒）。M3 起由各行速度反推全局 LCM 周期。 */
const BASE_LOOP_SECONDS = 4;

/** ticker 图标默认缩放（相对行高）；可被模板 iconScale 覆盖 */
export const DEFAULT_ICON_SCALE = 0.62;

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => XML_ESCAPES[c] ?? c);
}

/** 数值属性统一保留 2 位小数：输出干净且确定性（纯函数要求） */
function f(v: number): string {
  return (Math.round(v * 100) / 100).toString();
}

export function canvasSize(template: Template, ratio: SceneState['ratio']): { w: number; h: number } {
  const w = template.canvas.basePx;
  const [rw, rh] = ratio.split(':').map(Number);
  if (!rw || !rh) throw new Error(`invalid ratio: ${ratio}`);
  // 16:9 → 607.5 取整为 608（0.5px 误差）；M1 像素导出时按偶数对齐处理
  return { w, h: Math.round((w * rh) / rw) };
}

/**
 * 场景内文本图层的实际文案（含用户覆盖）。
 * 导出层用它决定中文字体切片：只内嵌这段文本命中的切片。
 */
export function sceneTexts(state: SceneState): string[] {
  return state.template.layers
    .filter((l): l is TextLayer => l.type === 'text')
    .map((l) => state.text[l.id]?.[state.locale] ?? l.default[state.locale]);
}

/**
 * 全局无缝循环周期（秒）。
 * 'auto' 时由各行周期取 LCM；当前各行同速（速度倍率统一），
 * 故等于基准周期除以速度倍率。M3 启用 speedJitter 后各行周期分化，
 * LCM 自动拉长到公共周期——这就是「duration 由 speed 反推」的落点。
 */
export function loopSecondsFor(state: SceneState): number {
  const rowCount = Math.max(
    1,
    ...state.template.layers
      .filter((l): l is TickerLayer => l.type === 'ticker')
      .map((l) => state.rows || l.rows),
  );
  const speed = state.speed || 1;
  return state.template.animation.loopSeconds === 'auto'
    ? loopDuration(Array.from({ length: rowCount }, () => BASE_LOOP_SECONDS / Math.abs(speed)))
    : state.template.animation.loopSeconds;
}

/**
 * scene(state, t) → SVG 字符串：全项目唯一渲染真源。
 * 静态导出 = t 取常数；动画 = t 从 0 推进到 loop。
 */
export function scene(state: SceneState, t: number): string {
  const { template } = state;
  const { w, h } = canvasSize(template, state.ratio);
  const bg = state.palette?.bg ?? template.palette.bg;
  const fg = state.palette?.fg ?? template.palette.fg;
  const loop = loopSecondsFor(state);

  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(w)} ${f(h)}" width="${f(w)}" height="${f(h)}" role="img" aria-label="${escapeXml(template.name[state.locale])}">`,
    `<title>${escapeXml(template.name[state.locale])}</title>`,
    `<rect x="0" y="0" width="${f(w)}" height="${f(h)}" fill="${bg}"/>`,
  ];

  for (const layer of template.layers) {
    if (layer.type === 'text') {
      out.push(renderText(layer, state, w, h, fg));
    } else {
      out.push(renderTicker(layer, state, w, h, loop, t));
    }
  }
  out.push('</svg>');
  return out.join('\n');
}

function renderText(layer: TextLayer, state: SceneState, w: number, h: number, fg: string): string {
  const text = state.text[layer.id]?.[state.locale] ?? layer.default[state.locale];
  const [bx, by, bw, bh] = layer.box;
  const size = fitFontSize(text, bw * w, bh * h * 0.92);
  const cx = (bx + bw / 2) * w;
  const cy = (by + bh / 2) * h;
  // 手算基线（不用 dominant-baseline）：导出 SVG 在任何查看器里表现一致
  const baseline = cy + size * 0.35;
  return `<text x="${f(cx)}" y="${f(baseline)}" font-family='${DISPLAY_FONT}' font-size="${f(size)}" font-weight="800" fill="${fg}" text-anchor="middle">${escapeXml(text)}</text>`;
}

function renderTicker(
  layer: TickerLayer,
  state: SceneState,
  w: number,
  h: number,
  loop: number,
  t: number,
): string {
  const items: TickerItem[] = state.icons.length > 0 ? state.icons : layer.items;
  const rows = Math.max(1, state.rows || layer.rows);
  const [bx, by, bw, bh] = layer.box;
  const boxX = bx * w;
  const boxY = by * h;
  const boxW = bw * w;
  const boxH = bh * h;
  const rowSlot = boxH / rows;
  const iconSize = rowSlot * (layer.iconScale ?? DEFAULT_ICON_SCALE);
  const spacing = iconSize * (1 + layer.gap);

  const defs: string[] = [];
  const body: string[] = [];
  for (let i = 0; i < rows; i++) {
    const rowTop = boxY + i * rowSlot;
    const cy = rowTop + rowSlot / 2;
    const dir = i % 2 === 0 ? 1 : -1; // 隔行反向（经典跑马灯观感；周期不受方向影响）
    const rowPhase = (((i * layer.phaseJitter) % 1) + 1) % 1; // 行间错相
    const rowSpeed = dir * (state.speed || 1);
    // M0 单实例预览，clipPath id 由 layer id + 行号确定性生成；
    // 多实例同页时需要加实例前缀（M1 导出链路接入时处理）
    const clipId = `clip-${layer.id}-${i}`;

    defs.push(
      `<clipPath id="${clipId}"><rect x="${f(boxX)}" y="${f(rowTop)}" width="${f(boxW)}" height="${f(rowSlot)}"/></clipPath>`,
    );
    body.push(`<g clip-path="url(#${clipId})">`);
    for (const p of tickerPositions(items, spacing, boxW, rowPhase, t, rowSpeed, loop)) {
      const icon = renderIcon(p.item.icon, boxX + p.x, cy, iconSize);
      if (icon) body.push(icon);
    }
    body.push('</g>');
  }
  return [`<g id="${layer.id}">`, `<defs>${defs.join('')}</defs>`, ...body, '</g>'].join('\n');
}

function renderIcon(icon: string, cx: number, cy: number, size: number): string {
  if (!icon.startsWith('emoji:')) return ''; // M0 仅 emoji；simple-icons / 上传见后续里程碑
  const glyph = icon.slice('emoji:'.length);
  const baseline = cy + size * 0.36;
  return `<text x="${f(cx)}" y="${f(baseline)}" font-family='${EMOJI_FONT}' font-size="${f(size)}" text-anchor="middle">${escapeXml(glyph)}</text>`;
}
