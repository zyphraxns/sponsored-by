/**
 * 自动排版估算（M0 启发式版）：
 * 在无 canvas 测量的前提下，按字符类别估算文本宽度，驱动 auto-shrink。
 * M1 接入真实测量（canvas measureText）后可平滑替换本文件。
 */

/** CJK 及全角标点按全宽（1em）计 */
const CJK = /[\u3000-\u303e\uff00-\uffef\u4e00-\u9fff\u3400-\u4dbf]/;

/** 估算文本像素宽度 */
export function estimateTextWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const ch of text) {
    if (CJK.test(ch)) em += 1.0;
    else if (ch === ' ') em += 0.32;
    else if (ch >= 'A' && ch <= 'Z') em += 0.66;
    else if (ch >= '0' && ch <= '9') em += 0.6;
    else em += 0.56; // 小写与常见符号
  }
  return em * fontSize * 1.04; // 粗体膨胀
}

/** auto-shrink：不超过高度上限的前提下，逐级收缩到宽度上限内 */
export function fitFontSize(text: string, boxW: number, boxH: number): number {
  let size = boxH;
  while (size > 8 && estimateTextWidth(text, size) > boxW) size -= 1;
  return size;
}
