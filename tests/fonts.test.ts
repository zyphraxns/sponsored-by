import { describe, it, expect } from 'vitest';
import { parseRanges, selectSlices } from '../src/core/font-slices';
import { NOTO_SLICES } from '../src/assets/fonts';

describe('parseRanges', () => {
  it('解析单点与区间', () => {
    expect(parseRanges('U+4e00-9fff,U+3000')).toEqual([
      [0x4e00, 0x9fff],
      [0x3000, 0x3000],
    ]);
  });
  it('空串 → 空数组（视为兜底片）', () => {
    expect(parseRanges('')).toEqual([]);
  });
});

describe('selectSlices', () => {
  const fixture = [
    { file: 'latin.woff2', ranges: 'U+0000-00ff' },
    { file: 'cjk-a.woff2', ranges: 'U+4e00-4fff' },
    { file: 'cjk-b.woff2', ranges: 'U+5000-5fff' },
    { file: 'punct.woff2', ranges: 'U+3000-303f' },
  ];

  it('纯 ASCII → 只命中拉丁片', () => {
    expect(selectSlices('SPONSORED BY', fixture).map((s) => s.file)).toEqual(['latin.woff2']);
  });

  it('中文命中对应区间', () => {
    // 伀 = U+4F00（4e00-4fff 段）；全 = U+5168（5000-5fff 段）
    expect(selectSlices('伀', fixture).map((s) => s.file)).toEqual(['cjk-a.woff2']);
    expect(selectSlices('全', fixture).map((s) => s.file)).toEqual(['cjk-b.woff2']);
  });

  it('混排 + 中文标点 → 按清单顺序确定性输出', () => {
    // 。= U+3002（3000-303f 段）
    expect(selectSlices('SPONSORED 伀。', fixture).map((s) => s.file)).toEqual([
      'latin.woff2',
      'cjk-a.woff2',
      'punct.woff2',
    ]);
  });

  it('空文本 → 不选任何切片', () => {
    expect(selectSlices('', fixture)).toEqual([]);
  });

  it('无 unicode-range 的兜底片总是命中', () => {
    const withFallback = [...fixture, { file: 'fallback.woff2', ranges: '' }];
    expect(selectSlices('A', withFallback).map((s) => s.file)).toEqual(['latin.woff2', 'fallback.woff2']);
  });
});

describe('真实 Noto 切片清单（构建期产物）', () => {
  it('清单非空且每片都有 ranges', () => {
    expect(NOTO_SLICES.length).toBeGreaterThan(50);
    for (const s of NOTO_SLICES) expect(s.ranges.length).toBeGreaterThan(0);
  });

  it('默认中文标题命中的切片能覆盖全部字符', () => {
    const text = '由以下品牌赞助';
    const picked = selectSlices(text, NOTO_SLICES);
    expect(picked.length).toBeGreaterThan(0);
    // 每个字符都必须落在某个被选中切片的区间里
    const ranges = picked.flatMap((s) => parseRanges(s.ranges));
    for (const ch of text) {
      const cp = ch.codePointAt(0) as number;
      const covered = ranges.some(([lo, hi]) => cp >= lo && cp <= hi);
      expect(covered, `「${ch}」U+${cp.toString(16)} 未被任何选中切片覆盖`).toBe(true);
    }
  });

  it('同一文本两次选择结果一致（确定性，便于缓存）', () => {
    const a = selectSlices('特别感谢', NOTO_SLICES).map((s) => s.file);
    const b = selectSlices('特别感谢', NOTO_SLICES).map((s) => s.file);
    expect(a).toEqual(b);
  });
});
