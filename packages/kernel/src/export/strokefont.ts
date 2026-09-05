import type { Vec } from '../geometry.js';

/** 单线笔画字体：4 宽 × 6 高单元，y 向下；用于丝印/Gerber 文字。 */
const G: Record<string, string> = {
  '0': '0,1 1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1|0,5 4,1', '1': '1,1 2,0 2,6|1,6 3,6', '2': '0,1 1,0 3,0 4,1 4,2 0,6 4,6', '3': '0,0 4,0 2,2.5 3,2.5 4,3.5 4,5 3,6 1,6 0,5',
  '4': '3,6 3,0 0,4 4,4', '5': '4,0 0,0 0,3 3,3 4,4 4,5 3,6 1,6 0,5', '6': '4,0 1,0 0,1 0,5 1,6 3,6 4,5 4,4 3,3 0,3', '7': '0,0 4,0 1,6',
  '8': '1,0 3,0 4,1 4,2 3,3 1,3 0,4 0,5 1,6 3,6 4,5 4,4 3,3|1,3 0,2 0,1 1,0', '9': '0,6 3,6 4,5 4,1 3,0 1,0 0,1 0,2 1,3 4,3',
  A: '0,6 2,0 4,6|0.7,4 3.3,4', B: '0,0 0,6 3,6 4,5 4,4 3,3 0,3|0,0 3,0 4,1 4,2 3,3', C: '4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5', D: '0,0 0,6 3,6 4,5 4,1 3,0 0,0',
  E: '4,0 0,0 0,6 4,6|0,3 3,3', F: '4,0 0,0 0,6|0,3 3,3', G: '4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5 4,3 2,3', H: '0,0 0,6|4,0 4,6|0,3 4,3', I: '1,0 3,0|2,0 2,6|1,6 3,6',
  J: '4,0 4,5 3,6 1,6 0,5', K: '0,0 0,6|4,0 0,3.5|1.5,2.5 4,6', L: '0,0 0,6 4,6', M: '0,6 0,0 2,3 4,0 4,6', N: '0,6 0,0 4,6 4,0', O: '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0',
  P: '0,6 0,0 3,0 4,1 4,2 3,3 0,3', Q: '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0|2.5,4.5 4,6', R: '0,6 0,0 3,0 4,1 4,2 3,3 0,3|2,3 4,6', S: '4,1 3,0 1,0 0,1 0,2 1,3 3,3 4,4 4,5 3,6 1,6 0,5',
  T: '0,0 4,0|2,0 2,6', U: '0,0 0,5 1,6 3,6 4,5 4,0', V: '0,0 2,6 4,0', W: '0,0 1,6 2,2 3,6 4,0', X: '0,0 4,6|4,0 0,6', Y: '0,0 2,3 4,0|2,3 2,6', Z: '0,0 4,0 0,6 4,6',
  '-': '1,3 3,3', '.': '2,5.5 2,6', '_': '0,6 4,6', '+': '2,1.5 2,4.5|0.5,3 3.5,3', '/': '0,6 4,0', ':': '2,1.5 2,2|2,4 2,4.5', '(': '3,0 2,1 2,5 3,6', ')': '1,0 2,1 2,5 1,6',
  '?': '0,1 1,0 3,0 4,1 4,2 2,3 2,4|2,5.5 2,6', 'Ω': '0,6 1,6 0.5,5 0,4 0,2 1,0 3,0 4,2 4,4 3.5,5 3,6 4,6', '%': '0,1 1,1 1,2 0,2 0,1|0,6 4,0|3,4 4,4 4,5 3,5 3,4', '*': '2,1 2,5|0.5,2 3.5,4|0.5,4 3.5,2', ' ': ''
};
const parsed = new Map<string, Vec[][]>();
function glyph(ch: string): Vec[][] {
  const key = G[ch] !== undefined ? ch : G[ch.toUpperCase()] !== undefined ? ch.toUpperCase() : '?';
  let g = parsed.get(key);
  if (!g) { g = G[key] ? G[key].split('|').map((s) => s.split(' ').map((p) => { const [x, y] = p.split(',').map(Number); return { x, y }; })) : []; parsed.set(key, g); }
  return g;
}

export interface TextOptions { size: number; anchor?: 'start' | 'middle' | 'end'; mirror?: boolean; rotation?: number }

/** 文字宽度（mm）。 */
export function textWidth(text: string, size: number): number {
  return Math.max(0, text.length * 5 - 1) * (size / 6);
}

/** 把文字转成折线集合（mm），origin 为基线中点/起点。 */
export function textStrokes(text: string, origin: Vec, opts: TextOptions): Vec[][] {
  const s = opts.size / 6, adv = 5 * s;
  const w = textWidth(text, opts.size);
  const x0 = opts.anchor === 'middle' ? -w / 2 : opts.anchor === 'end' ? -w : 0;
  const out: Vec[][] = [];
  const rot = ((opts.rotation ?? 0) * Math.PI) / 180, c = Math.cos(rot), sn = Math.sin(rot);
  [...text].forEach((ch, i) => {
    for (const line of glyph(ch)) {
      out.push(line.map((p) => {
        let lx = x0 + i * adv + p.x * s, ly = (p.y - 6) * s + opts.size / 2;
        if (opts.mirror) lx = -lx;
        return { x: origin.x + lx * c - ly * sn, y: origin.y + lx * sn + ly * c };
      }));
    }
  });
  return out;
}
