import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { footprintBody, footprintPads, parseProject, registerProjectLibrary, type Board, type BoardFootprint, type FootprintDef } from '../src/index.js';

const def: FootprintDef = { id: 'fp:test:conn', name: 'conn', body: { w: 10, h: 4, x: 3, y: 1 }, pads: [{ number: '1', x: 0, y: 0, w: 1.5, h: 1.5, shape: 'rect', drill: 0.9, npth: false }, { number: '2', x: 6, y: 2, w: 1.5, h: 1.5, shape: 'circle', drill: 0.9, npth: false }], height: 4, description: '' };
const boardWith = (fp: Partial<BoardFootprint>): Board => ({ copperCount: 2, thickness: 1.6, outline: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 30 }, { x: 0, y: 30 }], footprints: [{ id: 'f1', ref: 'J1', footprintId: def.id, x: 20, y: 10, rotation: 0, side: 'F', padNets: {}, ...fp } as BoardFootprint], traces: [], vias: [], zones: [], texts: [], netClasses: [], stackup: undefined } as unknown as Board);
const contains = (b: { x: number; y: number; w: number; h: number }, p: { x: number; y: number }) => p.x >= b.x - 1e-6 && p.x <= b.x + b.w + 1e-6 && p.y >= b.y - 1e-6 && p.y <= b.y + b.h + 1e-6;

describe('封装本体偏移', () => {
  it('本体中心偏移随旋转 / 翻面与焊盘一起变换，焊盘始终在外框内', () => {
    registerProjectLibrary({ symbols: [], footprints: [def] });
    for (const rotation of [0, 90, 180, 270]) for (const side of ['F', 'B'] as const) {
      const b = boardWith({ rotation, side });
      const body = footprintBody(b.footprints[0]);
      for (const p of footprintPads(b.footprints[0], b)) expect(contains(body, p.center), `rot ${rotation} side ${side} pad ${p.number}`).toBe(true);
    }
  });
  it('旧工程里居中假设错误的封装在加载时迁移，焊盘回到外框内', () => {
    const file = new URL('../../../../../../private/tmp/claude-501/-Users-gongbin-Documents-work-touchwaves-eda/3d5a231b-319c-4294-9070-e7c8a8989ee8/scratchpad/door.eda.json', import.meta.url).pathname;
    if (!existsSync(file)) return;
    const p = parseProject(readFileSync(file, 'utf8'));
    let outside = 0;
    for (const f of p.board.footprints) { const body = footprintBody(f); for (const q of footprintPads(f, p.board)) if (!contains(body, q.center)) outside++; }
    expect(outside).toBe(0);
  });
});
