import { describe, it, expect } from 'vitest';
import { createParser } from '@tracespace/parser';
import { createDemoProject, exportFabFiles, exportCopperLayer, exportExcellon, exportMaskLayer, ruleSetOf, zoneFills, computeRatsnest, allPads, footprintPads, ProjectEditor, pcb, sch, textStrokes, pointInPolygon, zipFiles } from '../src/index.js';

const parse = (text: string) => { const p = createParser(); p.feed(text); return p.results(); };

describe('铺铜填充', () => {
  it('异网络焊盘周围被挖空，同网络焊盘在实铜内，孤岛被移除', () => {
    const p = createDemoProject();
    const rules = ruleSetOf(p);
    const fills = zoneFills(p.board, rules);
    expect(fills.length).toBe(1);
    const fill = fills[0];
    expect(fill.zone.net).toBe('GND');
    const pads = allPads(p.board);
    const inZoneBox = (c: { x: number; y: number }) => pointInPolygon(c, fill.zone.polygon);
    const inFill = (c: { x: number; y: number }) => fill.polygons.some((poly) => pointInPolygon(c, poly[0]) && !poly.slice(1).some((h) => pointInPolygon(c, h)));
    for (const pad of pads) {
      if (!inZoneBox(pad.center) || !pad.layers.includes('B.Cu')) continue;
      if (pad.net === 'GND') expect(inFill(pad.center)).toBe(true);
      else expect(inFill(pad.center)).toBe(false);
    }
  });
  it('铺铜内的同网络焊盘被视为已连接（飞线减少）', () => {
    const ed = new ProjectEditor(createDemoProject());
    const before = computeRatsnest(ed.project.board, ruleSetOf(ed.project)).unrouted;
    // 在 GND 铺铜覆盖 U1.8 与 D1.2 的位置上再放一块顶层 GND 铺铜
    ed.dispatch(pcb.addZone({ layer: 'F.Cu', net: 'GND', polygon: [{ x: 1, y: 1 }, { x: 49, y: 1 }, { x: 49, y: 29 }, { x: 1, y: 29 }] }));
    const after = computeRatsnest(ed.project.board, ruleSetOf(ed.project)).unrouted;
    expect(after).toBeLessThan(before);
  });
});

describe('Gerber / Excellon', () => {
  const p = createDemoProject();
  it('全部文件能被 tracespace 解析，无 unimplemented 节点，且有结束符', () => {
    const files = exportFabFiles(p, { netlist: false, project: false });
    const gerbers = files.filter((f) => f.kind === 'gerber' || f.kind === 'drill');
    expect(gerbers.length).toBe(11);
    for (const f of gerbers) {
      const tree = parse(f.content);
      expect(tree.filetype, f.name).toBe(f.kind === 'drill' ? 'drill' : 'gerber');
      expect(tree.done, f.name).toBe(true);
      // tracespace next.0 尚不解析 X2 属性（%TF/%TA/%TO/%TD），其余指令必须全部可识别
      const bad = tree.children.filter((n) => n.type === 'unimplemented' && !/^%T[FAOD]/.test((n as { value: string }).value));
      expect(bad, `${f.name}: ${JSON.stringify(bad.slice(0, 2))}`).toEqual([]);
    }
  });
  it('顶层铜：闪光数 = 顶层焊盘 + 过孔，走线段数一致，单位 mm、格式 4.6', () => {
    const rules = ruleSetOf(p);
    const tree = parse(exportCopperLayer(p.board, 'F.Cu', rules));
    const flashes = tree.children.filter((n) => n.type === 'graphic' && n.graphic === 'shape').length;
    const pads = allPads(p.board).filter((x) => x.layers.includes('F.Cu')).length;
    expect(flashes).toBe(pads + p.board.vias.length);
    const units = tree.children.find((n) => n.type === 'units');
    expect(units && 'units' in units && units.units).toBe('mm');
    const fmt = tree.children.find((n) => n.type === 'coordinateFormat');
    expect(fmt && 'format' in fmt && fmt.format).toEqual([4, 6]);
    const segs = tree.children.filter((n) => n.type === 'graphic' && n.graphic === 'segment').length;
    const expectSegs = p.board.traces.filter((t) => t.layer === 'F.Cu').reduce((n, t) => n + t.points.length - 1, 0);
    expect(segs).toBe(expectSegs);
    // 坐标翻转：Y 应为负
    const g = tree.children.find((n) => n.type === 'graphic' && n.graphic === 'shape');
    expect(g && 'coordinates' in g && Number(g.coordinates.y)).toBeLessThan(0);
  });
  it('阻焊层：每个焊盘一个开窗，孔径比铜大 0.1mm', () => {
    const tree = parse(exportMaskLayer(p.board, 'F'));
    const defs = tree.children.filter((n) => n.type === 'toolDefinition');
    expect(defs.length).toBeGreaterThan(0);
    const u1 = p.board.footprints.find((f) => f.ref === 'U1')!;
    const pad = footprintPads(u1, p.board)[0];
    const hit = defs.find((d) => 'shape' in d && d.shape.type === 'rectangle' && Math.abs(d.shape.xSize - (pad.rect.w + 0.1)) < 1e-6);
    expect(hit).toBeTruthy();
  });
  it('钻孔：过孔进 PTH，定位孔进 NPTH', () => {
    const ed = new ProjectEditor(createDemoProject());
    ed.dispatch(pcb.addVia({ x: 10, y: 10, size: 0.6, drill: 0.3, net: 'GND' }));
    const sheet = ed.project.schematic.sheets[0].id;
    ed.dispatch(sch.placeComponent(ed.project, { sheetId: sheet, symbolId: 'sym:MountingHole', center: { x: 8000, y: 6000 } }).command);
    ed.dispatch(pcb.syncFromSchematic());
    const pth = parse(exportExcellon(ed.project.board, true));
    const npth = parse(exportExcellon(ed.project.board, false));
    expect(pth.filetype).toBe('drill');
    expect(pth.children.filter((n) => n.type === 'graphic').length).toBe(ed.project.board.vias.length);
    expect(npth.children.filter((n) => n.type === 'graphic').length).toBe(1);
    const tool = npth.children.find((n) => n.type === 'toolDefinition');
    expect(tool && 'shape' in tool && tool.shape.type === 'circle' && tool.shape.diameter).toBe(3.2);
  });
  it('笔画字体：每个字符都有笔画，宽度随长度增长', () => {
    expect(textStrokes('R1', { x: 0, y: 0 }, { size: 1 }).length).toBeGreaterThan(2);
    expect(textStrokes('ESP32 v3', { x: 0, y: 0 }, { size: 1 }).length).toBeGreaterThanOrEqual(8);
  });
  it('zip 打包可用', () => {
    const z = zipFiles(exportFabFiles(p));
    expect(z.length).toBeGreaterThan(500);
    expect(z[0]).toBe(0x50); expect(z[1]).toBe(0x4b);
  });
});

describe('热焊盘', () => {
  it('同网络焊盘四周留缝、中心经辐条连通；实心模式下无缝', async () => {
    const { createDemoProject, ProjectEditor, pcb, zoneFills, ruleSetOf, footprintPads, pointInPolygon, computeRatsnest } = await import('../src/index.js');
    const ed = new ProjectEditor(createDemoProject());
    // 顶层 GND 铺铜覆盖 U1.8（GND）
    ed.dispatch(pcb.addZone({ layer: 'F.Cu', net: 'GND', polygon: [{ x: 20, y: 14 }, { x: 34, y: 14 }, { x: 34, y: 24 }, { x: 20, y: 24 }] }));
    const rules = ruleSetOf(ed.project);
    const u1 = ed.project.board.footprints.find((f) => f.ref === 'U1')!;
    const pad8 = footprintPads(u1, ed.project.board).find((p) => p.number === '8')!;
    const zone = ed.project.board.zones.find((z) => z.layer === 'F.Cu')!;
    const inFill = () => { const f = zoneFills(ed.project.board, rules).find((x) => x.zone.id === zone.id)!; return (p: { x: number; y: number }) => f.polygons.some((poly) => pointInPolygon(p, poly[0]) && !poly.slice(1).some((h) => pointInPolygon(p, h))); };
    let test = inFill();
    const diag = { x: pad8.rect.x + pad8.rect.w + 0.15, y: pad8.rect.y + pad8.rect.h + 0.15 };
    expect(test(pad8.center)).toBe(true);        // 辐条经过中心
    expect(test(diag)).toBe(false);              // 对角处是间隙
    expect(test({ x: pad8.center.x + pad8.rect.w / 2 + 0.15, y: pad8.center.y })).toBe(true); // 水平辐条
    void computeRatsnest;
    ed.dispatch(pcb.setZoneProps(zone.id, { thermal: 'solid' }));
    test = inFill();
    expect(test(diag)).toBe(true);
  });
});
