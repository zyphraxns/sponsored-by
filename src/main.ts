import { canvasSize, loopSecondsFor, scene } from './core/scene';
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
import type { Locale, Ratio, SceneState } from './core/types';
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
}

let sel: Selection = {
  templateId: DEFAULT_TEMPLATE_ID,
  locale: 'en',
  ratio: '1:1',
  platform: 'none',
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
    ['export-gif', t.exportGif],
    ['export-mp4', t.exportMp4],
    ['export-png', t.exportPng],
    ['export-svg', t.exportSvg],
  ] as const) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

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

  refreshMeta();
}

function apply(partial: Partial<Selection>): void {
  sel = { ...sel, ...partial };
  state = createDefaultState(sel);
  loopSeconds = loopSecondsFor(state);
  start = performance.now(); // 切换后从 t=0 起播，动作干净
  if (reducedMotion) renderAt(0);
  refreshChrome();
  setStatus('');
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
  apply({ templateId, variantId: variantId || undefined });
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
