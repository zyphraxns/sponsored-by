#!/usr/bin/env node
/**
 * MP4 字节级核对（独立于 mediabunny 的第三方视角）。
 *
 * 自检页里的回读用的是 mediabunny 自己的解封装器——同一份代码库既写又读，
 * 有可能「错得一致」。这里直接按 ISO/IEC 14496-12 解析 box，验证容器结构
 * 本身是标准可读的：ftyp 品牌、moov 位置（fastStart）、mvhd 时长、tkhd 尺寸、
 * stsd 编码格式、stts 帧数。
 *
 * 用法：node scripts/mp4-inspect.mjs <file.mp4> [file2.mp4 ...]
 */
import { readFileSync } from 'node:fs';

function readBoxes(buf, start, end) {
  const boxes = [];
  let pos = start;
  while (pos + 8 <= end) {
    let size = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    let header = 8;
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(pos + 8));
      header = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < header || pos + size > end) break;
    boxes.push({ type, start: pos, body: pos + header, end: pos + size });
    pos += size;
  }
  return boxes;
}

const find = (boxes, type) => boxes.find((b) => b.type === type) ?? null;

/** mdhd：媒体时基（stts 的 delta 以此为单位，不是 mvhd 的时基） */
function parseMdhd(buf, box) {
  const v = buf[box.body];
  if (v === 1) {
    return { timescale: buf.readUInt32BE(box.body + 20), duration: Number(buf.readBigUInt64BE(box.body + 24)) };
  }
  return { timescale: buf.readUInt32BE(box.body + 12), duration: buf.readUInt32BE(box.body + 16) };
}

function parseMvhd(buf, box) {
  const v = buf[box.body];
  if (v === 1) {
    return {
      timescale: buf.readUInt32BE(box.body + 20),
      duration: Number(buf.readBigUInt64BE(box.body + 24)),
    };
  }
  return {
    timescale: buf.readUInt32BE(box.body + 12),
    duration: buf.readUInt32BE(box.body + 16),
  };
}

function parseTkhd(buf, box) {
  const v = buf[box.body];
  const offset = v === 1 ? 88 : 76;
  return {
    width: buf.readUInt32BE(box.body + offset) / 65536,
    height: buf.readUInt32BE(box.body + offset + 4) / 65536,
  };
}

/** stsd 首个 sample entry 的格式码（avc1 / hvc1 / vp09 / av01） */
function parseStsd(buf, box) {
  const entry = box.body + 8; // version/flags(4) + entry_count(4)
  return {
    format: buf.toString('latin1', entry + 4, entry + 8),
    width: buf.readUInt16BE(entry + 8 + 24),
    height: buf.readUInt16BE(entry + 8 + 26),
  };
}

/** stts 累计样本数（= 帧数）与样本时长分布 */
function parseStts(buf, box) {
  const count = buf.readUInt32BE(box.body + 4);
  let samples = 0;
  const deltas = new Set();
  for (let i = 0; i < count; i++) {
    const entry = box.body + 8 + i * 8;
    const n = buf.readUInt32BE(entry);
    const delta = buf.readUInt32BE(entry + 4);
    samples += n;
    deltas.add(delta);
  }
  return { samples, deltas: [...deltas] };
}

function inspect(file) {
  const buf = readFileSync(file);
  const top = readBoxes(buf, 0, buf.length);
  const order = top.map((b) => b.type);

  const ftyp = find(top, 'ftyp');
  const brand = ftyp ? buf.toString('latin1', ftyp.body, ftyp.body + 4) : '?';
  const moov = find(top, 'moov');
  if (!moov) throw new Error('没有 moov box（文件不完整）');

  const moovChildren = readBoxes(buf, moov.body, moov.end);
  const mvhd = parseMvhd(buf, find(moovChildren, 'mvhd'));
  const seconds = mvhd.timescale ? mvhd.duration / mvhd.timescale : NaN;

  const trak = find(moovChildren, 'trak');
  const trakChildren = trak ? readBoxes(buf, trak.body, trak.end) : [];
  const tkhd = trak ? parseTkhd(buf, find(trakChildren, 'tkhd')) : { width: 0, height: 0 };

  // trak → mdia → minf → stbl → { stsd, stts }
  let codec = '?';
  let stsdSize = { width: 0, height: 0 };
  let stts = { samples: 0, deltas: [] };
  let media = { timescale: 0, duration: 0 };
  const mdia = find(trakChildren, 'mdia');
  if (mdia) {
    const mdiaChildren = readBoxes(buf, mdia.body, mdia.end);
    const mdhd = find(mdiaChildren, 'mdhd');
    if (mdhd) media = parseMdhd(buf, mdhd);
    const minf = find(mdiaChildren, 'minf');
    if (minf) {
      const stbl = find(readBoxes(buf, minf.body, minf.end), 'stbl');
      if (stbl) {
        const stblChildren = readBoxes(buf, stbl.body, stbl.end);
        const stsdBox = find(stblChildren, 'stsd');
        if (stsdBox) {
          const parsed = parseStsd(buf, stsdBox);
          codec = parsed.format;
          stsdSize = { width: parsed.width, height: parsed.height };
        }
        const sttsBox = find(stblChildren, 'stts');
        if (sttsBox) stts = parseStts(buf, sttsBox);
      }
    }
  }

  return {
    file,
    bytes: buf.length,
    brand,
    boxOrder: order,
    fastStart: order.indexOf('moov') < order.indexOf('mdat') && order.indexOf('moov') !== -1,
    seconds,
    timescale: mvhd.timescale,
    tkhd: { w: Math.round(tkhd.width), h: Math.round(tkhd.height) },
    codec,
    stsd: stsdSize,
    frames: stts.samples,
    mediaSeconds: media.timescale ? media.duration / media.timescale : NaN,
    frameSeconds: media.timescale && stts.deltas.length === 1 ? stts.deltas[0] / media.timescale : NaN,
    fps: seconds > 0 ? stts.samples / seconds : NaN,
    deltas: stts.deltas,
    mediaTimescale: media.timescale,
  };
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node scripts/mp4-inspect.mjs <file.mp4> [...]');
  process.exit(2);
}

let exitCode = 0;
for (const file of files) {
  try {
    const r = inspect(file);
    const checks = [
      ['ftyp', r.boxOrder[0] === 'ftyp'],
      ['moov 在 mdat 前（fastStart）', r.fastStart],
      ['时长 > 0', r.seconds > 0],
      ['tkhd 尺寸与 stsd 一致', r.tkhd.w === r.stsd.width && r.tkhd.h === r.stsd.height],
      ['编码格式可识别', /^(avc1|avc3|hvc1|hev1|vp09|av01)$/.test(r.codec)],
      ['帧数 ≥ 1', r.frames >= 1],
    ];
    console.log(
      `${file}\n  ${(r.bytes / 1024).toFixed(1)} KB｜ftyp ${r.brand}｜box 顺序 ${r.boxOrder.join(',')}\n` +
        `  ${r.tkhd.w}×${r.tkhd.h}｜${r.codec}｜时长 ${r.seconds.toFixed(2)}s｜${r.frames} 帧｜${r.fps.toFixed(1)} fps\n` +
        `  每帧 ${Number.isFinite(r.frameSeconds) ? `${(r.frameSeconds * 1000).toFixed(1)} ms` : '多样'}（stts delta ${r.deltas.join('/')} @ 媒体时基 ${r.mediaTimescale}）`,
    );
    for (const [label, ok] of checks) {
      console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${label}`);
      if (!ok) exitCode = 1;
    }
  } catch (err) {
    console.error(`${file}: ${err.message}`);
    exitCode = 1;
  }
}
process.exit(exitCode);
