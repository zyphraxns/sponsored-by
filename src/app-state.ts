import { DEFAULT_TEMPLATE_ID, resolveTemplate } from './templates';
import type { Locale, Ratio, SceneState, TickerItem, TickerLayer } from './core/types';

export interface DefaultStateOptions {
  templateId?: string;
  variantId?: string;
  locale?: Locale;
  ratio?: Ratio;
  /** 用户选中的图标列表；重建 state 时透传，避免切换版式时图标被清空 */
  icons?: TickerItem[];
  /** 用户文案覆盖；同上 */
  text?: SceneState['text'];
  /** 用户色板覆盖；同上 */
  palette?: SceneState['palette'];
}

/**
 * 预览页与各自检页共用的默认状态工厂（单一来源，避免多处漂移）。
 * M4 起 UI 切换 = 用不同 options 重建 state（内容编辑控件 M5 接入）。
 */
export function createDefaultState(options: DefaultStateOptions = {}): SceneState {
  const template = resolveTemplate(
    options.templateId ?? DEFAULT_TEMPLATE_ID,
    options.variantId,
  );
  const ticker = template.layers.find((l): l is TickerLayer => l.type === 'ticker');
  return {
    template,
    locale: options.locale ?? 'en',
    text: options.text ?? {},
    ratio: options.ratio ?? '1:1',
    rows: ticker?.rows ?? 3,
    speed: 1,
    icons: options.icons ?? [],
    palette: options.palette ?? {},
  };
}
