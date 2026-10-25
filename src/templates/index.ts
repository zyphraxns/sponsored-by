import sponsoredByJson from './sponsored-by.json';
import madeByGangJson from './made-by-gang.json';
import noSponsorsJson from './no-sponsors.json';
import { validateTemplate } from '../core/template-schema';
import { resolveVariant } from '../core/variants';
import type { Locale, Template } from '../core/types';

/**
 * 版式注册表（M4 版式引擎的入口）。
 *
 * 加一套版式 = 加一个 JSON 文件 + 在这里登记一行——不改任何渲染代码。
 * 这就是 SPEC §9 M4 判据「换一个 JSON 文件就换一套版式」的字面兑现。
 *
 * 加载期即校验：坏 JSON 在模块导入时炸掉，而不是等到用户点导出。
 */
export const TEMPLATES: Template[] = [
  validateTemplate(sponsoredByJson, 'sponsored-by.json'),
  validateTemplate(madeByGangJson, 'made-by-gang.json'),
  validateTemplate(noSponsorsJson, 'no-sponsors.json'),
];

/** hero 版式具名导出（测试与默认状态的锚点） */
export const sponsoredBy: Template = TEMPLATES[0] as Template;

export const DEFAULT_TEMPLATE_ID = 'sponsored-by';

export function getTemplate(id: string): Template {
  const t = TEMPLATES.find((t) => t.id === id);
  if (!t) {
    throw new Error(`未知模板 "${id}"，可用：${TEMPLATES.map((t) => t.id).join(', ')}`);
  }
  return t;
}

/** 模板 + 变体 → 打过补丁的最终模板（变体缺省 = 原模板） */
export function resolveTemplate(id: string, variantId?: string): Template {
  return resolveVariant(getTemplate(id), variantId);
}

/** UI 下拉用：每个模板的原版 + 全部变体，按当前语言取显示名 */
export function templateChoices(locale: Locale): Array<{
  templateId: string;
  variantId?: string;
  label: string;
  group: string;
}> {
  const choices: Array<{ templateId: string; variantId?: string; label: string; group: string }> = [];
  for (const t of TEMPLATES) {
    choices.push({ templateId: t.id, label: t.name[locale], group: t.name[locale] });
    for (const v of t.variants ?? []) {
      choices.push({ templateId: t.id, variantId: v.id, label: v.name[locale], group: t.name[locale] });
    }
  }
  return choices;
}

export { validateTemplate };
