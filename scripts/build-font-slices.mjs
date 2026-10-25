#!/usr/bin/env node
/**
 * 中文字体切片构建（M4）。
 *
 * 源：@fontsource/noto-sans-sc 的 700.css（devDependency，OFL 1.1 可自托管）。
 * 产出：
 *   1. public/fonts/noto-sans-sc/*.woff2 —— 静态切片资产，运行时按需 fetch
 *   2. src/assets/font-slices.json —— 切片 → unicode-range 映射表（导入 JS bundle）
 *
 * 为什么不整包内嵌：完整 Noto Sans SC 数 MB；而一段标题文本通常只落到 1~3 个
 * 切片（每片约 30KB）。运行时「按需 fetch → base64 内嵌」让 SVG 自包含且体积可控——
 * 这正是 SPEC §3.2 unicode-range 切片策略在 <img> 渲染约束下的落地形态。
 *
 * 重新生成：npm run fonts:slices
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'node_modules', '@fontsource', 'noto-sans-sc');
const cssPath = join(pkgDir, '700.css');
const outDir = join(root, 'public', 'fonts', 'noto-sans-sc');
const manifestPath = join(root, 'src', 'assets', 'font-slices.json');

if (!existsSync(cssPath)) {
  console.error(`缺少 ${cssPath}——先 npm install（@fontsource/noto-sans-sc 是 devDependency）`);
  process.exit(1);
}

const css = readFileSync(cssPath, 'utf8');

// 逐个 @font-face 块解析：url 与 unicode-range 独立提取（顺序不假定）
const blocks = css.split('@font-face').slice(1);
const slices = [];
for (const block of blocks) {
  const urlMatch = block.match(/url\(\.\/files\/(noto-sans-sc-[0-9]+-700-normal\.woff2)\)/);
  if (!urlMatch) continue;
  const rangeMatch = block.match(/unicode-range:\s*([^;}]+)/);
  slices.push({ file: urlMatch[1], ranges: rangeMatch ? rangeMatch[1].trim() : '' });
}
if (slices.length === 0) {
  console.error('700.css 中未解析到任何切片——@fontsource 包结构可能已变，请检查解析逻辑');
  process.exit(1);
}

// 拷贝切片（先清旧目录，保证 manifest 与磁盘一致）
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
let bytes = 0;
for (const s of slices) {
  const src = join(pkgDir, 'files', s.file);
  if (!existsSync(src)) {
    console.error(`切片文件缺失：${src}`);
    process.exit(1);
  }
  cpSync(src, join(outDir, s.file));
  bytes += readFileSync(src).length;
}

writeFileSync(manifestPath, `${JSON.stringify(slices, null, 2)}\n`);
console.log(
  `✓ ${slices.length} 个切片 → public/fonts/noto-sans-sc/（${(bytes / 1024).toFixed(0)} KB）`,
);
console.log(`✓ manifest → src/assets/font-slices.json`);

// 诊断：默认双语文案各命中哪些切片（验证「常用字只落 1~3 片」的假设）
function parseRanges(s) {
  return s
    .split(',')
    .map((r) => {
      const [a, b] = r.replace('U+', '').trim().split('-');
      return [parseInt(a, 16), b ? parseInt(b, 16) : parseInt(a, 16)];
    });
}
function slicesFor(text) {
  const cps = new Set([...text].map((c) => c.codePointAt(0)));
  const hit = new Set();
  for (const s of slices) {
    for (const [lo, hi] of parseRanges(s.ranges)) {
      for (const cp of cps) {
        if (cp >= lo && cp <= hi) hit.add(s.file);
      }
    }
  }
  return [...hit];
}
for (const text of ['由以下品牌赞助', '特别感谢', '一帮人造的', '依然无人赞助']) {
  console.log(`  「${text}」→ ${slicesFor(text).join(', ') || '（无 CJK 命中）'}`);
}
