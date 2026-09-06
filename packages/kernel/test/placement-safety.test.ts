import { describe, it, expect } from 'vitest';
import { emptyBoard } from '../src/model/board.js';
import { RULE_SETS } from '../src/model/project.js';
import { registerFootprints } from '../src/library/registry.js';
import { footprintPads } from '../src/board/geometry.js';
import { optimizePlacement, applyPlacement, checkPlacement } from '../src/board/placement.js';

registerFootprints([{ id: 'test:placement-safety', name: 'placement safety', body: { w: 2, h: 2 }, height: 1, description: '',
  pads: [{ number: '1', x: 0, y: 0, w: 2, h: 1, shape: 'rect', drill: 0, npth: false }] }]);
function fixture() {
  const b = emptyBoard();
  b.footprints = [{ id: 'r', ref: 'R1', footprintId: 'test:placement-safety', x: 60, y: 10, rotation: 0, side: 'F', value: '', padNets: {} }];
  return b;
}
describe('placement safety', () => {
  it('places a single outside component and preserves input', () => {
    const b = fixture(), original = JSON.stringify(b);
    const r = optimizePlacement(b, RULE_SETS[0], { iterations: 1000, verifyRouting: false });
    expect(r.rejected).toBeUndefined();
    expect(r.moves).toHaveLength(1);
    expect(checkPlacement(applyPlacement(b, r.moves), RULE_SETS[0]).filter(i => i.severity === 'error')).toEqual([]);
    expect(JSON.stringify(b)).toBe(original);
  });
  it('rejects an impossible board instead of suggesting overlapping or outside components', () => {
    const b = fixture();
    b.outline = [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
    const r = optimizePlacement(b, RULE_SETS[0], { iterations: 100, verifyRouting: false });
    expect(r.rejected).toBeTruthy();
    expect(r.moves).toEqual([]);
    expect(r.after).toEqual(r.before);
  });
  it('bounds rotated rectangular pads on both board sides', () => {
    const b = fixture();
    for (const side of ['F', 'B'] as const) for (const rotation of [30,45,135,270]) {
      const fp = {...b.footprints[0], side, rotation};
      const p = footprintPads(fp, b)[0], a = rotation * Math.PI / 180;
      expect(p.rect.w).toBeCloseTo(2 * Math.abs(Math.cos(a)) + Math.abs(Math.sin(a)));
      expect(p.rect.h).toBeCloseTo(2 * Math.abs(Math.sin(a)) + Math.abs(Math.cos(a)));
    }
  });
});
