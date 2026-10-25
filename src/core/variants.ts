/**
 * 变体解析：模板 + 变体 id → 打过补丁的新模板（SPEC §7）。
 *
 * 版式引擎的本职是产出 state（SPEC §3）：scene() 永远看不到「变体」概念，
 * 它在渲染前就被解析成了一份普通 Template。改文案、换色板、调行数——
 * 只要 JSON Patch 能表达，就不需要动渲染代码。
 */
import { applyPatch } from './json-patch';
import { validateTemplate } from './template-schema';
import type { Template } from './types';

/** 应用变体补丁并重新校验（补丁可能产生非法模板，必须在加载期炸掉） */
export function resolveVariant(template: Template, variantId?: string): Template {
  if (!variantId) return template;
  const variant = template.variants?.find((v) => v.id === variantId);
  if (!variant) {
    const available = template.variants?.map((v) => v.id).join(', ') || '（无）';
    throw new Error(`模板 ${template.id} 没有变体 "${variantId}"，可用：${available}`);
  }
  const patched = applyPatch(template, variant.patch);
  return validateTemplate(patched, `${template.id}#${variant.id}`);
}
