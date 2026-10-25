import { describe, it, expect } from 'vitest';
import { cycleWidth, loopDuration, tickerPositions } from '../src/core/ticker';
import type { TickerItem } from '../src/core/types';

const items: TickerItem[] = [
  { icon: 'emoji:💸', phase: 0 },
  { icon: 'emoji:🚀', phase: 0.33 },
  { icon: 'emoji:🫡', phase: 0.66 },
];
const spacing = 100;
const loop = 4;

/** 位置集合取 3 位小数，消除浮点粉尘 */
const xs = (t: number, speed = 1, phase = 0) =>
  tickerPositions(items, spacing, 1080, phase, t, speed, loop)
    .map((p) => Math.round(p.x * 1000) / 1000)
    .sort((a, b) => a - b);

describe('cycleWidth', () => {
  it('= itemCount × spacing（无缝不变量）', () => {
    expect(cycleWidth(3, 100)).toBe(300);
  });
});

describe('tickerPositions', () => {
  it('覆盖整行宽度（含跨边界重复项）', () => {
    const pos = tickerPositions(items, spacing, 1080, 0.37, 0, 1, loop);
    const min = Math.min(...pos.map((p) => p.x));
    const max = Math.max(...pos.map((p) => p.x));
    expect(min).toBeLessThanOrEqual(0);
    expect(max).toBeGreaterThanOrEqual(1080);
  });

  it('推进一个循环周期后可见布局完全一致（无缝循环，含反向）', () => {
    // 断言可见区域 [0, rowWidth]：一个周期后每个图标的可见位置逐一相同。
    // （含出血边界的窗口集不是周期不变量——余量宽度非周期整数倍，点数随对齐漂移）
    const visible = (t: number, speed = 1) =>
      tickerPositions(items, spacing, 1080, 0, t, speed, loop)
        .filter((p) => p.x >= 0 && p.x <= 1080)
        .map((p) => Math.round(p.x * 1000) / 1000)
        .sort((a, b) => a - b);
    expect(visible(loop)).toEqual(visible(0));
    expect(visible(loop, -1)).toEqual(visible(0, -1));
  });

  it('行间错相产生不同布局', () => {
    expect(xs(0, 1, 0)).not.toEqual(xs(0, 1, 0.37));
  });

  it('大相位（0.74）推进一个周期后可见布局一致（回归：k 范围须随 scroll 推导）', () => {
    // 相位 0.74 + 满周期推进 → scroll ≈ 1.74·cycle，写死的 k 下限会丢左侧可见项
    const visible = (t: number) =>
      tickerPositions(items, spacing, 1080, 0.74, t, 1, loop)
        .filter((p) => p.x >= 0 && p.x <= 1080)
        .map((p) => Math.round(p.x * 1000) / 1000)
        .sort((a, b) => a - b);
    expect(visible(loop)).toEqual(visible(0));
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
});
