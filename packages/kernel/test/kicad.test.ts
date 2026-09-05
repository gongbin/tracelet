import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSExpr, importKicadSchematic, importKicadPcb, importKicadProject, buildNetlist, findPin, getSymbol, componentBounds, runSchematicErc, runDrc, ruleSetOf, exportFabFiles, serializeProject, parseProject, computeRatsnest } from '../src/index.js';

const sch = readFileSync(resolve(__dirname, 'fixtures/demo.kicad_sch'), 'utf8');
const pcb = readFileSync(resolve(__dirname, 'fixtures/demo.kicad_pcb'), 'utf8');

describe('S 表达式', () => {
  it('解析带引号字符串、数字、嵌套与注释', () => {
    const t = parseSExpr('(a "b c" 1.5 (d -2 (e)) ; comment\n f)');
    expect(t[0]).toBe('a'); expect(t[1]).toEqual({ str: 'b c' }); expect(t[2]).toBe(1.5); expect(Array.isArray(t[3])).toBe(true); expect(t[4]).toBe('f');
  });
});

describe('KiCad 原理图导入', () => {
  const r = importKicadSchematic(sch);
  it('元件、导线、标签、结点、图形都被导入，符号带通用图形', () => {
    expect(r.sheet.components.map((c) => c.ref).filter((x) => !x.startsWith('#')).sort()).toEqual(['C1', 'R1', 'R2']);
    expect(r.sheet.wires.length).toBe(7);
    expect(r.sheet.labels.map((l) => l.text)).toEqual(['SDA']);
    expect(r.sheet.junctions.length).toBe(1);
    expect(r.sheet.graphics.some((g) => g.kind === 'text' && g.text === 'Test net')).toBe(true);
    expect(r.symbols.length).toBe(4);
    const rSym = getSymbol(r.sheet.components.find((c) => c.ref === 'R1')!.symbolId);
    expect(rSym.graphic).toBe('shapes');
    expect(rSym.shapes!.some((s) => s.kind === 'rect')).toBe(true);
    expect(r.sheet.frame.size).toBe('A4'); expect(r.sheet.frame.title).toBe('LED Blinker'); expect(r.sheet.frame.revision).toBe('A');
  });
  it('引脚端点与导线端点重合（含 90° 旋转与电源符号），网表正确', () => {
    const r1 = r.sheet.components.find((c) => c.ref === 'R1')!;
    const p1 = findPin(r1, '1')!.end;
    expect(p1.x).toBeCloseTo(100 * 1000 / 25.4, 0); expect(p1.y).toBeCloseTo(46.19 * 1000 / 25.4, 0);
    const r2 = r.sheet.components.find((c) => c.ref === 'R2')!;
    expect(r2.rotation).toBe(270);
    const q1 = findPin(r2, '1')!.end, q2 = findPin(r2, '2')!.end;
    expect(Math.min(q1.x, q2.x)).toBeCloseTo(116.19 * 1000 / 25.4, 0);
    expect(Math.max(q1.x, q2.x)).toBeCloseTo(123.81 * 1000 / 25.4, 0);
    const nl = buildNetlist(r.sheet);
    const names = nl.nets.map((n) => n.name);
    expect(names).toContain('+3V3'); expect(names).toContain('GND'); expect(names).toContain('SDA');
    expect(nl.nets.find((n) => n.name === 'SDA')!.pins.map((p) => p.ref).sort()).toEqual(['C1', 'R1', 'R2']);
    expect(nl.nets.find((n) => n.name === 'GND')!.pins.map((p) => p.ref).sort()).toEqual(['C1', 'R2']);
    expect(nl.unconnectedPins.length).toBe(0);
    const b = componentBounds(r1); expect(b.w).toBeGreaterThan(0);
  });
});

describe('KiCad PCB 导入', () => {
  const r = importKicadPcb(pcb);
  it('封装 / 焊盘网络 / 走线 / 过孔 / 铺铜 / 板框 / 文字', () => {
    expect(r.board.footprints.map((f) => f.ref).sort()).toEqual(['H1', 'R1', 'R2']);
    expect(r.footprints.length).toBe(2);
    const r1 = r.board.footprints.find((f) => f.ref === 'R1')!;
    expect(r1.padNets).toEqual({ '1': '+3V3', '2': 'SDA' });
    const r2 = r.board.footprints.find((f) => f.ref === 'R2')!;
    expect(r2.rotation).toBe(270);
    expect(r.board.traces.length).toBe(2); expect(r.board.traces[0].net).toBe('SDA');
    expect(r.board.vias.length).toBe(1); expect(r.board.vias[0].net).toBe('GND');
    expect(r.board.zones.length).toBe(1); expect(r.board.zones[0].net).toBe('GND'); expect(r.board.zones[0].layer).toBe('B.Cu');
    expect(r.board.outline.length).toBe(4);
    expect(r.board.texts[0].text).toBe('BLINK v1');
    expect(r.board.copperCount).toBe(2);
    const hole = r.footprints.find((f) => f.name.startsWith('MountingHole'))!;
    expect(hole.pads[0].npth).toBe(true); expect(hole.pads[0].drill).toBe(3.2);
  });
});

describe('KiCad 项目导入', () => {
  const { project, warnings } = importKicadProject({ name: 'Blink', schematics: [{ name: '主图', text: sch }], pcb });
  it('原理图与 PCB 按位号关联；ERC / DRC / Gerber / 序列化都能跑', () => {
    expect(warnings).toEqual([]);
    const r1fp = project.board.footprints.find((f) => f.ref === 'R1')!;
    const r1 = project.schematic.sheets[0].components.find((c) => c.ref === 'R1')!;
    expect(r1fp.componentId).toBe(r1.id);
    expect(r1.footprint).toBe(r1fp.footprintId);
    expect(project.library.symbols.length).toBe(4); expect(project.library.footprints.length).toBe(2);
    expect(runSchematicErc(project.schematic).errors).toBe(0);
    const drc = runDrc(project.board, ruleSetOf(project));
    expect(drc.items.some((i) => i.rule === 'clearance')).toBe(false);
    expect(computeRatsnest(project.board, ruleSetOf(project)).total).toBeGreaterThan(0);
    expect(exportFabFiles(project).length).toBeGreaterThan(10);
    const again = parseProject(serializeProject(project));
    expect(again.library.symbols.length).toBe(4);
    expect(getSymbol(again.schematic.sheets[0].components[0].symbolId)).toBeTruthy();
    expect(project.schematic.counters.R).toBe(3);
  });
});
