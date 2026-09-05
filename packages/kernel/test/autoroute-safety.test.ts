import { expect, it } from 'vitest';
import { emptyBoard, type Board } from '../src/model/board.js';
import { RULE_SETS } from '../src/model/project.js';
import { registerFootprints } from '../src/library/registry.js';
import { autoroute } from '../src/board/autoroute.js';
import { runDrc } from '../src/board/drc.js';
import { segRectDist } from '../src/geometry.js';

registerFootprints([{ id: 'test:route-pad', name: 'route pad', body: { w: 1, h: 1 }, height: 1, description: '', pads: [{ number: '1', x: 0, y: 0, w: 1, h: 1, shape: 'rect', drill: 0, npth: false }] }]);
function fixture(): Board {
  const b = emptyBoard();
  b.footprints = [3, 15].map((x, i) => ({ id: `p${i}`, ref: `P${i}`, footprintId: 'test:route-pad', x, y: 10, rotation: 0, side: 'F', value: '', padNets: { '1': 'SIGNAL' } }));
  return b;
}
it('does not enter a target pad through overlapping foreign copper', () => {
  const b = fixture();
  b.vias = [{ id: 'blocker', x: 15, y: 10, size: 1, drill: .3, net: 'OTHER' }];
  const r = autoroute(b, RULE_SETS[0], { noRetry: true, maxNodes: 3000 });
  expect(r.routed).toBe(0);
  expect(r.traces).toEqual([]);
  expect(r.vias).toEqual([]);
  expect(r.failed.length).toBeGreaterThan(0);
});
it('honors net class clearance and minimum manufacturing width', () => {
  const b = fixture();
  b.netClasses = [{ name: 'Default', nets: [], clearance: .8, traceWidth: .05, viaSize: .3, viaDrill: .1 }];
  b.footprints.push({ id: 'obstacle', ref: 'O', footprintId: 'test:route-pad', x: 9, y: 10, side: 'F', rotation: 0, value: '', padNets: { '1': 'OTHER' } });
  const r = autoroute(b, RULE_SETS[0], { noRetry: true });
  expect(r.routed).toBe(1);
  for (const t of r.traces) {
    expect(t.width).toBeGreaterThanOrEqual(RULE_SETS[0].minTraceWidth);
    for (let i = 1; i < t.points.length; i++) expect(segRectDist(t.points[i - 1], t.points[i], { x: 8.5, y: 9.5, w: 1, h: 1 }) - t.width / 2).toBeGreaterThanOrEqual(.8 - 1e-6);
  }
  const after = { ...b, traces: r.traces.map((t, i) => ({ ...t, id: `t${i}` })), vias: r.vias.map((v, i) => ({ ...v, id: `v${i}` })) };
  expect(runDrc(after, RULE_SETS[0]).items.filter(i => ['clearance', 'min-width', 'min-drill', 'annular-ring'].includes(i.rule))).toEqual([]);
});

it('uses inner copper after switching to four layers when both outer layers are blocked', () => {
  const b = fixture();
  b.traces = (['F.Cu', 'B.Cu'] as const).map(layer => ({ id: `barrier-${layer}`, layer, net: 'OTHER', width: 1, points: [{ x: 9, y: 0 }, { x: 9, y: 30 }] }));
  const options = { noRetry: true, grid: .5, maxNodes: 40000 };
  const two = autoroute(b, RULE_SETS[0], options);
  expect(two.routed).toBe(0);
  const four = autoroute({ ...b, copperCount: 4 }, RULE_SETS[0], options);
  expect(four.routed).toBe(1);
  expect(four.traces.some(t => t.layer === 'In1.Cu' || t.layer === 'In2.Cu')).toBe(true);
  expect(four.vias.length).toBeGreaterThanOrEqual(2);
  expect(four.failed).toEqual([]);
});

it('escapes a fine-pitch power pad with a short neck and restores the net-class width', () => {
  registerFootprints([{ id: 'test:fine-power', name: 'fine pitch', body: { w: 2, h: 2 }, height: 1, description: '', pads: [-.5, 0, .5].map((y,i) => ({ number: String(i), x: 0, y, w: .67, h: .3, shape: 'rect' as const, drill: 0, npth: false })) }]);
  const b = fixture(); b.footprints[0] = { ...b.footprints[0], footprintId: 'test:fine-power', padNets: { '0': 'OTHER', '1': 'SIGNAL', '2': 'OTHER' } };
  b.netClasses = [{ name: 'Default', traceWidth: .5, viaSize: .6, viaDrill: .3, clearance: .2, nets: [] }];
  const r = autoroute(b, RULE_SETS[0], { grid: .125, noRetry: true, nets: ['SIGNAL'] });
  expect(r.routed).toBe(1);
  expect(r.traces.some(t => t.width < .5)).toBe(true);
  expect(r.traces.some(t => t.width === .5)).toBe(true);
  expect(r.traces.every(t => t.width >= RULE_SETS[0].minTraceWidth)).toBe(true);
  const after = { ...b, traces: r.traces.map((t,i) => ({ ...t,id:`t${i}` })), vias: r.vias.map((v,i) => ({ ...v,id:`v${i}` })) };
  expect(runDrc(after,RULE_SETS[0]).items.filter(i=>i.rule==='clearance')).toEqual([]);
});
