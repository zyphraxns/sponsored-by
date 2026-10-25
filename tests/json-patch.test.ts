import { describe, it, expect } from 'vitest';
import { applyPatch, parsePointer, jsonEquals, PatchError } from '../src/core/json-patch';
import type { PatchOp } from '../src/core/json-patch';

describe('parsePointer', () => {
  it('空串 = 整篇文档', () => {
    expect(parsePointer('')).toEqual([]);
  });
  it('解析转义字符（~1 → /，~0 → ~）', () => {
    expect(parsePointer('/a~1b/c~0d')).toEqual(['a/b', 'c~d']);
  });
  it('非空指针不以 / 开头即报错', () => {
    expect(() => parsePointer('a/b')).toThrow(PatchError);
  });
});

describe('applyPatch', () => {
  // 补丁产物是动态 JSON：测试用宽松类型直接断言（真实调用方有 Template 类型兜底）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc: Record<string, any> = {
    id: 'hero',
    layers: [
      { type: 'text', default: { en: 'SPONSORED BY', zh: '由以下品牌赞助' } },
      { type: 'ticker', rows: 3, items: [{ icon: 'emoji:💸' }, { icon: 'emoji:🚀' }] },
    ],
    palette: { bg: '#0a0a0a', fg: '#ffffff', accent: '#ffd400' },
  };

  it('replace 改嵌套值', () => {
    const out = applyPatch(doc, [{ op: 'replace', path: '/layers/0/default/zh', value: '特别感谢' }]);
    expect(out.layers[0]?.default.zh).toBe('特别感谢');
    expect(doc.layers[0]?.default.zh).toBe('由以下品牌赞助'); // 输入不被改
  });

  it('add 新键与数组插入', () => {
    const out = applyPatch(doc, [
      { op: 'add', path: '/version', value: 1 },
      { op: 'add', path: '/layers/1/items/1', value: { icon: 'emoji:🫡' } },
    ]);
    expect(out.version).toBe(1);
    expect(out.layers[1]?.items.map((i: { icon: string }) => i.icon)).toEqual(['emoji:💸', 'emoji:🫡', 'emoji:🚀']);
  });

  it('remove 删键与数组元素', () => {
    const out = applyPatch(doc, [
      { op: 'remove', path: '/palette/accent' },
      { op: 'remove', path: '/layers/1/items/0' },
    ]);
    expect(out.palette.accent).toBeUndefined();
    expect(out.layers[1]?.items.map((i: { icon: string }) => i.icon)).toEqual(['emoji:🚀']);
  });

  it('move 跨分支搬运', () => {
    const out = applyPatch(doc, [{ op: 'move', from: '/palette/fg', path: '/layers/0/fg' }]);
    expect(out.palette.fg).toBeUndefined();
    expect(out.layers[0]?.fg).toBe('#ffffff');
  });

  it('copy 深拷贝（改副本不动原件）', () => {
    const out = applyPatch(doc, [{ op: 'copy', from: '/palette', path: '/palette2' }]);
    expect(out.palette2).toEqual(doc.palette);
    (out.palette2 as { bg: string }).bg = '#123456';
    expect(out.palette.bg).toBe('#0a0a0a');
  });

  it('test 通过时后续操作继续', () => {
    const out = applyPatch(doc, [
      { op: 'test', path: '/id', value: 'hero' },
      { op: 'replace', path: '/id', value: 'hero-v2' },
    ]);
    expect(out.id).toBe('hero-v2');
  });

  it('test 失败即整体回滚（抛错，无副作用）', () => {
    expect(() => applyPatch(doc, [{ op: 'test', path: '/id', value: 'other' }])).toThrow(PatchError);
  });

  it('replace 不存在的路径报错', () => {
    expect(() => applyPatch(doc, [{ op: 'replace', path: '/nope/deep', value: 1 }])).toThrow(
      /路径不存在/,
    );
  });

  it('remove 不存在的路径报错', () => {
    expect(() => applyPatch(doc, [{ op: 'remove', path: '/palette/nope' }])).toThrow(PatchError);
  });

  it('数组下标越界报错', () => {
    expect(() => applyPatch(doc, [{ op: 'replace', path: '/layers/9', value: {} }])).toThrow(
      /越界/,
    );
  });

  it('未知操作报错', () => {
    expect(() => applyPatch(doc, [{ op: 'frobnicate', path: '/id' } as unknown as PatchOp])).toThrow(
      /未知操作/,
    );
  });

  it('空补丁 = 等价拷贝', () => {
    const out = applyPatch(doc, []);
    expect(out).toEqual(doc);
    expect(out).not.toBe(doc);
  });

  it('RFC 6901 转义键可被写', () => {
    const out = applyPatch({}, [{ op: 'add', path: '/a~1b', value: 7 }]);
    expect(out).toEqual({ 'a/b': 7 });
  });
});

describe('jsonEquals', () => {
  it('深比较对象与数组', () => {
    expect(jsonEquals({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(jsonEquals({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(jsonEquals(null, undefined)).toBe(false);
  });
});
