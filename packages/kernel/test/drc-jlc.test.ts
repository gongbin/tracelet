import { describe, it, expect } from 'vitest';
import { runDrc, RULE_SETS, registerProjectLibrary, type Board, type FootprintDef } from '../src/index.js';

const jlc = RULE_SETS.find((r) => r.id === 'jlc')!;
const base = (): Board => ({ copperCount: 2, thickness: 1.6, outline: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }], footprints: [], traces: [], vias: [], zones: [], texts: [], netClasses: [], stackup: undefined } as unknown as Board);
const rules = (b: Board, rule: string) => runDrc(b, jlc).items.filter((i) => i.rule === rule);

describe('嘉立创工艺规则 DRC', () => {
  it('过孔：0.25 孔径常规外加价提示，0.15 以下报错；孔边距 <0.2 报错', () => {
    const b = base();
    b.vias = [{ id: 'v1', x: 5, y: 5, size: 0.5, drill: 0.25, net: 'A' }, { id: 'v2', x: 5.5, y: 5, size: 0.5, drill: 0.25, net: 'B' }, { id: 'v3', x: 15, y: 15, size: 0.3, drill: 0.1, net: 'C' }];
    expect(rules(b, 'small-drill').length).toBe(2);
    expect(rules(b, 'min-drill').length).toBe(1);
    expect(rules(b, 'hole-to-hole').filter((i) => i.severity === 'error').length).toBe(0); // v1-v2 孔边距 0.25 ≥ 0.2 不报
    b.vias[1].x = 5.4; // 孔边距 0.15
    expect(rules(b, 'hole-to-hole').filter((i) => i.severity === 'error').length).toBe(1);
  });
  it('插件孔焊环极限 / 建议，孔边到异网络走线 0.28，无铜孔掏空 0.2，丝印字高与压焊盘，板厚非常规', () => {
    const def: FootprintDef = { id: 'fp:t:hdr', name: 'hdr', body: { w: 3, h: 3 }, height: 3, description: '', pads: [
      { number: '1', x: 0, y: 0, w: 1.2, h: 1.2, shape: 'circle', drill: 0.9, npth: false }, // 焊环 0.15 → 极限以下
      { number: '2', x: 2.54, y: 0, w: 1.7, h: 1.7, shape: 'circle', drill: 1.3, npth: false }, // 焊环 0.2 → 建议以下
      { number: 'H', x: 0, y: 5, w: 3.2, h: 3.2, shape: 'circle', drill: 3.2, npth: true }
    ] };
    registerProjectLibrary({ symbols: [], footprints: [def] });
    const b = base(); b.thickness = 1.5;
    b.footprints = [{ id: 'f1', ref: 'J1', value: '', footprintId: def.id, x: 8, y: 8, rotation: 0, side: 'F', padNets: { '1': 'A', '2': 'B' } } as Board['footprints'][number]];
    b.traces = [{ id: 't1', layer: 'B.Cu', net: 'X', width: 0.25, points: [{ x: 8, y: 9.0 }, { x: 12, y: 9.0 }] }]; // 孔 1 边(8,8.45) 到线边 9.0-0.125 → 0.425? 改近一点
    b.traces[0].points = [{ x: 6, y: 8.8 }, { x: 12, y: 8.8 }]; // 孔边 8.45 → 线边 8.675 → 0.225 < 0.28
    b.traces.push({ id: 't2', layer: 'F.Cu', net: 'Y', width: 0.25, points: [{ x: 6, y: 14.75 }, { x: 12, y: 14.75 }] }); // 无铜孔 (8,13) r1.6 → 边 14.6，线边 14.625 → 0.025 < 0.2
    b.texts = [{ id: 'x1', layer: 'F.Silk', text: 'v1.0', x: 8, y: 8.3, size: 0.6 }];
    const pth = rules(b, 'pth-annular-ring');
    expect(pth.some((i) => i.severity === 'error' && i.refs.includes('J1.1'))).toBe(true);
    expect(pth.some((i) => i.severity === 'warning' && i.refs.includes('J1.2'))).toBe(true);
    expect(rules(b, 'hole-to-copper').length).toBeGreaterThan(0);
    expect(rules(b, 'npth-clearance').length).toBeGreaterThan(0);
    expect(rules(b, 'silk-height').length).toBe(1);
    expect(rules(b, 'silk-on-pad').length).toBe(1);
    expect(rules(b, 'board-thickness').length).toBe(1);
  });
  it('2oz 铜时线宽 / 线距按 0.16 判', () => {
    const b = base(); b.stackup = { material: 'FR-4', copperWeight: 2, innerCopperWeight: 0.5, finish: 'HASL', maskColor: '绿', silkColor: '白', impedance: false, viaTenting: true };
    b.traces = [{ id: 't1', layer: 'F.Cu', net: 'A', width: 0.13, points: [{ x: 2, y: 2 }, { x: 10, y: 2 }] }, { id: 't2', layer: 'F.Cu', net: 'B', width: 0.2, points: [{ x: 2, y: 2.3 }, { x: 10, y: 2.3 }] }];
    expect(rules(b, 'min-width').length).toBe(1);
    expect(rules(b, 'clearance').length).toBe(1); // 间距 0.3-0.165=0.135 < 0.16
    b.stackup.copperWeight = 1;
    expect(rules(b, 'min-width').length).toBe(0);
    expect(rules(b, 'clearance').length).toBe(0);
  });
});
