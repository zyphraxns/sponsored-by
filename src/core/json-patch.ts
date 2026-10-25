/**
 * JSON Patch（RFC 6902）子集实现——模板变体机制的底座。
 *
 * 为什么不用 npm 包：fast-json-patch 按对象身份变更（in-place），
 * 而模板是社区贡献的不可变 JSON；且我们只需要 6 个操作符的纯函数语义。
 * 深度拷贝用 structuredClone（Node 17+ / 全现代浏览器可用）。
 *
 * 错误策略：任何非法操作抛 PatchError（带 path 上下文），
 * 不允许「静默跳过」——坏补丁必须让模板加载失败得响亮。
 */

export type PatchOp =
  | { op: 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'replace'; path: string; value: unknown }
  | { op: 'move'; from: string; path: string }
  | { op: 'copy'; from: string; path: string }
  | { op: 'test'; path: string; value: unknown };

export class PatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PatchError';
  }
}

/** RFC 6901 JSON Pointer 解析：'' → []；'/a/0' → ['a','0'] */
export function parsePointer(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) {
    throw new PatchError(`invalid JSON pointer "${pointer}"（须以 / 开头或为空串）`);
  }
  return pointer
    .slice(1)
    .split('/')
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function getValue(doc: unknown, tokens: string[]): unknown {
  let cur: unknown = doc;
  for (const token of tokens) {
    if (cur === null || typeof cur !== 'object') {
      throw new PatchError(`路径不存在：/${tokens.join('/')} 中途不是对象`);
    }
    if (Array.isArray(cur)) {
      const idx = Number(token);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) {
        throw new PatchError(`数组越界：/${tokens.join('/')}（index=${token}）`);
      }
      cur = cur[idx];
    } else {
      if (!(token in (cur as Record<string, unknown>))) {
        throw new PatchError(`路径不存在：/${tokens.join('/')}`);
      }
      cur = (cur as Record<string, unknown>)[token];
    }
  }
  return cur;
}

/** 取父容器与最后一段 key（写操作用） */
function getParent(doc: unknown, tokens: string[]): { parent: unknown; key: string } {
  if (tokens.length === 0) throw new PatchError('根文档不可写（补丁不能整体替换根）');
  const parent = getValue(doc, tokens.slice(0, -1));
  return { parent, key: tokens[tokens.length - 1] as string };
}

function setValue(parent: unknown, key: string, value: unknown): void {
  if (Array.isArray(parent)) {
    const idx = key === '-' ? parent.length : Number(key);
    if (key !== '-' && (!Number.isInteger(idx) || idx < 0)) {
      throw new PatchError(`非法数组下标：${key}`);
    }
    parent.splice(idx, 0, value); // add 语义；replace/remove 由调用方先删
  } else if (parent !== null && typeof parent === 'object') {
    (parent as Record<string, unknown>)[key] = value;
  } else {
    throw new PatchError(`写入目标不是容器：${key}`);
  }
}

function removeValue(parent: unknown, key: string): void {
  if (Array.isArray(parent)) {
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0 || idx >= parent.length) {
      throw new PatchError(`数组越界（remove）：${key}`);
    }
    parent.splice(idx, 1);
  } else if (parent !== null && typeof parent === 'object' && key in (parent as Record<string, unknown>)) {
    delete (parent as Record<string, unknown>)[key];
  } else {
    throw new PatchError(`remove 目标不存在：${key}`);
  }
}

/** 深比较（JSON 值语义；模板值均为可 JSON 序列化数据） */
export function jsonEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    jsonEquals((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/**
 * 应用补丁，返回新文档（不改输入）。
 * ops 按序执行，任一失败即抛错——补丁是原子的：要么整体生效，要么整体不生效。
 */
export function applyPatch<T>(doc: T, ops: PatchOp[]): T {
  const draft = structuredClone(doc) as T;
  for (const op of ops) {
    const tokens = parsePointer(op.path);
    switch (op.op) {
      case 'add':
      case 'replace': {
        if (op.op === 'replace') {
          const { parent, key } = getParent(draft, tokens);
          if (Array.isArray(parent)) {
            const idx = Number(key);
            if (!Number.isInteger(idx) || idx < 0 || idx >= parent.length) {
              throw new PatchError(`replace 数组越界：${op.path}`);
            }
            parent[idx] = structuredClone(op.value);
          } else if (
            parent !== null &&
            typeof parent === 'object' &&
            key in (parent as Record<string, unknown>)
          ) {
            (parent as Record<string, unknown>)[key] = structuredClone(op.value);
          } else {
            throw new PatchError(`replace 目标不存在：${op.path}`);
          }
        } else {
          if (tokens.length === 0) throw new PatchError('add 不能指向根文档');
          const { parent, key } = getParent(draft, tokens);
          // add 到已存在键 = replace（RFC 允许）；数组 add = 插入
          if (
            !Array.isArray(parent) &&
            parent !== null &&
            typeof parent === 'object' &&
            key in (parent as Record<string, unknown>)
          ) {
            (parent as Record<string, unknown>)[key] = structuredClone(op.value);
          } else {
            setValue(parent, key, structuredClone(op.value));
          }
        }
        break;
      }
      case 'remove': {
        const { parent, key } = getParent(draft, tokens);
        removeValue(parent, key);
        break;
      }
      case 'move':
      case 'copy': {
        const fromTokens = parsePointer(op.from);
        const value = structuredClone(getValue(draft, fromTokens));
        if (op.op === 'move') {
          const { parent, key } = getParent(draft, fromTokens);
          removeValue(parent, key);
        }
        const { parent: toParent, key: toKey } = getParent(draft, tokens);
        if (
          !Array.isArray(toParent) &&
          toParent !== null &&
          typeof toParent === 'object' &&
          !(toKey in (toParent as Record<string, unknown>))
        ) {
          (toParent as Record<string, unknown>)[toKey] = value;
        } else if (Array.isArray(toParent) && toKey === '-') {
          toParent.push(value);
        } else {
          setValue(toParent, toKey, value);
        }
        break;
      }
      case 'test': {
        const actual = getValue(draft, tokens);
        if (!jsonEquals(actual, op.value)) {
          throw new PatchError(`test 失败：${op.path} 期望 ${JSON.stringify(op.value)}，实际 ${JSON.stringify(actual)}`);
        }
        break;
      }
      default: {
        const exhaustive: never = op;
        throw new PatchError(`未知操作：${JSON.stringify(exhaustive)}`);
      }
    }
  }
  return draft;
}
