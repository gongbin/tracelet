import { it, expect } from 'vitest';
import { emptyBoard } from '../src/model/board.js';
import { RULE_SETS } from '../src/model/project.js';
import { runDrc } from '../src/board/drc.js';

it('uses the stricter network clearance for trace pairs and via-to-trace checks', () => {
  const b = emptyBoard();
  b.netClasses.push({ name: 'sensitive', nets: ['A'], traceWidth: .25, clearance: 1, viaSize: .6, viaDrill: .3 });
  b.traces = [
    { id: 'a', net: 'A', layer: 'F.Cu', width: .25, points: [{x:10,y:10},{x:20,y:10}] },
    { id: 'b', net: 'B', layer: 'F.Cu', width: .25, points: [{x:10,y:10.8},{x:20,y:10.8}] },
  ];
  expect(runDrc(b, RULE_SETS[0]).items.some(i => i.rule === 'clearance' && i.objectIds?.includes('a'))).toBe(true);
  b.traces.shift();
  b.vias = [{ id: 'v', net: 'A', x: 15, y: 10, size: .6, drill: .3 }];
  expect(runDrc(b, RULE_SETS[0]).items.some(i => i.rule === 'clearance' && i.objectIds?.includes('v'))).toBe(true);
  b.vias[0].y = 8;
  expect(runDrc(b, RULE_SETS[0]).items.filter(i => i.rule === 'clearance')).toEqual([]);
});
