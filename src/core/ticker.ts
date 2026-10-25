import type { TickerItem } from './types';

/**
 * 无缝滚动数学。
 *
 * 核心不变量：内容带周期 = itemCount * spacing。
 * 滚动偏移每推进一个周期，画面与初始完全一致 → 循环播放无跳帧（SPEC 5.1）。
 */

export interface Positioned {
  item: TickerItem;
  x: number;
}

/** 一个内容周期的像素宽度 */
export function cycleWidth(itemCount: number, spacing: number): number {
  return itemCount * spacing;
}

/**
 * 生成一行在时刻 t 的全部项位置（含左右跨边界的重复项，由调用方 clipPath 裁剪）。
 * 只保留可见窗口 [-spacing, rowWidth + spacing] 内的位置，控制 SVG 节点数。
 */
export function tickerPositions(
  items: TickerItem[],
  spacing: number,
  rowWidth: number,
  rowPhase: number,
  t: number,
  rowSpeed: number,
  loopSeconds: number,
): Positioned[] {
  const cycle = cycleWidth(items.length, spacing);
  if (cycle <= 0) return [];
  // 行级错相以「周期」为单位；项级相位以「间距」为单位（更直观的微调）
  const scroll = rowPhase * cycle + t * rowSpeed * (cycle / loopSeconds);
  // k 平铺范围必须由 scroll 实际值推导：t 在 [0, loop) 内推进时，
  // scroll 最大可接近两个周期（rowPhase→1 且推进近一个整周期）。
  // 曾按 scroll∈[0,cycle) 写死 [-1, tiles]，导致循环点附近左侧可见项被丢掉
  // （scene 级无缝单测抓到：第三行 t=loop 时少两个图标）。
  const pad = spacing; // 左右各留一个图标宽度的出血余量
  const kMin = Math.floor((-pad - scroll) / cycle) - 1;
  const kMax = Math.ceil((rowWidth + pad - scroll) / cycle) + 1;
  const out: Positioned[] = [];
  for (let k = kMin; k <= kMax; k++) {
    items.forEach((item, j) => {
      const x = j * spacing + (item.phase ?? 0) * spacing + scroll + k * cycle;
      if (x >= -pad && x <= rowWidth + pad) {
        out.push({ item, x });
      }
    });
  }
  return out;
}

/** 分数近似（连分数法，分母上限 64，覆盖常见有理速度比） */
function toFraction(x: number): [number, number] {
  const sign = x < 0 ? -1 : 1;
  let v = Math.abs(x);
  let h0 = 0;
  let h1 = 1;
  let k0 = 1;
  let k1 = 0;
  for (let i = 0; i < 32 && k1 <= 64; i++) {
    const a = Math.floor(v);
    const h2 = a * h1 + h0;
    const k2 = a * k1 + k0;
    h0 = h1;
    h1 = h2;
    k0 = k1;
    k1 = k2;
    if (Math.abs(x - h1 / k1) < 1e-12) break;
    v = 1 / (v - a);
  }
  return [sign * h1, k1];
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * 全局无缝循环时长 = 各行周期的最小公倍数（秒）。
 * 有理数 LCM 公式：LCM(a/b, c/d) = LCM(a, c) / GCD(b, d)。
 * 速度须为有理数比（如 1 / 1.25），否则 LCM 趋于无穷——这是 M3 启用
 * speedJitter 时的硬约束，届时各行速度会量化到有限分数集合。
 */
export function loopDuration(periods: number[]): number {
  let num = 1;
  let den = 1;
  for (const p of periods) {
    if (p <= 0) continue;
    const [pn, pd] = toFraction(p);
    const g1 = gcd(num, pn);
    num = (num / g1) * pn;
    den = gcd(den, pd);
  }
  return num / den;
}
