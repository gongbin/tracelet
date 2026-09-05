import type { Board } from '../model/board.js';
import { footprintBody } from './geometry.js';

export type AlignMode = 'left' | 'right' | 'top' | 'bottom' | 'hcenter' | 'vcenter' | 'hdist' | 'vdist';

/** 计算对齐 / 分布后的封装位置（按本体外接矩形）。 */
export function alignFootprints(board: Board, ids: string[], mode: AlignMode): { id: string; x: number; y: number }[] {
  const fps = board.footprints.filter((f) => ids.includes(f.id));
  if (fps.length < 2) return [];
  const items = fps.map((f) => ({ f, b: footprintBody(f) }));
  const minX = Math.min(...items.map((i) => i.b.x)), maxX = Math.max(...items.map((i) => i.b.x + i.b.w));
  const minY = Math.min(...items.map((i) => i.b.y)), maxY = Math.max(...items.map((i) => i.b.y + i.b.h));
  const out: { id: string; x: number; y: number }[] = [];
  if (mode === 'hdist' || mode === 'vdist') {
    const key = mode === 'hdist' ? 'x' : 'y', size = mode === 'hdist' ? 'w' : 'h';
    const sorted = [...items].sort((a, b) => a.b[key] - b.b[key]);
    const total = (mode === 'hdist' ? maxX - minX : maxY - minY) - sorted.reduce((n, i) => n + i.b[size], 0);
    const gap = total / (sorted.length - 1);
    let cursor = mode === 'hdist' ? minX : minY;
    for (const i of sorted) {
      const delta = cursor - i.b[key];
      out.push({ id: i.f.id, x: i.f.x + (mode === 'hdist' ? delta : 0), y: i.f.y + (mode === 'vdist' ? delta : 0) });
      cursor += i.b[size] + gap;
    }
    return out;
  }
  for (const i of items) {
    let dx = 0, dy = 0;
    if (mode === 'left') dx = minX - i.b.x;
    else if (mode === 'right') dx = maxX - (i.b.x + i.b.w);
    else if (mode === 'hcenter') dx = (minX + maxX) / 2 - (i.b.x + i.b.w / 2);
    else if (mode === 'top') dy = minY - i.b.y;
    else if (mode === 'bottom') dy = maxY - (i.b.y + i.b.h);
    else if (mode === 'vcenter') dy = (minY + maxY) / 2 - (i.b.y + i.b.h / 2);
    out.push({ id: i.f.id, x: i.f.x + dx, y: i.f.y + dy });
  }
  return out;
}
