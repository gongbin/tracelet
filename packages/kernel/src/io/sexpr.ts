/**
 * S 表达式解析器（KiCad 6/7/8 文件格式）。
 * 输出为嵌套数组：字符串原子 + 子列表；带引号的字符串保留为 { str } 以区分数字/符号。
 */
export type SAtom = string | number | { str: string };
export type SExpr = SAtom | SList;
export interface SList extends Array<SExpr> {}

export function parseSExpr(text: string): SList {
  let i = 0;
  const n = text.length;
  const skipWs = () => { for (;;) { while (i < n && /\s/.test(text[i])) i++; if (text[i] === '#' || text[i] === ';') { while (i < n && text[i] !== '\n') i++; } else break; } };
  const parseList = (): SList => {
    const out: SList = [];
    i++; // (
    for (;;) {
      skipWs();
      if (i >= n) throw new Error('S 表达式未闭合');
      const ch = text[i];
      if (ch === ')') { i++; return out; }
      if (ch === '(') { out.push(parseList()); continue; }
      if (ch === '"') {
        i++; let s = '';
        while (i < n && text[i] !== '"') { if (text[i] === '\\' && i + 1 < n) { const c = text[i + 1]; s += c === 'n' ? '\n' : c === 't' ? '\t' : c; i += 2; } else s += text[i++]; }
        i++;
        out.push({ str: s });
        continue;
      }
      let tok = '';
      while (i < n && !/[\s()]/.test(text[i])) tok += text[i++];
      const num = Number(tok);
      out.push(tok !== '' && !Number.isNaN(num) && /^[-+]?\d/.test(tok) ? num : tok);
    }
  };
  skipWs();
  if (text[i] !== '(') throw new Error('不是 S 表达式文件');
  const root = parseList();
  return root;
}

export const isList = (x: SExpr): x is SList => Array.isArray(x);
export const head = (x: SExpr): string | null => (isList(x) && typeof x[0] === 'string' ? x[0] : null);
export const str = (x: SExpr | undefined): string => (x === undefined ? '' : typeof x === 'object' && !Array.isArray(x) ? x.str : String(x));
export const num = (x: SExpr | undefined, d = 0): number => (typeof x === 'number' ? x : x === undefined ? d : Number(str(x)) || d);
/** 找到第一个以 name 开头的子列表。 */
export const child = (list: SList, name: string): SList | undefined => list.find((x): x is SList => isList(x) && x[0] === name);
/** 所有以 name 开头的子列表。 */
export const children = (list: SList, name: string): SList[] => list.filter((x): x is SList => isList(x) && x[0] === name);
/** (name v1 v2 ...) 的值数组。 */
export const values = (list: SList | undefined): SExpr[] => (list ? list.slice(1) : []);
/** 是否含有裸符号 flag，如 (hide) 或 hide。 */
export const hasFlag = (list: SList, flag: string): boolean => list.some((x) => x === flag || (isList(x) && x[0] === flag && x.length === 1));
