import type { TickerItem } from './types';

/**
 * 无缝滚动数学。
 *
 * 核心不变量：内容带周期 = Σ(单元宽度 + gap)。
 * 滚动偏移每推进一个周期，画面与初始完全一致 → 循环播放无跳帧（SPEC 5.1）。
 *
 * ── 2026-10-26 重写 ──
 * v0.2 之前所有单元等宽（只有图标），故周期 = itemCount × spacing。
 * 加入「完整 logo」（官方字标 / 符号+品牌名）后单元宽度不再相等
 * （`X` 与 `Tailwind CSS` 差数倍），等距公式直接失效，
 * 必须改成按各单元实际宽度累积偏移。
 */

export interface TickerSlot {
  item: TickerItem;
  /** 该单元自身宽度（不含单元间 gap） */
  width: number;
}

export interface Positioned {
  item: TickerItem;
  x: number;
  width: number;
}

/** 一个内容周期的像素宽度 */
export function cycleWidth(slots: TickerSlot[], gap: number): number {
  return slots.reduce((sum, slot) => sum + slot.width + gap, 0);
}

/**
 * 生成一行在时刻 t 的全部项位置（含左右跨边界的重复项，由调用方 clipPath 裁剪）。
 * 只保留可见窗口内的位置，控制 SVG 节点数。
 */
export function tickerPositions(
  slots: TickerSlot[],
  gap: number,
  rowWidth: number,
  rowPhase: number,
  t: number,
  rowSpeed: number,
  loopSeconds: number,
): Positioned[] {
  if (slots.length === 0) return [];
  const offsets: number[] = [];
  let acc = 0;
  for (const slot of slots) {
    offsets.push(acc);
    acc += slot.width + gap;
  }
  const cycle = acc;
  if (cycle <= 0) return [];

  // 行级错相以「周期」为单位；项级相位同样以周期为单位（0..1 均匀错开）
  const scroll = rowPhase * cycle + t * rowSpeed * (cycle / loopSeconds);
  // 出血余量取「最宽单元」，否则宽字标会在边缘被提前裁掉
  const widest = slots.reduce((m, s) => Math.max(m, s.width), 0);
  const pad = gap + widest;
  // k 平铺范围由 scroll 实际值推导：t 在 [0, loop) 内推进时 scroll 可接近两个周期。
  const kMin = Math.floor((-pad - scroll) / cycle) - 1;
  const kMax = Math.ceil((rowWidth + pad - scroll) / cycle) + 1;
  const out: Positioned[] = [];
  for (let k = kMin; k <= kMax; k++) {
    for (let j = 0; j < slots.length; j++) {
      const slot = slots[j];
      const offset = offsets[j];
      if (!slot || offset === undefined) continue;
      const x = offset + (slot.item.phase ?? 0) * cycle + scroll + k * cycle;
      // 判可见要考虑单元自身宽度：宽字标只要左边缘还在窗口内就得画
      if (x + slot.width >= -pad && x <= rowWidth + pad) {
        out.push({ item: slot.item, x, width: slot.width });
      }
    }
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
  // 起点必须取**第一个周期**，不能用 1——LCM 没有「1 是中性元」这回事：
  // LCM(1, 2.5) = 5，会把 2.5s 的周期虚报成 5s。整数周期时碰巧无害
  // （4 是 1 的倍数），速度一调到 1.6×（周期 2.5s）就暴露。
  let num: number | null = null;
  let den = 1;
  for (const p of periods) {
    if (p <= 0) continue;
    const [pn, pd] = toFraction(p);
    if (num === null) {
      num = pn;
      den = pd;
      continue;
    }
    const g1 = gcd(num, pn);
    num = (num / g1) * pn;
    den = gcd(den, pd);
  }
  return num === null ? 1 : num / den;
}
