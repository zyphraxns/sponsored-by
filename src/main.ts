import { canvasSize, loopSecondsFor, scene, sceneLogoSvgs } from './core/scene';
import { createDefaultState } from './app-state';
import { DEFAULT_TEMPLATE_ID, getTemplate, templateChoices } from './templates';
import {
  PLATFORMS,
  deriveExportState,
  estimateSize,
  exceedsLimit,
  formatBytes,
  getPreset,
} from './core/presets';
import type { PlatformId } from './core/presets';
import { ui } from './i18n';
import type { Locale, Ratio, SceneState, TickerItem } from './core/types';
import { exportGif, gifFilename } from './exporters/gif';
import { exportPng } from './exporters/png';
import { pngFilename, svgFilename, svgFileContent, svgToBlob } from './exporters/svg';

/** 当前选择（UI 的唯一真源；state 由它派生，切换 = 重建） */
interface Selection {
  templateId: string;
  variantId?: string;
  locale: Locale;
  ratio: Ratio;
  platform: PlatformId;
  /** 用户选中的图标列表（空 = 用模板默认） */
  icons: TickerItem[];
  /** 用户文案覆盖 */
  text: SceneState['text'];
  /** 用户色板覆盖（只含参与渲染的键；accent 尚未接入场景渲染，见 scene.ts 说明） */
  palette: NonNullable<SceneState['palette']>;
  /** 用户覆盖的行数；undefined = 跟随模板默认（不能硬编码 3，否则将来 4 行的模板会被压回去） */
  rows?: number;
  /** 用户覆盖的速度倍率（有理数，保证 LCM 周期有限） */
  speed: number;
}

let sel: Selection = {
  templateId: DEFAULT_TEMPLATE_ID,
  locale: 'en',
  ratio: '1:1',
  platform: 'none',
  icons: [],
  text: {},
  palette: {},
  speed: 1,
};
let state: SceneState = createDefaultState(sel);
let loopSeconds = loopSecondsFor(state);
let start = performance.now();

const stageHost = document.getElementById('canvas');
if (!stageHost) throw new Error('#canvas mount point not found');
// 显式标注：narrowed 类型在闭包内不保留，renderAt 需要非空引用
const stage: HTMLElement = stageHost;

function renderAt(t: number): void {
  // 逐帧整段重渲：SVG 约 5 KB / 25 个节点，60fps 预算内；
  // 预览与导用同一个 scene()，架构上不可能漂移。
  stage.innerHTML = scene(state, t);
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// M2 时间轴：t 随真实时间推进，循环播放。无缝性由 ticker 数学 + scene 级单测保证。
function frame(now: number): void {
  renderAt(((now - start) / 1000) % loopSeconds);
  requestAnimationFrame(frame);
}

if (reducedMotion) {
  // 预览尊重系统「减少动态」偏好：渲染静态帧。
  // 导出路径不受影响——导出 GIF 是显式用户动作，产物仍会动。
  renderAt(0);
} else {
  requestAnimationFrame(frame);
}

// —— 平台预设 / 版式 / 语言 / 比例切换 ——
const platformSelect = document.getElementById('platform-select') as HTMLSelectElement | null;
const templateSelect = document.getElementById('template-select') as HTMLSelectElement | null;
const localeBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('#locale-switch .seg'));
const ratioBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('#ratio-switch .seg'));
const caption = document.getElementById('caption');
const presetNote = document.getElementById('preset-note');
const estimateEl = document.getElementById('estimate');

function selectValue(): string {
  return `${sel.templateId}|${sel.variantId ?? ''}`;
}

/** 平台下拉：文案随语言，值域固定（来自 presets 表） */
function renderPlatformOptions(locale: Locale): void {
  if (!platformSelect) return;
  platformSelect.replaceChildren();
  for (const preset of PLATFORMS) {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.name[locale];
    platformSelect.append(option);
  }
}

/** 重建版式下拉：按模板分组（optgroup），文案随语言 */
function renderTemplateOptions(locale: Locale): void {
  if (!templateSelect) return;
  templateSelect.replaceChildren();
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const choice of templateChoices(locale)) {
    let group = groups.get(choice.group);
    if (!group) {
      group = document.createElement('optgroup');
      group.label = choice.group;
      groups.set(choice.group, group);
      templateSelect.append(group);
    }
    const option = document.createElement('option');
    option.value = `${choice.templateId}|${choice.variantId ?? ''}`;
    // 变体项加缩进前缀，视觉上从属于所属模板
    option.textContent = choice.variantId ? `　${choice.label}` : choice.label;
    group.append(option);
  }
}

/**
 * 页脚元信息：版式摘要 / 平台播放行为提示 / 体积预估。
 * 预估走 presets 的标定模型，任何时候都显示「预估 vs 上限」——
 * 这是 SPEC §5 要求的「导出前显示」。
 */
function refreshMeta(): void {
  const t = ui(state.locale);
  const preset = getPreset(sel.platform);

  if (caption) {
    const size = canvasSize(state.template, state.ratio);
    const base = state.template.name[state.locale];
    const variant = getTemplate(sel.templateId).variants?.find((v) => v.id === sel.variantId);
    const name = variant ? `${base} / ${variant.name[state.locale]}` : base;
    caption.textContent = t.caption({
      template: name,
      ratio: state.ratio,
      w: size.w,
      h: size.h,
      loop: loopSeconds,
    });
  }

  if (presetNote) presetNote.textContent = preset.note[state.locale];

  if (estimateEl) {
    // 预估必须用**导出时真正会用的状态**（微信档会降像素/帧率）
    const derived = deriveExportState(state, sel.platform, 'gif');
    const size = canvasSize(derived.template, derived.ratio);
    const est = estimateSize(state, sel.platform, 'gif');
    const text = t.estimate({
      format: 'GIF',
      w: size.w,
      h: size.h,
      estimate: est.bytes === null ? null : formatBytes(est.bytes),
      limit: est.limit === null ? null : formatBytes(est.limit),
      over: est.over,
    });
    estimateEl.textContent = text;
    estimateEl.classList.toggle('over', est.over);
  }
}

/** 切换语言时重算的全部 chrome */
function refreshChrome(): void {
  const t = ui(state.locale);
  document.documentElement.lang = t.htmlLang;
  document.title = t.docTitle;

  for (const [id, text] of [
    ['label-platform', t.platformLabel],
    ['label-layout', t.layoutLabel],
    ['label-language', t.languageLabel],
    ['label-ratio', t.ratioLabel],
    ['label-icons', t.iconLabel],
    ['label-title', t.titleLabel],
    ['label-rows', t.rowsLabel],
    ['label-speed', t.speedLabel],
    ['label-palette', t.paletteLabel],
    ['icon-panel-title', t.iconPanelTitle],
    ['export-gif', t.exportGif],
    ['export-mp4', t.exportMp4],
    ['export-png', t.exportPng],
    ['export-svg', t.exportSvg],
    ['icon-close', t.iconPanelClose],
    ['icon-clear', t.iconPanelClear],
  ] as const) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  if (iconSearch) iconSearch.placeholder = t.iconPanelSearch;
  if (iconHint) iconHint.textContent = t.iconPanelHint;
  // 按钮本体也是 chrome：index.html 里的静态文字是中文，英文界面下会露出来
  const iconBtnEl = document.getElementById('icon-btn');
  if (iconBtnEl) {
    iconBtnEl.textContent = t.iconLabel;
    iconBtnEl.title = t.iconPanelTitle;
  }

  // 行数 / 速度滑块同步 UI（读 state 而非 sel：sel.rows 可能是 undefined）
  if (rowsRange) rowsRange.value = String(state.rows);
  if (rowsVal) rowsVal.textContent = String(state.rows);
  if (speedRange) speedRange.value = String(Math.round(sel.speed * 100));
  if (speedVal) speedVal.textContent = speedLabel(sel.speed);

  renderPaletteSwatches();

  renderPlatformOptions(state.locale);
  if (platformSelect) platformSelect.value = sel.platform;

  renderTemplateOptions(state.locale);
  if (templateSelect) templateSelect.value = selectValue();

  for (const btn of localeBtns) {
    btn.setAttribute('aria-pressed', String(btn.dataset.locale === state.locale));
  }
  for (const btn of ratioBtns) {
    btn.setAttribute('aria-pressed', String(btn.dataset.ratio === state.ratio));
  }

  if (mp4Btn) {
    mp4Btn.disabled = !webCodecsOk;
    mp4Btn.title = webCodecsOk ? t.mp4LimitHint : t.mp4Unsupported;
  }

  // 标题输入框：显示当前模板的默认文案（用户覆盖优先）
  const titleLayer = state.template.layers.find((l) => l.type === 'text');
  if (titleInput && titleLayer) {
    const defaultText = state.text[titleLayer.id]?.[state.locale] ?? titleLayer.default[state.locale];
    if (document.activeElement !== titleInput) titleInput.value = defaultText;
  }

  refreshMeta();
}

/**
 * 预览期补齐品牌图标 SVG。
 *
 * scene() 对「没有出现在 iconSvgs 里的非 emoji 图标」是**静默跳过**的（首屏不等 CDN）。
 * 所以选了品牌图标却不预取，画布上什么都不会出现——用户会以为功能坏了。
 * 取完写回 state 即可：rAF 循环每帧重渲染，下一帧自动出现。
 */
async function hydrateIcons(): Promise<void> {
  const { isEmoji, isSimpleIcons, getIconSvg } = await import('./core/simple-icons');
  const need = state.icons.map((i) => i.icon).filter((k) => !isEmoji(k));
  if (need.length === 0) return;
  const have = state.iconSvgs ?? {};
  const missing = need.filter((k) => !(k in have));
  if (missing.length > 0) {
    const next: Record<string, string> = { ...have };
    await Promise.all(
      missing.map(async (key) => {
        if (!isSimpleIcons(key)) return; // upload: 由调用方直接提供内容
        try {
          next[key] = await getIconSvg(key.slice('simple-icons:'.length));
        } catch {
          /* 单个图标拉取失败不拖垮整批 */
        }
      }),
    );
    state.iconSvgs = next;
  }
  // 官方完整字标：有则替代「符号 + 文字」
  const bg = state.palette?.bg ?? state.template.palette.bg;
  const { svgs, aspect } = await sceneLogoSvgs(state, bg);
  if (Object.keys(svgs).length > 0) {
    state.logoSvgs = { ...(state.logoSvgs ?? {}), ...svgs };
    state.logoAspect = { ...(state.logoAspect ?? {}), ...aspect };
  }
}

/**
 * 滑块 / 取色器这类连续输入的轻量重建。
 *
 * 与 apply() 的两点区别，都是踩过的坑：
 * - **不重置时间轴**：滑块用 input 事件连续触发，每次重置 start 会让画面僵在 t=0；
 * - **不刷全量 chrome**：refreshChrome() 会重建版式/平台下拉与色板 DOM，
 *   拖动过程中把正在操作的 <input> 销毁掉。
 */
function rebuildLive(partial: Partial<Selection>): void {
  sel = { ...sel, ...partial };
  state = createDefaultState(sel);
  loopSeconds = loopSecondsFor(state);
  if (reducedMotion) renderAt(0);
  refreshMeta();
}

/** 切换版式 / 语言 / 比例时重建 state。用户内容（icons/text/palette）透传，
 *  避免换版式时把已选图标和文案清空——切换的是版式，不是用户的作品。 */
function apply(partial: Partial<Selection>): void {
  sel = { ...sel, ...partial };
  state = createDefaultState(sel);
  loopSeconds = loopSecondsFor(state);
  start = performance.now(); // 切换后从 t=0 起播，动作干净
  if (reducedMotion) renderAt(0);
  refreshChrome();
  setStatus('');
  void hydrateIcons(); // 品牌图标是异步 CDN 拉取，不阻塞首帧
}

platformSelect?.addEventListener('change', () => {
  // 平台只影响导出参数（派生在导出时发生），预览不动 → 不重建 state、不重置时间轴
  sel = { ...sel, platform: platformSelect.value as PlatformId };
  refreshMeta();
  setStatus('');
});

templateSelect?.addEventListener('change', () => {
  const [templateId, variantId] = templateSelect.value.split('|');
  if (!templateId) return;
  // 色板是版式属性而非用户内容：把 sponsored-by 改成白底再切到 no-sponsors（近黑底），
  // 若继续透传覆盖色，新版式直接糊成一片。换版式一律回到新模板的默认色板。
  apply({ templateId, variantId: variantId || undefined, palette: {} });
});

for (const btn of localeBtns) {
  btn.addEventListener('click', () => {
    const locale = btn.dataset.locale as Locale | undefined;
    if (locale && locale !== state.locale) apply({ locale });
  });
}

for (const btn of ratioBtns) {
  btn.addEventListener('click', () => {
    const ratio = btn.dataset.ratio as Ratio | undefined;
    if (ratio && ratio !== state.ratio) apply({ ratio });
  });
}

// —— 图标面板 ——
//
// 图标选择是本项目区别于「纯 emoji 梗图生成器」的关键能力（SPEC §1 立柱）。
// 面板是异步的（CDN 索引 + 逐个 SVG 预取），所以不阻塞首屏；
// 选中图标后写入 sel.icons → apply() 重建 state → scene() 据此渲染。
const iconBtn = document.getElementById('icon-btn') as HTMLButtonElement | null;
const iconPanel = document.getElementById('icon-panel') as HTMLElement | null;
const iconClose = document.getElementById('icon-close') as HTMLButtonElement | null;
const iconSearch = document.getElementById('icon-search') as HTMLInputElement | null;
const iconGrid = document.getElementById('icon-grid') as HTMLElement | null;
const iconHint = document.getElementById('icon-hint') as HTMLElement | null;
const iconClear = document.getElementById('icon-clear') as HTMLButtonElement | null;
const titleInput = document.getElementById('title-input') as HTMLInputElement | null;

let iconSearchQuery = '';
let iconIndexPromise: Promise<string[]> | null = null;

/** 打开面板：首次加载索引，之后只渲染缓存结果 */
async function openIconPanel(): Promise<void> {
  if (!iconPanel) return;
  if (!iconIndexPromise) iconIndexPromise = loadIconIndex();
  iconPanel.hidden = false;
  titleInput?.blur();
  iconSearch?.focus();
  await renderIconGrid();
}

async function loadIconIndex(): Promise<string[]> {
  const { searchIcons } = await import('./core/simple-icons');
  return searchIcons('');
}

async function renderIconGrid(): Promise<void> {
  if (!iconGrid) return;
  const t = ui(state.locale);
  iconGrid.replaceChildren();
  if (iconHint) iconHint.textContent = t.iconPanelHint;
  iconGrid.textContent = t.iconPanelLoading;

  const { searchIcons, getIconSvg, getIconName, EMOJI_PRESETS } = await import('./core/simple-icons');
  const slugs = await searchIcons(iconSearchQuery);

  // emoji 快捷面板 + simple-icons 结果，共用同一网格。
  // 搜索时不再显示 emoji——用户在找品牌，emjio 只是噪音。
  const cells: Array<{ key: string; label: string; svg?: Promise<string>; emoji?: string }> = [];
  if (!iconSearchQuery) {
    for (const e of EMOJI_PRESETS) cells.push({ key: `emoji:${e}`, label: '', emoji: e });
  }
  for (const s of slugs) cells.push({ key: `simple-icons:${s}`, label: getIconName(s), svg: getIconSvg(s) });

  iconGrid.replaceChildren();
  for (const cell of cells) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-cell';
    btn.setAttribute('role', 'option');
    const selected = sel.icons.some((i) => i.icon === cell.key);
    btn.setAttribute('aria-pressed', String(selected));

    const visual = document.createElement('span');
    visual.className = 'icon-visual';
    if (cell.emoji) {
      visual.className = 'icon-visual emoji';
      visual.textContent = cell.emoji;
    } else if (cell.svg) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.style.width = '32px';
      svg.style.height = '32px';
      cell.svg
        .then((text) => {
          const parser = new DOMParser();
          const doc = parser.parseFromString(text, 'image/svg+xml');
          const path = doc.querySelector('path');
          if (path) {
            path.setAttribute('fill', 'currentColor');
            svg.appendChild(path);
          }
        })
        .catch(() => {});
      visual.appendChild(svg);
    }
    btn.appendChild(visual);

    // emoji 格子不带文字标签（label 为空）——emoji 本身就是图标，重复显示两遍纯属噪音
    if (cell.label) {
      const label = document.createElement('span');
      label.textContent = cell.label;
      btn.appendChild(label);
    }

    btn.addEventListener('click', () => {
      const idx = sel.icons.findIndex((i) => i.icon === cell.key);
      if (idx >= 0) {
        sel.icons.splice(idx, 1);
      } else {
        sel.icons.push({ icon: cell.key, label: cell.label || undefined });
      }
      apply({ icons: sel.icons });
      renderIconGrid();
    });
    iconGrid.appendChild(btn);
  }
}

iconBtn?.addEventListener('click', () => openIconPanel());
iconClose?.addEventListener('click', () => {
  if (iconPanel) iconPanel.hidden = true;
});
iconPanel?.addEventListener('click', (e) => {
  if (e.target === iconPanel && iconPanel) iconPanel.hidden = true;
});
iconSearch?.addEventListener('input', () => {
  iconSearchQuery = iconSearch.value.trim();
  renderIconGrid();
});
iconClear?.addEventListener('click', () => {
  sel.icons = [];
  apply({ icons: sel.icons });
  renderIconGrid();
});

// 标题输入：写入 sel.text（这是重建 state 的唯一来源）并立刻同步到 state.text，
// 实时预览。**必须两边都写**——只写 state.text 的话，用户随后拖任意滑块触发
// rebuildLive() 重建 state 时，标题会静默退回模板默认值。
titleInput?.addEventListener('input', () => {
  const layer = state.template.layers.find((l) => l.type === 'text');
  if (!layer) return;
  const value = titleInput.value;
  const text = { ...sel.text, [layer.id]: { ...sel.text[layer.id], [state.locale]: value } };
  sel.text = text;
  state.text = text;
});

// —— 行数 / 速度 / 色板 ——
const rowsRange = document.getElementById('rows-range') as HTMLInputElement | null;
const rowsVal = document.getElementById('rows-val') as HTMLElement | null;
const speedRange = document.getElementById('speed-range') as HTMLInputElement | null;
const speedVal = document.getElementById('speed-val') as HTMLElement | null;
const paletteSwatches = document.getElementById('palette-swatches') as HTMLElement | null;

/** 把速度滑块值（50..200）映射到有理数倍率，保证 loopDuration 的 LCM 周期有限 */
function quantizeSpeed(pct: number): number {
  // 50→0.5, 100→1, 200→2；中间取 0.05 步长，分母 ≤20
  const raw = pct / 100;
  return Math.round(raw * 20) / 20;
}

function speedLabel(v: number): string {
  return `${Math.round(v * 100) / 100}×`;
}

/**
 * 界面上可调的色板键。
 *
 * 只有 bg / fg 参与场景渲染（见 core/scene.ts 的 palette 取值）。
 * 模板 JSON 里的 accent 是预留位——三份模板都配了醒目的 accent（黄 / 赭 / 红），
 * 语义上指向「大标题色」，但渲染管线尚未接入。**不做假控件**：接入 accent
 * 等于改主视觉（连 docs/demo.gif 都要重做），属于独立的设计变更，不混在控件收尾里。
 */
const COLOR_KEYS = [
  { key: 'bg', label: { en: 'Background', zh: '背景' } },
  { key: 'fg', label: { en: 'Foreground', zh: '前景' } },
] as const;

function renderPaletteSwatches(): void {
  if (!paletteSwatches) return;
  const p = state.template.palette;
  paletteSwatches.replaceChildren();
  for (const { key, label } of COLOR_KEYS) {
    const current = sel.palette[key] ?? p[key];
    const name = label[state.locale];
    // 用 <label> 而不是 <button>：色块里要嵌 <input type="color">，
    // 而 button 内嵌交互元素是非法 HTML 嵌套。label 原生把点击转给 input。
    const sw = document.createElement('label');
    sw.className = 'swatch';
    sw.style.background = current;
    sw.classList.toggle('is-custom', sel.palette[key] !== undefined);
    sw.title = `${name}: ${current}`;

    const pick = document.createElement('input');
    pick.type = 'color';
    pick.value = current;
    pick.setAttribute('aria-label', name);
    pick.addEventListener('input', () => {
      sel.palette = { ...sel.palette, [key]: pick.value };
      // 就地改当前色块，不重建 DOM——重建会在拖动中销毁正在操作的 input
      sw.style.background = pick.value;
      sw.classList.add('is-custom');
      sw.title = `${name}: ${pick.value}`;
      rebuildLive({ palette: sel.palette });
    });
    sw.appendChild(pick);
    paletteSwatches.appendChild(sw);
  }
}

rowsRange?.addEventListener('input', () => {
  const n = parseInt(rowsRange.value, 10);
  if (rowsVal) rowsVal.textContent = String(n);
  rebuildLive({ rows: n });
});
speedRange?.addEventListener('input', () => {
  const v = quantizeSpeed(parseInt(speedRange.value, 10));
  if (speedVal) speedVal.textContent = speedLabel(v);
  rebuildLive({ speed: v });
});

// —— 导出 ——
const gifBtn = document.getElementById('export-gif') as HTMLButtonElement | null;
const mp4Btn = document.getElementById('export-mp4') as HTMLButtonElement | null;
const pngBtn = document.getElementById('export-png') as HTMLButtonElement | null;
const svgBtn = document.getElementById('export-svg') as HTMLButtonElement | null;
const status = document.getElementById('status');

// WebCodecs 能力探测不 import mp4.ts（那会把 mediabunny 的 130KB gzip 拖进首屏）；
// 真正的 codec 协商在点击时由 exportMp4 完成，失败会给出明确文案。
const webCodecsOk = typeof VideoEncoder === 'function' && typeof VideoFrame === 'function';

function setStatus(text: string): void {
  if (status) status.textContent = text;
}

function setBusy(busy: boolean): void {
  if (gifBtn) gifBtn.disabled = busy;
  if (mp4Btn) mp4Btn.disabled = busy || !webCodecsOk;
  if (pngBtn) pngBtn.disabled = busy;
  if (svgBtn) svgBtn.disabled = busy;
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** 导出完成的状态行：超过平台上限时追加警告（不阻断，用户已拿到文件） */
function reportExported(kind: string, bytes: number, limit: number | null): void {
  const t = ui(state.locale);
  const size = formatBytes(bytes);
  const base = t.exported(kind, size);
  if (exceedsLimit(bytes, limit) && limit !== null) {
    const platform = getPreset(sel.platform).name[state.locale];
    setStatus(`${base} · ${t.overLimit(platform, size, formatBytes(limit))}`);
  } else {
    setStatus(base);
  }
}

gifBtn?.addEventListener('click', async () => {
  const t = ui(state.locale);
  setBusy(true);
  setStatus(t.exporting('GIF'));
  try {
    // 平台预设在此生效：微信档导出 720px / 12fps，默认档保持模板参数
    const gifState = deriveExportState(state, sel.platform, 'gif');
    const blob = await exportGif(gifState, (done, total) => {
      setStatus(t.exporting('GIF', Math.round((done / total) * 100)));
    });
    download(blob, gifFilename(gifState));
    reportExported('GIF', blob.size, getPreset(sel.platform).gifLimitBytes);
  } catch (err) {
    setStatus(t.failed(err instanceof Error ? err.message : String(err)));
  } finally {
    setBusy(false);
  }
});

mp4Btn?.addEventListener('click', async () => {
  const t = ui(state.locale);
  setBusy(true);
  setStatus(t.exporting('MP4'));
  try {
    // mediabunny 按需加载：不用 MP4 的人不为它付首屏体积
    const { exportMp4, mp4Filename } = await import('./exporters/mp4');
    const mp4State = deriveExportState(state, sel.platform, 'mp4');
    const result = await exportMp4(mp4State, (done, total) => {
      setStatus(t.exporting('MP4', Math.round((done / total) * 100)));
    });
    download(result.blob, mp4Filename(mp4State));
    reportExported('MP4', result.blob.size, getPreset(sel.platform).mp4LimitBytes);
  } catch (err) {
    setStatus(t.failed(err instanceof Error ? err.message : String(err)));
  } finally {
    setBusy(false);
  }
});

pngBtn?.addEventListener('click', async () => {
  const t = ui(state.locale);
  setBusy(true);
  setStatus(t.exporting('PNG'));
  try {
    const blob = await exportPng(state, 0);
    download(blob, pngFilename(state));
    setStatus(t.exported('PNG', formatBytes(blob.size)));
  } catch (err) {
    setStatus(t.failed(err instanceof Error ? err.message : String(err)));
  } finally {
    setBusy(false);
  }
});

svgBtn?.addEventListener('click', async () => {
  const t = ui(state.locale);
  try {
    const blob = svgToBlob(await svgFileContent(state, 0));
    download(blob, svgFilename(state));
    setStatus(t.exported('SVG', formatBytes(blob.size)));
  } catch (err) {
    setStatus(t.failed(err instanceof Error ? err.message : String(err)));
  }
});

refreshChrome();
