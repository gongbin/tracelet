import { describe, it, expect } from 'vitest';
import { createProject, ProjectEditor, sch, buildNetlist, runErc, parseProject, serializeProject, findPin, createDemoProject } from '../src/index.js';

function setup() {
  const ed = new ProjectEditor(createProject({ name: 't' }));
  const sheet = ed.project.schematic.sheets[0].id;
  const place = (symbolId: string, center: { x: number; y: number }, value?: string) => {
    const r = sch.placeComponent(ed.project, { sheetId: sheet, symbolId, center, value });
    ed.dispatch(r.command);
    return r;
  };
  return { ed, sheet, place };
}

describe('放置与位号', () => {
  it('位号自动递增，引脚端点落在 100mil 栅格上', () => {
    const { ed, place } = setup();
    const a = place('sym:R', { x: 1000, y: 1000 });
    const b = place('sym:R', { x: 2000, y: 1000 });
    expect(a.ref).toBe('R1');
    expect(b.ref).toBe('R2');
    const c = ed.project.schematic.sheets[0].components[0];
    const g = findPin(c, '1')!;
    expect(g.end.x % 100).toBe(0);
    expect(g.end.y % 100).toBe(0);
  });
});

describe('连通性与网表', () => {
  it('两引脚连线形成一个网络，电源符号命名网络', () => {
    const { ed, sheet, place } = setup();
    const r = place('sym:R', { x: 1000, y: 1000 });
    const c = place('sym:C', { x: 2000, y: 1000 });
    const p = place('sym:PWR', { x: 1000, y: 200 }, '+3V3');
    ed.dispatch(sch.connectPins(sheet, { componentId: r.id, pin: '2' }, { componentId: c.id, pin: '2' }));
    ed.dispatch(sch.connectPins(sheet, { componentId: p.id, pin: '1' }, { componentId: r.id, pin: '1' }));
    const nl = buildNetlist(ed.project.schematic.sheets[0]);
    const names = nl.nets.map((n) => n.name);
    expect(names).toContain('+3V3');
    expect(nl.nets.find((n) => n.name === '+3V3')!.pins.map((x) => x.ref)).toEqual(['R1']);
    const other = nl.nets.find((n) => n.name !== '+3V3')!;
    expect(other.pins.length).toBe(2);
    expect(nl.unconnectedPins.map((x) => `${x.ref}.${x.pinNumber}`)).toEqual(['C1.1']);
  });

  it('移动元件后自动导线跟随，连通性不变', () => {
    const { ed, sheet, place } = setup();
    const r = place('sym:R', { x: 1000, y: 1000 });
    const c = place('sym:C', { x: 2000, y: 1000 });
    ed.dispatch(sch.connectPins(sheet, { componentId: r.id, pin: '2' }, { componentId: c.id, pin: '1' }));
    ed.dispatch(sch.moveComponent(sheet, c.id, { x: 3000, y: 2000 }));
    const nl = buildNetlist(ed.project.schematic.sheets[0]);
    expect(nl.nets.length).toBe(1);
    expect(nl.nets[0].pins.length).toBe(2);
  });

  it('网络标签命名并合并同名网络', () => {
    const { ed, sheet, place } = setup();
    const r = place('sym:R', { x: 1000, y: 1000 });
    const c = place('sym:C', { x: 3000, y: 3000 });
    const gr = findPin(ed.project.schematic.sheets[0].components[0], '1')!;
    const gc = findPin(ed.project.schematic.sheets[0].components[1], '1')!;
    ed.dispatch(sch.addWire(sheet, [gr.end, { x: gr.end.x, y: gr.end.y - 200 }]));
    ed.dispatch(sch.addLabel(sheet, 'SDA', { x: gr.end.x, y: gr.end.y - 200 }));
    ed.dispatch(sch.addWire(sheet, [gc.end, { x: gc.end.x, y: gc.end.y - 200 }]));
    ed.dispatch(sch.addLabel(sheet, 'SDA', { x: gc.end.x, y: gc.end.y - 200 }));
    const nl = buildNetlist(ed.project.schematic.sheets[0]);
    const sda = nl.nets.find((n) => n.name === 'SDA')!;
    expect(sda.pins.map((p) => p.ref).sort()).toEqual(['C1', 'R1']);
    void r; void c;
  });
});

describe('ERC', () => {
  it('报告未连接引脚与未驱动电源引脚', () => {
    const { ed, place } = setup();
    place('sym:ESP32-WROOM-32E', { x: 3000, y: 2000 });
    const rep = runErc(ed.project.schematic.sheets[0]);
    expect(rep.items.filter((i) => i.rule === 'unconnected-pin').length).toBe(8);
    expect(rep.errors).toBe(0);
  });
  it('示例项目 ERC：只有未连接引脚警告，无错误', () => {
    const rep = runErc(createDemoProject().schematic.sheets[0]);
    expect(rep.errors).toBe(0);
    expect(rep.warnings).toBeGreaterThan(0);
  });
});

describe('撤销 / 重做 / 事务', () => {
  it('undo 恢复放置前状态，redo 恢复', () => {
    const { ed, place } = setup();
    place('sym:R', { x: 1000, y: 1000 });
    expect(ed.project.schematic.sheets[0].components.length).toBe(1);
    ed.undo();
    expect(ed.project.schematic.sheets[0].components.length).toBe(0);
    ed.redo();
    expect(ed.project.schematic.sheets[0].components.length).toBe(1);
  });
  it('事务内多次移动只产生一条历史', () => {
    const { ed, sheet, place } = setup();
    const r = place('sym:R', { x: 1000, y: 1000 });
    ed.begin('拖动');
    ed.dispatch(sch.moveComponent(sheet, r.id, { x: 1100, y: 1000 }));
    ed.dispatch(sch.moveComponent(sheet, r.id, { x: 1200, y: 1000 }));
    ed.commit();
    expect(ed.historyLabels).toEqual(['放置 R1', '拖动']);
    ed.undo();
    expect(ed.project.schematic.sheets[0].components[0].x).toBe(1000 - 120);
  });
});

describe('序列化', () => {
  it('往返无损', () => {
    const p = createDemoProject();
    const q = parseProject(serializeProject(p));
    expect(q).toEqual(p);
  });
});
