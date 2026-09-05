import { describe, it, expect } from 'vitest';
import { createProject, ProjectEditor, sch, buildSchematicNetlist, runSchematicErc, findPin, pcb, createDemoProject, buildNetlist } from '../src/index.js';

function setup() {
  const ed = new ProjectEditor(createProject({ name: 't' }));
  const place = (sheetId: string, symbolId: string, center: { x: number; y: number }, value?: string) => { const r = sch.placeComponent(ed.project, { sheetId, symbolId, center, value }); ed.dispatch(r.command); return r; };
  return { ed, place };
}

describe('多页图纸', () => {
  it('跨页按电源名与标签名合并网络，位号全局唯一，同步到 PCB 汇总所有页', () => {
    const { ed, place } = setup();
    const s1 = ed.project.schematic.sheets[0].id;
    const add = sch.addSheet('电源'); ed.dispatch(add.command);
    const s2 = add.id;
    expect(ed.project.schematic.sheets.length).toBe(2);
    const r1 = place(s1, 'sym:R', { x: 1000, y: 1000 });
    const r2 = place(s2, 'sym:R', { x: 1000, y: 1000 });
    expect(r2.ref).toBe('R2');
    // 页 1：R1.1 → +3V3；页 2：R2.1 → +3V3（电源符号跨页合并）
    const p1 = place(s1, 'sym:PWR', { x: 1000, y: 300 }, '+3V3'); ed.dispatch(sch.connectPins(s1, { componentId: p1.id, pin: '1' }, { componentId: r1.id, pin: '1' }));
    const p2 = place(s2, 'sym:PWR', { x: 1000, y: 300 }, '+3V3'); ed.dispatch(sch.connectPins(s2, { componentId: p2.id, pin: '1' }, { componentId: r2.id, pin: '1' }));
    // 标签 SIG 跨页
    for (const [sid, rid] of [[s1, r1.id], [s2, r2.id]] as const) {
      const c = ed.project.schematic.sheets.find((s) => s.id === sid)!.components.find((x) => x.id === rid)!;
      const g = findPin(c, '2')!;
      ed.dispatch(sch.addWire(sid, [g.end, { x: g.end.x, y: g.end.y + 200 }]));
      ed.dispatch(sch.addLabel(sid, 'SIG', { x: g.end.x, y: g.end.y + 200 }));
    }
    const nl = buildSchematicNetlist(ed.project.schematic);
    expect(nl.nets.find((n) => n.name === '+3V3')!.pins.map((p) => p.ref).sort()).toEqual(['R1', 'R2']);
    expect(nl.nets.find((n) => n.name === 'SIG')!.pins.map((p) => p.ref).sort()).toEqual(['R1', 'R2']);
    const erc = runSchematicErc(ed.project.schematic);
    expect(erc.errors).toBe(0);
    ed.dispatch(pcb.syncFromSchematic());
    expect(ed.project.board.footprints.map((f) => f.ref).sort()).toEqual(['R1', 'R2']);
    expect(ed.project.board.footprints.find((f) => f.ref === 'R2')!.padNets['1']).toBe('+3V3');
    ed.dispatch(sch.deleteSheet(s2));
    expect(ed.project.schematic.sheets.length).toBe(1);
    ed.dispatch(sch.deleteSheet(s1));
    expect(ed.project.schematic.sheets.length).toBe(1);
  });
});

describe('结点 / 总线 / 导线编辑', () => {
  it('结点让交叉的两根导线相连', () => {
    const { ed, place } = setup();
    const sid = ed.project.schematic.sheets[0].id;
    const a = place(sid, 'sym:R', { x: 1000, y: 1000 }), b = place(sid, 'sym:R', { x: 3000, y: 1000 });
    const ca = ed.project.schematic.sheets[0].components[0], cb = ed.project.schematic.sheets[0].components[1];
    const ga = findPin(ca, '1')!, gb = findPin(cb, '1')!;
    // 导线 1：从 A.1 向上；导线 2：水平穿过导线 1 中段到 B.1
    ed.dispatch(sch.addWire(sid, [ga.end, { x: ga.end.x, y: ga.end.y - 600 }]));
    const y = ga.end.y - 300;
    ed.dispatch(sch.addWire(sid, [{ x: ga.end.x - 300, y }, { x: gb.end.x, y }, gb.end]));
    expect(buildNetlist(ed.project.schematic.sheets[0]).nets.length).toBe(2);
    ed.dispatch(sch.addJunction(sid, { x: ga.end.x, y }));
    const nl = buildNetlist(ed.project.schematic.sheets[0]);
    expect(nl.nets.length).toBe(1);
    expect(nl.nets[0].pins.map((p) => p.ref).sort()).toEqual(['R1', 'R2']);
    void a; void b;
  });
  it('总线上的标签不是网络标签；连到总线但没标签的导线被 ERC 警告', () => {
    const { ed, place } = setup();
    const sid = ed.project.schematic.sheets[0].id;
    place(sid, 'sym:R', { x: 1000, y: 1000 });
    const c = ed.project.schematic.sheets[0].components[0]; const g = findPin(c, '1')!;
    ed.dispatch(sch.addBus(sid, [{ x: 0, y: g.end.y - 300 }, { x: 4000, y: g.end.y - 300 }]));
    ed.dispatch(sch.addLabel(sid, 'DATA[0..7]', { x: 2000, y: g.end.y - 300 }));
    ed.dispatch(sch.addWire(sid, [g.end, { x: g.end.x, y: g.end.y - 300 }]));
    const nl = buildNetlist(ed.project.schematic.sheets[0]);
    expect(nl.nets.some((n) => n.name === 'DATA[0..7]')).toBe(false);
    expect(runSchematicErc(ed.project.schematic).items.some((i) => i.rule === 'bus-entry-unnamed')).toBe(true);
    ed.dispatch(sch.addLabel(sid, 'DATA0', { x: g.end.x, y: g.end.y - 200 }));
    expect(runSchematicErc(ed.project.schematic).items.some((i) => i.rule === 'bus-entry-unnamed')).toBe(false);
  });
  it('拖动自动导线后变为手动，元件移动不再重排', () => {
    const p = createDemoProject(); const ed = new ProjectEditor(p);
    const sheet = p.schematic.sheets[0];
    const w = sheet.wires.find((x) => x.auto)!;
    const pts = w.points.map((q, i) => (i === 1 ? { x: q.x + 100, y: q.y } : q));
    ed.dispatch(sch.setWirePoints(sheet.id, w.id, pts));
    const after = ed.project.schematic.sheets[0].wires.find((x) => x.id === w.id)!;
    expect(after.auto).toBeUndefined();
    expect(after.points[1].x).toBe(w.points[1].x + 100);
  });
});

describe('复制 / 粘贴', () => {
  it('粘贴生成新位号，保留元件之间的导线，整体平移', () => {
    const p = createDemoProject(); const ed = new ProjectEditor(p);
    const sheet = p.schematic.sheets[0];
    const r1 = sheet.components.find((c) => c.ref === 'R1')!, d1 = sheet.components.find((c) => c.ref === 'D1')!;
    const clip = sch.copySelection(sheet, [r1.id, d1.id]);
    expect(clip.components.length).toBe(2);
    expect(clip.wires.length).toBe(1); // R1.2 → D1.1
    const r = sch.pasteClipboard(ed.project, sheet.id, clip, { x: clip.anchor.x + 3000, y: clip.anchor.y });
    ed.dispatch(r.command);
    const s2 = ed.project.schematic.sheets[0];
    const refs = s2.components.map((c) => c.ref);
    expect(refs).toContain('R2'); expect(refs).toContain('D2');
    const r2 = s2.components.find((c) => c.ref === 'R2')!;
    expect(r2.x).toBe(r1.x + 3000);
    const nl = buildNetlist(s2);
    expect(nl.nets.some((n) => n.pins.some((x) => x.ref === 'R2') && n.pins.some((x) => x.ref === 'D2'))).toBe(true);
    ed.undo();
    expect(ed.project.schematic.sheets[0].components.length).toBe(sheet.components.length);
  });
});
