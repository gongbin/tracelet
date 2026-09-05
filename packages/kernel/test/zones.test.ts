import { describe, it, expect } from 'vitest';
import { emptyBoard, type Board, type Zone } from '../src/model/board.js';
import { RULE_SETS } from '../src/model/project.js';
import { registerFootprints } from '../src/library/registry.js';
import { fillZone, pointInFill, zoneFills } from '../src/board/zones.js';
import { computeRatsnest } from '../src/board/ratsnest.js';

registerFootprints([{ id: 'test:zone-pad', name: 'test pad', body: { w: 1, h: 1 }, height: 1, description: '', pads: [{ number: '1', x: 0, y: 0, w: 1, h: 1, shape: 'rect', drill: 0, npth: false }] }]);
const rect = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const rules = RULE_SETS[0];
function zone(net = 'GND'): Zone { return { id: 'zone', net, layer: 'F.Cu', polygon: rect(0, 0, 20, 20), thermal: 'solid', thermalGap: .3, spokeWidth: .4, clearance: 0 }; }
function board(): Board { return { ...emptyBoard(), outline: rect(0, 0, 20, 20) }; }
function pad(b: Board, x: number, y: number, net = 'GND') { b.footprints.push({ id: `p${b.footprints.length}`, ref: `P${b.footprints.length}`, footprintId: 'test:zone-pad', x, y, side: 'F', rotation: 0, value: '', padNets: { '1': net } }); }

describe('zone fill and connectivity regressions', () => {
  it('recomputes for changed constraints even when the rule ID is unchanged', () => {
    const b = board(); b.zones = [zone('')];
    const first = zoneFills(b, { ...rules, copperToEdge: .3 });
    const second = zoneFills(b, { ...rules, copperToEdge: 1 });
    expect(pointInFill(first[0], { x: .5, y: 10 })).toBe(true);
    expect(pointInFill(second[0], { x: .5, y: 10 })).toBe(false);
    expect(zoneFills(b, { ...rules, copperToEdge: 1 })).toBe(second);
  });
  it('supports zero edge clearance without degenerate edge polygons', () => {
    const b = board(); const z = zone('');
    expect(pointInFill({ zone: z, polygons: fillZone(b, z, { ...rules, copperToEdge: 0 }) }, { x: .01, y: 10 })).toBe(true);
  });
  it('keeps copper touched by the middle of a same-layer trace, but not an opposite-layer trace', () => {
    const b = board(), z = zone(); z.polygon = rect(8, 8, 4, 4);
    b.traces = [{ id: 't', net: 'GND', layer: 'F.Cu', width: .25, points: [{ x: 2, y: 10 }, { x: 18, y: 10 }] }];
    expect(fillZone(b, z, rules).length).toBe(1);
    b.traces[0].layer = 'B.Cu';
    expect(fillZone(b, z, rules)).toEqual([]);
  });
  it('does not electrically join disconnected islands from a single zone', () => {
    const b = board(); pad(b, 4, 10); pad(b, 16, 10); b.zones = [zone()];
    b.traces = [{ id: 'barrier', net: 'OTHER', layer: 'F.Cu', width: 1, points: [{ x: 10, y: 0 }, { x: 10, y: 20 }] }];
    expect(zoneFills(b, rules)[0].polygons).toHaveLength(2);
    expect(computeRatsnest(b, rules).unrouted).toBe(1);
  });
  it('connects pads through traces contacting the zone without any pad centers inside', () => {
    const b = board(); pad(b, 2, 8); pad(b, 18, 12);
    const z = zone(); z.polygon = rect(8, 6, 4, 8); b.zones = [z];
    b.traces = [
      { id: 'left', net: 'GND', layer: 'F.Cu', width: .25, points: [{ x: 2, y: 8 }, { x: 10, y: 8 }] },
      { id: 'right', net: 'GND', layer: 'F.Cu', width: .25, points: [{ x: 10, y: 12 }, { x: 18, y: 12 }] }
    ];
    expect(computeRatsnest(b, rules).unrouted).toBe(0);
  });
  it('respects the obstacle net class clearance', () => {
    const b = board(); pad(b, 10, 10, 'HV');
    b.netClasses.push({ name: 'HV', nets: ['HV'], clearance: 1, traceWidth: .25, viaSize: .6, viaDrill: .3 });
    const z = zone(''), fill = { zone: z, polygons: fillZone(b, z, rules) };
    expect(pointInFill(fill, { x: 11.2, y: 10 })).toBe(false);
    expect(pointInFill(fill, { x: 11.6, y: 10 })).toBe(true);
  });
});

it('recognizes a T junction at the middle of a trace without merging foreign nets', () => {
  const b = board(); pad(b, 2, 10); pad(b, 10, 2);
  b.traces = [
    { id:'horizontal',net:'GND',layer:'F.Cu',width:.25,points:[{x:2,y:10},{x:18,y:10}] },
    { id:'vertical',net:'GND',layer:'F.Cu',width:.25,points:[{x:10,y:2},{x:10,y:10}] }
  ];
  expect(computeRatsnest(b,rules).unrouted).toBe(0);
  b.traces[1].net='OTHER';
  expect(computeRatsnest(b,rules).unrouted).toBe(1);
});
