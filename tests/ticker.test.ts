import { describe, it, expect } from 'vitest';
import { cycleWidth, loopDuration, tickerPositions } from '../src/core/ticker';
import type { TickerSlot } from '../src/core/ticker';

/** 等宽单元（emoji 场景） */
const slots: TickerSlot[] = [
  { item: { icon: 'emoji:💸', phase: 0 }, width: 100 },
  { item: { icon: 'emoji:🚀', phase: 0.33 }, width: 100 },
  { item: { icon: 'emoji:🫡', phase: 0.66 }, width: 100 },
];
const gap = 0;
const loop = 4;
const ROW = 1080;

/** 变宽单元（完整 logo 场景）：宽度差数倍 */
const mixed: TickerSlot[] = [
  { item: { icon: 'simple-icons:x', label: 'X' }, width: 60 },
  { item: { icon: 'simple-icons:tailwindcss', label: 'Tailwind CSS' }, width: 420 },
  { item: { icon: 'simple-icons:github', label: 'GitHub' }, width: 200 },
];

const xs = (t: number, speed = 1, phase = 0) =>
  tickerPositions(slots, gap, ROW, phase, t, speed, loop)
    .map((p) => Math.round(p.x * 1000) / 1000)
    .sort((a, b) => a - b);

const visibleXs = (t: number, speed = 1, phase = 0, set = slots, g = gap) =>
  tickerPositions(set, g, ROW, phase, t, speed, loop)
    .filter((p) => p.x >= 0 && p.x <= ROW)
    .map((p) => Math.round(p.x * 1000) / 1000)
    .sort((a, b) => a - b);

describe('cycleWidth', () => {
  it('等宽单元 = 单元数 × (宽度 + gap)', () => {
    expect(cycleWidth(slots, gap)).toBe(300);
    expect(cycleWidth(slots, 20)).toBe(360);
  });

  it('变宽单元 = Σ 宽度 + n × gap（不是「数量 × 平均宽度」）', () => {
    expect(cycleWidth(mixed, 0)).toBe(680);
    expect(cycleWidth(mixed, 10)).toBe(710);
  });
});

describe('tickerPositions', () => {
  it('覆盖整行宽度（含跨边界重复项）', () => {
    const pos = tickerPositions(slots, gap, ROW, 0.37, 0, 1, loop);
    expect(Math.min(...pos.map((p) => p.x))).toBeLessThanOrEqual(0);
    expect(Math.max(...pos.map((p) => p.x))).toBeGreaterThanOrEqual(ROW);
  });

  it('推进一个循环周期后可见布局完全一致（无缝循环，含反向）', () => {
    expect(visibleXs(loop)).toEqual(visibleXs(0));
    expect(visibleXs(loop, -1)).toEqual(visibleXs(0, -1));
  });

  it('变宽单元推进一个周期后仍无缝（本次重写的核心不变量）', () => {
    expect(visibleXs(loop, 1, 0, mixed, 16)).toEqual(visibleXs(0, 1, 0, mixed, 16));
    expect(visibleXs(loop, -1, 0.3, mixed, 16)).toEqual(visibleXs(0, -1, 0.3, mixed, 16));
  });

  it('变宽单元不会因宽度差异丢失可见项', () => {
    // 让滚动偏移正好落在 100px：宽字标（宽 200）左边缘处于 -116，
    // 只要还有一部分伸进窗口就必须画出来（旧实现按等距单位判可见会漏）。
    const cycle = cycleWidth(mixed, 16); // 60+420+200 + 3×16 = 728
    const t = (100 / cycle) * loop; // scroll = 100
    const pos = tickerPositions(mixed, 16, ROW, 0, t, 1, loop);
    const straddling = pos.filter((p) => p.x < 0 && p.x + p.width > 0);
    expect(straddling.length).toBeGreaterThan(0);
  });

  it('行间错相产生不同布局', () => {
    expect(xs(0, 1, 0)).not.toEqual(xs(0, 1, 0.37));
  });

  it('项级相位以周期为单位均匀错开', () => {
    const pos = tickerPositions(slots, gap, ROW, 0, 0, 0, loop);
    // 三个相位 0 / .33 / .66 × cycle(300) → 同一周期内应出现相隔约 100 的位置
    const near0 = pos.filter((p) => Math.abs(p.x % 300) < 1 || Math.abs((p.x % 300) - 300) < 1);
    expect(near0.length).toBeGreaterThan(0);
  });

  it('大相位（0.74）推进一个周期后可见布局一致（回归：k 范围须随 scroll 推导）', () => {
    expect(visibleXs(loop, 1, 0.74)).toEqual(visibleXs(0, 1, 0.74));
    expect(visibleXs(loop, 1, 0.74, mixed, 16)).toEqual(visibleXs(0, 1, 0.74, mixed, 16));
  });

  it('空单元列表返回空（不除零）', () => {
    expect(tickerPositions([], gap, ROW, 0, 0, 1, loop)).toEqual([]);
  });
});

describe('loopDuration', () => {
  it('相同周期取本身', () => {
    expect(loopDuration([4, 4, 4])).toBe(4);
  });
  it('整数周期取 LCM', () => {
    expect(loopDuration([2, 3])).toBe(6);
  });
  it('小数周期按分数 LCM（±0.25 速度抖动场景）', () => {
    expect(loopDuration([0.8, 1.25])).toBe(20);
  });
  it('非整数周期不再被虚报成 2 倍（回归：起点不能用 1）', () => {
    // 速度 1.6× → 周期 2.5s；旧实现 LCM(1, 2.5) = 5，多算一倍
    expect(loopDuration([2.5])).toBe(2.5);
    expect(loopDuration([2.5, 2.5, 2.5])).toBe(2.5);
    expect(loopDuration([2.5, 4])).toBe(20); // LCM(5/2, 4) = 20
  });
  it('空列表返回 1（不除零）', () => {
    expect(loopDuration([])).toBe(1);
  });
});
