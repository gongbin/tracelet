import { describe, it, expect } from 'vitest';
import { generateSchematic, buildNetlist, runErc, ProjectEditor, createProject, sch, findPin } from '../src/index.js';

describe('从抽取结果生成原理图', () => {
  const spec = {
    title: 'ESP32 最小系统',
    components: [
      { ref: 'U1', value: 'ESP32-S3-WROOM-1', kind: 'module', pins: [{ number: '1', name: 'GND', net: 'GND' }, { number: '2', name: '3V3', net: '3V3' }, { number: '3', name: 'EN', net: 'EN' }, { number: '4', name: 'IO0', net: 'IO0' }, { number: '5', name: 'TXD0', net: 'TXD' }, { number: '6', name: 'RXD0', net: 'RXD' }] },
      { ref: 'R1', value: '10k', kind: 'resistor', footprint: 'R_0603', pins: [{ number: '1', net: '3V3' }, { number: '2', net: 'EN' }] },
      { ref: 'C1', value: '100nF', kind: 'capacitor', pins: [{ number: '1', net: '3V3' }, { number: '2', net: 'gnd' }] },
      { ref: 'C2', value: '10uF', kind: 'capacitor', pins: [{ number: '1', net: '3V3' }, { number: '2', net: 'GND' }] }
    ]
  };
  it('元件全部放置、引脚端点在栅格上、网络按标签连通、GND 归一化', () => {
    const r = generateSchematic(spec);
    expect(r.sheet.components.filter((c) => !c.ref.startsWith('#')).length).toBe(4);
    expect(r.sheet.components.some((c) => c.symbolId === 'sym:GND')).toBe(true);
    expect(r.symbols.length).toBe(1);
    for (const c of r.sheet.components) { const g = findPin(c, '1')!; expect(g.end.x % 100).toBe(0); expect(g.end.y % 100).toBe(0); }
    const nl = buildNetlist(r.sheet);
    const en = nl.nets.find((n) => n.name === 'EN')!;
    expect(en.pins.map((p) => p.ref).sort()).toEqual(['R1', 'U1']);
    const v = nl.nets.find((n) => n.name === '+3V3')!;
    expect(v.pins.map((p) => p.ref).sort()).toEqual(['C1', 'C2', 'R1', 'U1']);
    const gnd = nl.nets.find((n) => n.name === 'GND')!;
    expect(gnd.pins.map((p) => p.ref).sort()).toEqual(['C1', 'C2', 'U1']);
    expect(r.stats.labeledPins).toBe(12);
    expect(runErc(r.sheet).errors).toBe(0);
  });
  it('加入项目后位号计数器更新，符号进入项目内库', () => {
    const ed = new ProjectEditor(createProject({ name: 't' }));
    const r = generateSchematic(spec, { sheetName: '识别' });
    ed.dispatch(sch.addGeneratedSheet(r.sheet, r.symbols));
    expect(ed.project.schematic.sheets.length).toBe(2);
    expect(ed.project.schematic.counters.C).toBe(3);
    expect(ed.project.library.symbols.length).toBe(1);
  });
});
