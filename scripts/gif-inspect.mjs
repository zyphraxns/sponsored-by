#!/usr/bin/env node
/**
 * GIF 字节解析（验证基础设施，零依赖）。
 *
 *   node scripts/gif-inspect.mjs <file.gif> [more.gif ...]
 *
 * 按 GIF89a 块结构步行解析：逻辑屏幕尺寸 / 全局调色板 / 帧数 /
 * 每帧延迟（厘秒）/ NETSCAPE2.0 循环扩展，并对 M3 判据给出核对结论。
 */
import { readFileSync } from 'node:fs';

function inspect(bytes) {
  const sig = String.fromCharCode(...bytes.slice(0, 6));
  if (sig !== 'GIF89a' && sig !== 'GIF87a') {
    throw new Error(`不是 GIF 文件（头部：${sig}）`);
  }
  const width = bytes[6] | (bytes[7] << 8);
  const height = bytes[8] | (bytes[9] << 8);
  const flags = bytes[10];
  let pos = 13;
  let globalColors = 0;
  if (flags & 0x80) {
    globalColors = 2 << (flags & 0x07);
    pos += 3 * globalColors;
  }

  let frames = 0;
  const delays = [];
  const frameBoxes = [];
  const disposals = [];
  let looped = null;
  let loopCount = null;
  let pendingDelay = null;
  let pendingDisposal = null;

  const skipSubBlocks = () => {
    while (bytes[pos] !== 0) pos += 1 + bytes[pos];
    pos += 1;
  };

  while (pos < bytes.length) {
    const b = bytes[pos];
    if (b === 0x21) {
      const label = bytes[pos + 1];
      pos += 2;
      if (label === 0xf9) {
        // 图形控制扩展：块大小(1) + 标志(1) + 延迟(2) + 透明索引(1)
        pendingDelay = bytes[pos + 2] | (bytes[pos + 3] << 8);
        pendingDisposal = (bytes[pos + 1] >> 2) & 0x07;
        pos += 1 + bytes[pos];
        skipSubBlocks();
      } else if (label === 0xff) {
        const size = bytes[pos];
        const app = String.fromCharCode(...bytes.slice(pos + 1, pos + 1 + size));
        pos += 1 + size;
        if (app === 'NETSCAPE2.0') {
          const subSize = bytes[pos];
          looped = bytes[pos + 1] === 1;
          loopCount = bytes[pos + 2] | (bytes[pos + 3] << 8);
          pos += 1 + subSize;
          skipSubBlocks();
        } else {
          skipSubBlocks();
        }
      } else {
        skipSubBlocks();
      }
    } else if (b === 0x2c) {
      frames++;
      if (pendingDelay !== null) {
        delays.push(pendingDelay);
        disposals.push(pendingDisposal ?? 0);
        pendingDelay = null;
        pendingDisposal = null;
      }
      frameBoxes.push({
        left: bytes[pos + 1] | (bytes[pos + 2] << 8),
        top: bytes[pos + 3] | (bytes[pos + 4] << 8),
        width: bytes[pos + 5] | (bytes[pos + 6] << 8),
        height: bytes[pos + 7] | (bytes[pos + 8] << 8),
      });
      const localFlags = bytes[pos + 9];
      pos += 10;
      if (localFlags & 0x80) pos += 3 * (2 << (localFlags & 0x07));
      pos += 1; // LZW 最小码长
      skipSubBlocks();
    } else if (b === 0x3b) {
      break;
    } else {
      throw new Error(`意外字节 0x${b.toString(16)} @ ${pos}（解析可能已偏离）`);
    }
  }

  const uniqueDelays = [...new Set(delays)];
  const uniqueDisposals = [...new Set(disposals)];
  const croppedFrames = frameBoxes.filter((f) => f.width < width || f.height < height).length;
  const durationMs = delays.reduce((a, d) => a + d * 10, 0);
  return {
    file: '',
    sig,
    width,
    height,
    globalColors,
    frames,
    delaysCs: uniqueDelays,
    disposals: uniqueDisposals,
    croppedFrames,
    durationMs,
    looped,
    loopCount,
    bytes: bytes.length,
  };
}

function verdict(r) {
  const checks = [
    ['GIF89a', r.sig === 'GIF89a'],
    ['1080×1080', r.width === 1080 && r.height === 1080],
    ['无限循环', r.looped === true && r.loopCount === 0],
    ['帧延迟 6cs（60ms ≈ 16fps）', r.delaysCs.length === 1 && r.delaysCs[0] === 6],
    ['帧数 67', r.frames === 67],
    ['时长 ≈4s', r.durationMs >= 3900 && r.durationMs <= 4100],
    ['< 2 MB（M3 判据）', r.bytes < 2 * 1024 * 1024],
  ];
  return checks;
}

for (const file of process.argv.slice(2)) {
  const r = inspect(new Uint8Array(readFileSync(file)));
  r.file = file;
  console.log(`\n=== ${file} ===`);
  console.log(
    `${r.sig} ${r.width}×${r.height}｜${r.frames} 帧｜延迟 ${r.delaysCs.join('/')} cs｜时长 ${(r.durationMs / 1000).toFixed(2)}s｜` +
      `循环 ${r.looped ? `是（count=${r.loopCount}${r.loopCount === 0 ? '，无限' : ''}）` : '否'}｜` +
      `disposal ${r.disposals.join('/')}｜裁剪帧 ${r.croppedFrames}/${r.frames}｜` +
      `全局色表 ${r.globalColors}｜${(r.bytes / 1024).toFixed(1)} KB`,
  );
  for (const [name, pass] of verdict(r)) {
    console.log(`  ${pass ? '✓' : '✗'} ${name}`);
  }
}
