/**
 * 字体切片选择（纯函数，可单测）。
 *
 * 输入一段文本 + 切片清单，输出覆盖这段文本的最小切片集合。
 * 运行时把选中的切片内嵌进 SVG（exporters/fonts.ts），
 * 未命中的切片一个字节都不发——这是「中文 PNG 跨设备一致」在体积上的可行解。
 */
export interface FontSlice {
  /** public/fonts/ 下的相对文件名 */
  file: string;
  /** CSS unicode-range 原文，如 "U+4e00-9fff,U+3000-303f" */
  ranges: string;
}

const rangeCache = new Map<string, Array<[number, number]>>();

/** 解析 CSS unicode-range 字符串（缓存：同一字符串只解析一次） */
export function parseRanges(ranges: string): Array<[number, number]> {
  const cached = rangeCache.get(ranges);
  if (cached) return cached;
  const out: Array<[number, number]> = [];
  if (ranges.trim()) {
    for (const part of ranges.split(',')) {
      const [lo, hi] = part.replace(/U\+/i, '').trim().split('-');
      const a = parseInt(lo ?? '', 16);
      const b = hi ? parseInt(hi, 16) : a;
      if (Number.isFinite(a) && Number.isFinite(b)) out.push([a, b]);
    }
  }
  rangeCache.set(ranges, out);
  return out;
}

/**
 * 选中覆盖文本所需的最小切片集合（保持清单顺序，确定性输出）。
 * 空 ranges 的切片视为「总是命中」（等价于无 unicode-range 的兜底片）。
 */
export function selectSlices(text: string, slices: FontSlice[]): FontSlice[] {
  const codepoints = new Set<number>();
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined) codepoints.add(cp);
  }
  if (codepoints.size === 0) return [];
  const picked: FontSlice[] = [];
  for (const slice of slices) {
    const ranges = parseRanges(slice.ranges);
    if (ranges.length === 0) {
      picked.push(slice);
      continue;
    }
    outer: for (const [lo, hi] of ranges) {
      for (const cp of codepoints) {
        if (cp >= lo && cp <= hi) {
          picked.push(slice);
          break outer;
        }
      }
    }
  }
  return picked;
}
