import { describe, it, expect } from 'vitest';
import { createDemoProject, computeRatsnest, runDrc, ruleSetOf, ProjectEditor, pcb, sch, footprintPads, exportBomCsv, exportNetlistJson, RULE_SETS } from '../src/index.js';

describe('原理图 → PCB 同步', () => {
  it('为每个非电源元件生成封装并带上焊盘网络', () => {
    const p = createDemoProject();
    const refs = p.board.footprints.map((f) => f.ref).sort();
    expect(refs).toEqual(['C1', 'D1', 'R1', 'U1']);
    const u1 = p.board.footprints.find((f) => f.ref === 'U1')!;
    expect(u1.padNets['5']).toBe('+3V3');
    expect(u1.padNets['8']).toBe('GND');
  });
  it('删除原理图元件后同步会移除封装，新增会追加', () => {
    const ed = new ProjectEditor(createDemoProject());
    const sheet = ed.project.schematic.sheets[0];
    const d1 = sheet.components.find((c) => c.ref === 'D1')!;
    ed.dispatch(sch.deleteComponents(sheet.id, [d1.id]));
    const r = sch.placeComponent(ed.project, { sheetId: sheet.id, symbolId: 'sym:C', center: { x: 7000, y: 4000 } });
    ed.dispatch(r.command);
    ed.dispatch(pcb.syncFromSchematic());
    const refs = ed.project.board.footprints.map((f) => f.ref).sort();
    expect(refs).toEqual(['C1', 'C2', 'R1', 'U1']);
  });
});

describe('飞线', () => {
  it('已走线的连接不出现飞线，未走线的出现', () => {
    const p = createDemoProject();
    const rats = computeRatsnest(p.board);
    const nets = new Set(rats.lines.map((l) => l.net));
    expect(nets.has('+3V3')).toBe(false);
    expect(nets.has('GND')).toBe(true);
    expect(rats.unrouted).toBeGreaterThan(0);
    expect(rats.unrouted).toBeLessThan(rats.total);
  });
});

describe('DRC', () => {
  it('示例板：有未布线错误，没有间距错误', () => {
    const p = createDemoProject();
    const rep = runDrc(p.board, ruleSetOf(p));
    expect(rep.items.some((i) => i.rule === 'unrouted')).toBe(true);
    expect(rep.items.some((i) => i.rule === 'clearance')).toBe(false);
  });
  it('检测走线与异网焊盘间距不足', () => {
    const ed = new ProjectEditor(createDemoProject());
    const c1 = ed.project.board.footprints.find((f) => f.ref === 'C1')!;
    const pad2 = footprintPads(c1, ed.project.board).find((p) => p.number === '2')!;
    ed.dispatch(pcb.addTrace({ layer: 'F.Cu', net: 'SIG', width: 0.25, points: [{ x: pad2.rect.x + pad2.rect.w + 0.05 + 0.125, y: pad2.center.y - 3 }, { x: pad2.rect.x + pad2.rect.w + 0.05 + 0.125, y: pad2.center.y + 3 }] }).command);
    const rep = runDrc(ed.project.board, RULE_SETS[0]);
    expect(rep.items.some((i) => i.rule === 'clearance' && i.refs[0].includes('C1.2'))).toBe(true);
  });
  it('检测线宽低于板厂最小值', () => {
    const ed = new ProjectEditor(createDemoProject());
    ed.dispatch(pcb.addTrace({ layer: 'B.Cu', net: 'X', width: 0.05, points: [{ x: 5, y: 5 }, { x: 10, y: 5 }] }).command);
    const rep = runDrc(ed.project.board, RULE_SETS[0]);
    expect(rep.items.some((i) => i.rule === 'min-width')).toBe(true);
  });
});

describe('导出', () => {
  it('BOM 按 值+封装 分组', () => {
    const csv = exportBomCsv(createDemoProject());
    expect(csv.split('\n')[0]).toBe('Comment,Designator,Footprint,Quantity,MPN,LCSC Part #');
    expect(csv).toContain('330Ω,R1,R_0402,1');
  });
  it('网表 JSON 含所有网络', () => {
    const nl = exportNetlistJson(createDemoProject());
    expect(nl.nets.map((n) => n.name)).toContain('+3V3');
    expect(nl.components.length).toBe(4);
  });
});

describe('封装解析', () => {
  it('KiCad 封装名映射到内置封装；未知封装生成占位并存入项目库', async () => {
    const { createProject, ProjectEditor, sch, pcb } = await import('../src/index.js');
    const ed = new ProjectEditor(createProject({ name: 't' }));
    const sheet = ed.project.schematic.sheets[0].id;
    const r = sch.placeComponent(ed.project, { sheetId: sheet, symbolId: 'sym:R', center: { x: 1000, y: 1000 }, footprint: 'fp:kicad:R_0603_1608Metric', props: { kicadFootprint: 'Resistor_SMD:R_0603_1608Metric' } });
    ed.dispatch(r.command);
    const u = sch.placeComponent(ed.project, { sheetId: sheet, symbolId: 'sym:ESP32-C3-MINI-1', center: { x: 4000, y: 2000 }, footprint: 'fp:kicad:Weird_Module', props: { kicadFootprint: 'Lib:Weird_Module' } });
    ed.dispatch(u.command);
    ed.dispatch(pcb.syncFromSchematic());
    const fps = ed.project.board.footprints;
    expect(fps.find((f) => f.ref === 'R1')!.footprintId).toBe('fp:R_0603');
    const uf = fps.find((f) => f.ref === 'U1')!;
    expect(uf.footprintId).toBe('fp:ESP32-C3-MINI-1'); // 符号默认封装优先于占位
    expect(ed.project.board.footprints.length).toBe(2);
  });
});

describe('封装缺失的健壮性', () => {
  it('同步前预算一次（如顶栏提示）再执行命令，占位封装仍会写入项目库；序列化后重新加载能渲染焊盘', async () => {
    const { createProject, ProjectEditor, sch, pcb, syncBoardDetailed, parseProject, serializeProject, footprintPads, allPads, autoroute, ruleSetOf, registeredFootprints } = await import('../src/index.js');
    const ed = new ProjectEditor(createProject({ name: 't' }));
    const sheet = ed.project.schematic.sheets[0].id;
    const u = sch.placeComponent(ed.project, { sheetId: sheet, symbolId: 'sym:ESP32-C3-MINI-1', center: { x: 4000, y: 2000 }, footprint: 'fp:kicad:Weird_Module', props: { kicadFootprint: 'Lib:Weird_Module' } });
    ed.dispatch(u.command);
    // 强制走占位：把符号默认封装也去掉
    ed.dispatch(sch.setComponentFootprint(sheet, u.id, 'fp:kicad:Nope'));
    const j = sch.placeComponent(ed.project, { sheetId: sheet, symbolId: 'sym:R', center: { x: 1000, y: 1000 }, footprint: 'fp:kicad:PinHeader_1x02_P2.54mm_Vertical', props: { kicadFootprint: 'Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical' } });
    ed.dispatch(j.command);
    syncBoardDetailed(ed.project); // 预算（注册了占位）
    ed.dispatch(pcb.syncFromSchematic()); // 真正同步
    const lib = ed.project.library.footprints.map((f) => f.id);
    expect(lib.some((id) => id.startsWith('fp:gen:PinHeader_1x02'))).toBe(true);
    const again = parseProject(serializeProject(ed.project));
    for (const fp of again.board.footprints) expect(footprintPads(fp, again.board).length).toBeGreaterThan(0);
    const header = again.board.footprints.find((f) => f.ref === 'R1')!;
    expect(footprintPads(header, again.board)[0].def.drill).toBe(1.0);
    // 即使定义彻底丢失也不崩
    const broken = { ...again, board: { ...again.board, footprints: again.board.footprints.map((f) => ({ ...f, footprintId: 'fp:placeholder:lost' })) } };
    expect(() => allPads(broken.board)).not.toThrow();
    expect(() => autoroute(broken.board, ruleSetOf(broken))).not.toThrow();
    void registeredFootprints;
  });
});
