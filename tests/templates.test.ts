import { describe, it, expect } from 'vitest';
import {
  TEMPLATES,
  sponsoredBy,
  getTemplate,
  resolveTemplate,
  templateChoices,
} from '../src/templates';
import { validateTemplate } from '../src/core/template-schema';
import { resolveVariant } from '../src/core/variants';
import { createDefaultState } from '../src/app-state';
import { scene } from '../src/core/scene';
import type { Template } from '../src/core/types';

describe('模板注册表', () => {
  it('三份版式全部通过加载期校验', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(['sponsored-by', 'made-by-gang', 'no-sponsors']);
  });

  it('getTemplate 对未知 id 响亮失败', () => {
    expect(() => getTemplate('nope')).toThrow(/未知模板/);
  });

  it('每个模板都有中英双语文案与至少一个 ticker 图层', () => {
    for (const t of TEMPLATES) {
      expect(t.name.en.length).toBeGreaterThan(0);
      expect(t.name.zh.length).toBeGreaterThan(0);
      expect(t.layers.some((l) => l.type === 'ticker')).toBe(true);
      expect(t.layers.some((l) => l.type === 'text')).toBe(true);
    }
  });

  it('templateChoices 列出原版 + 变体（按语言取名）', () => {
    const en = templateChoices('en');
    expect(en).toContainEqual({ templateId: 'sponsored-by', label: 'Sponsored by', group: 'Sponsored by' });
    expect(en).toContainEqual({
      templateId: 'sponsored-by',
      variantId: 'made-possible',
      label: 'Made possible by',
      group: 'Sponsored by',
    });
    const zh = templateChoices('zh');
    expect(zh).toContainEqual({ templateId: 'no-sponsors', label: '无人赞助', group: '无人赞助' });
  });
});

describe('变体机制', () => {
  it('made-possible 只改标题文案，其余原样', () => {
    const patched = resolveTemplate('sponsored-by', 'made-possible');
    expect(patched.layers[0]).toMatchObject({
      type: 'text',
      default: { en: 'MADE POSSIBLE BY', zh: '特别感谢' },
    });
    expect(patched.layers[1]).toEqual(sponsoredBy.layers[1]);
    expect(patched.palette).toEqual(sponsoredBy.palette);
  });

  it('inverted 变体换色板（证明补丁不限文案）', () => {
    const patched = resolveTemplate('sponsored-by', 'inverted');
    expect(patched.palette.bg).toBe('#f5f3ee');
    expect(patched.palette.fg).toBe('#111111');
    // 原模板不被污染
    expect(sponsoredBy.palette.bg).toBe('#0a0a0a');
  });

  it('未知变体 id 报错并列出可用项', () => {
    expect(() => resolveTemplate('no-sponsors', 'typo')).toThrow(/没有变体 "typo".*still-no-sponsors/);
  });

  it('变体补丁产出非法模板时加载期炸掉', () => {
    const broken: Template = {
      ...sponsoredBy,
      variants: [
        {
          id: 'broken',
          name: { en: 'x', zh: 'x' },
          patch: [{ op: 'replace', path: '/palette/bg', value: 'not-a-color' }],
        },
      ],
    };
    expect(() => resolveVariant(broken, 'broken')).toThrow(/模板校验失败/);
  });
});

describe('validateTemplate 错误路径', () => {
  const base = structuredClone(sponsoredBy);

  it('缺图层 id 报错并带路径', () => {
    const bad = structuredClone(base);
    delete (bad.layers[0] as unknown as { id?: string }).id;
    expect(() => validateTemplate(bad, 'x.json')).toThrow(/layers\[0\]\.id/);
  });

  it('非法比例报错', () => {
    const bad = structuredClone(base);
    (bad.canvas as { ratios: string[] }).ratios = ['3:2'];
    expect(() => validateTemplate(bad)).toThrow(/canvas\.ratios\[0\]/);
  });

  it('未知图层类型报错', () => {
    const bad = structuredClone(base);
    (bad.layers[1] as { type: string }).type = 'video';
    expect(() => validateTemplate(bad)).toThrow(/未知图层类型/);
  });

  it('重复图层 id 报错', () => {
    const bad = structuredClone(base);
    (bad.layers[1] as { id: string }).id = 'title';
    expect(() => validateTemplate(bad)).toThrow(/id 重复/);
  });

  it('色板格式错误报错', () => {
    const bad = structuredClone(base);
    (bad.palette as { fg: string }).fg = '#fff';
    expect(() => validateTemplate(bad)).toThrow(/palette\.fg/);
  });

  it('box 四元组长度错误报错', () => {
    const bad = structuredClone(base);
    (bad.layers[0] as { box: number[] }).box = [0, 0.1, 0.8];
    expect(() => validateTemplate(bad)).toThrow(/box/);
  });

  it('校验通过返回归一化模板（合法输入等价）', () => {
    const out = validateTemplate(base);
    expect(out).toEqual(base);
  });
});

describe('createDefaultState', () => {
  it('默认 = hero / en / 1:1', () => {
    const s = createDefaultState();
    expect(s.template.id).toBe('sponsored-by');
    expect(s.locale).toBe('en');
    expect(s.ratio).toBe('1:1');
    expect(s.rows).toBe(3);
  });

  it('可按模板 + 变体 + 语言 + 比例重建', () => {
    const s = createDefaultState({
      templateId: 'made-by-gang',
      variantId: 'made-by-friends',
      locale: 'zh',
      ratio: '4:5',
    });
    expect(s.template.id).toBe('made-by-gang');
    expect(s.template.layers[0]).toMatchObject({ default: { zh: '好朋友们一起造的' } });
    expect(s.locale).toBe('zh');
    expect(s.ratio).toBe('4:5');
  });
});

describe('scene × 全部版式 × 双语', () => {
  it('每个模板 × 每种语言 × 每种比例都能渲染出结构完整的 SVG', () => {
    for (const t of TEMPLATES) {
      for (const locale of ['en', 'zh'] as const) {
        for (const ratio of t.canvas.ratios) {
          const svg = scene(createDefaultState({ templateId: t.id, locale, ratio }), 0);
          expect(svg.startsWith('<svg')).toBe(true);
          expect(svg.endsWith('</svg>')).toBe(true);
          expect(svg).toContain(`viewBox="0 0 1080`);
          expect(svg).toContain('clip-rows-'); // ticker 裁剪就位
          expect(svg.match(/<text /g)?.length ?? 0).toBeGreaterThan(3);
        }
      }
    }
  });

  it('中文标题进入 SVG（i18n 文案链闭环）', () => {
    const svg = scene(createDefaultState({ locale: 'zh' }), 0);
    expect(svg).toContain('由以下品牌赞助');
  });

  it('变体标题进入 SVG（补丁链闭环）', () => {
    const svg = scene(createDefaultState({ variantId: 'made-possible', locale: 'zh' }), 0);
    // 断言渲染出的 <text> 节点（<title> 里是模板名，变体不改它）
    expect(svg).toContain('>特别感谢</text>');
    expect(svg).not.toContain('>由以下品牌赞助</text>');
  });

  it('不同模板渲染不同背景（换 JSON 即换视觉）', () => {
    const hero = scene(createDefaultState(), 0);
    const gang = scene(createDefaultState({ templateId: 'made-by-gang' }), 0);
    expect(hero).toContain('fill="#0a0a0a"');
    expect(gang).toContain('fill="#e9dfc9"');
  });
});
