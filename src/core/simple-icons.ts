/**
 * simple-icons 图标源（SPEC §4.1 / §10.2）。
 *
 * 运行时从 CDN 拉取，仓库零字节——正好落在法务建议的「第三方行为」安全线内。
 * 单色单路径 SVG，与低色约束（GIF 256 色）天作之合。
 *
 * 索引来源优先级：
 * 1. simple-icons/data/simple-icons.json（含 name / hex 元数据）
 * 2. 回退：data.jsdelivr.com 文件树提取 slug 列表
 */

interface IconMeta {
  slug: string;
  name: string;
  hex: string;
}

/** emoji 快捷面板 */
export const EMOJI_PRESETS = [
  '💸', '🚀', '🫡', '💎', '🍕', '🎮', '🍔', '☕',
  '🎁', '🎉', '🔥', '⚡', '🏆', '👑', '🎯', '📦',
  '🏠', '🚗', '✈️', '🚢', '💻', '📱', '🎵', '🎬',
  '🎨', '🍺', '🌈', '⭐', '💪', 'UGh', '糖果',
];

const ICON_INDEX_URL = 'https://data.jsdelivr.com/v1/packages/npm/simple-icons@latest';
const ICON_SVG_URL = (slug: string) =>
  `https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/${slug}.svg`;
const ICON_META_URL = 'https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@latest/data/simple-icons.json';

interface JSDelivrTree {
  tree: { name: string; type: string; path: string }[];
}

let indexCache: string[] | null = null;
let metaCache: Map<string, IconMeta> | null = null;
let indexPromise: Promise<string[]> | null = null;

async function loadIndex(): Promise<string[]> {
  if (indexCache) return indexCache;
  if (indexPromise) return indexPromise;

  indexPromise = (async () => {
    // 优先：元数据文件（含名称与颜色）
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(ICON_META_URL, { signal: ctrl.signal });
      clearTimeout(tid);
      if (res.ok) {
        const data = (await res.json()) as { icons: Record<string, IconMeta> };
        metaCache = new Map(Object.entries(data.icons ?? {}));
        indexCache = [...metaCache.keys()];
        return indexCache;
      }
    } catch {
      // 元数据不可用，回退到文件树
    }

    // 回退：从 js 文件树提取 slug
    const res = await fetch(ICON_INDEX_URL);
    const tree = (await res.json()) as JSDelivrTree;
    indexCache = tree.tree
      .filter((e) => e.type === 'file' && e.path.startsWith('icons/') && e.path.endsWith('.svg'))
      .map((e) => e.path.slice('icons/'.length, -'.svg'.length));
    return indexCache;
  })();

  return indexPromise;
}

/** 搜索图标（按 slug / name），返回 slug 列表（上限 60） */
export async function searchIcons(query: string): Promise<string[]> {
  const index = await loadIndex();
  const q = query.trim().toLowerCase();
  if (!q) return index.slice(0, 60);
  return index
    .filter((s) => {
      const name = metaCache?.get(s)?.name.toLowerCase() ?? '';
      return s.toLowerCase().includes(q) || name.includes(q);
    })
    .slice(0, 60);
}

/** 获取图标 SVG 内容（带缓存） */
const svgCache = new Map<string, Promise<string>>();

export function getIconSvg(slug: string): Promise<string> {
  let task = svgCache.get(slug);
  if (!task) {
    task = fetch(ICON_SVG_URL(slug)).then((r) => {
      if (!r.ok) throw new Error(`图标 ${slug} 加载失败（HTTP ${r.status}）`);
      return r.text();
    });
    svgCache.set(slug, task);
  }
  return task;
}

export function getIconName(slug: string): string {
  return metaCache?.get(slug)?.name ?? slug;
}

export function getIconHex(slug: string): string {
  return metaCache?.get(slug)?.hex ?? '#888888';
}

export function isEmoji(icon: string): boolean {
  return icon.startsWith('emoji:');
}

export function isSimpleIcons(icon: string): boolean {
  return icon.startsWith('simple-icons:');
}

export function isUpload(icon: string): boolean {
  return icon.startsWith('upload:');
}