import { describe, it, expect } from 'vitest';
import { createDemoProject, autoroute, ruleSetOf, ProjectEditor, pcb, computeRatsnest, runDrc, alignFootprints, footprintBody } from '../src/index.js';

describe('自动布线', () => {
  it('示例板全部网络布通，应用后无飞线且 DRC 无间距错误', () => {
    const ed = new ProjectEditor(createDemoProject());
    const rules = ruleSetOf(ed.project);
    const before = computeRatsnest(ed.project.board, rules).unrouted;
    expect(before).toBeGreaterThan(0);
    const r = autoroute(ed.project.board, rules);
    expect(r.failed, JSON.stringify(r.failed)).toEqual([]);
    expect(r.routed).toBe(before);
    ed.dispatch(pcb.applyRoutes(r.traces, r.vias));
    expect(computeRatsnest(ed.project.board, rules).unrouted).toBe(0);
    const rep = runDrc(ed.project.board, rules);
    expect(rep.items.filter((i) => i.rule === 'clearance' || i.rule === 'unrouted').map((i) => i.message)).toEqual([]);
    for (const t of r.traces) expect(t.width).toBeGreaterThan(0);
  });
  it('可以只布指定网络', () => {
    const p = createDemoProject();
    const r = autoroute(p.board, ruleSetOf(p), { nets: ['GND'] });
    expect(r.traces.every((t) => t.net === 'GND')).toBe(true);
    expect(r.routed).toBeGreaterThan(0);
  });
});

describe('对齐 / 分布', () => {
  it('左对齐后左边界一致，水平等距后间距相等', () => {
    const p = createDemoProject();
    const ids = p.board.footprints.filter((f) => ['C1', 'R1', 'D1'].includes(f.ref)).map((f) => f.id);
    const left = alignFootprints(p.board, ids, 'left');
    const b0 = footprintBody({ ...p.board.footprints.find((f) => f.id === left[0].id)!, x: left[0].x });
    for (const m of left) { const f = p.board.footprints.find((x) => x.id === m.id)!; expect(footprintBody({ ...f, x: m.x }).x).toBeCloseTo(b0.x, 6); }
    const dist = alignFootprints(p.board, ids, 'hdist');
    const bodies = dist.map((m) => { const f = p.board.footprints.find((x) => x.id === m.id)!; return footprintBody({ ...f, x: m.x }); }).sort((a, b) => a.x - b.x);
    const gap1 = bodies[1].x - (bodies[0].x + bodies[0].w), gap2 = bodies[2].x - (bodies[1].x + bodies[1].w);
    expect(gap1).toBeCloseTo(gap2, 6);
  });
});

describe('自动布线：更密的板', () => {
  it('ESP32 + 排针 + 多个阻容全部布通，DRC 无间距错误，所有线段都是 0/45/90°', async () => {
    const { createProject, ProjectEditor, sch, pcb, findPin, autoroute, ruleSetOf, runDrc, computeRatsnest, setOutline } = await import('../src/index.js').then((m) => ({ ...m, setOutline: m.pcb.setOutlineRect }));
    const ed = new ProjectEditor(createProject({ name: 'dense' }));
    const sid = ed.project.schematic.sheets[0].id;
    const place = (symbolId: string, x: number, y: number, value?: string, footprint?: string, props?: Record<string, string>) => { const r = sch.placeComponent(ed.project, { sheetId: sid, symbolId, center: { x, y }, value, footprint, props }); ed.dispatch(r.command); return r.id; };
    const U1 = place('sym:ESP32-WROOM-32E', 4000, 2500);
    const J1 = place('sym:USB-C-16P', 9000, 2500, 'USB-C', 'fp:kicad:PinHeader_1x04_P2.54mm_Vertical', { kicadFootprint: 'Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical' });
    const rs = [1, 2, 3].map((i) => place('sym:R', 1500 + i * 600, 5500, '10k'));
    const cs = [1, 2].map((i) => place('sym:C', 6500 + i * 600, 5500, '100n'));
    const label = (cid: string, pin: string, net: string) => { const c = ed.project.schematic.sheets[0].components.find((x) => x.id === cid)!; const g = findPin(c, pin)!; const dir = { x: Math.sign(g.end.x - g.base.x), y: Math.sign(g.end.y - g.base.y) }; const tip = { x: g.end.x + dir.x * 200, y: g.end.y + dir.y * 200 }; ed.dispatch(sch.addWire(sid, [g.end, tip])); ed.dispatch(sch.addLabel(sid, net, tip)); };
    label(U1, '1', 'EN'); label(U1, '2', 'IO0'); label(U1, '3', 'SDA'); label(U1, '4', 'SCL'); label(U1, '5', 'V33'); label(U1, '6', 'TXD'); label(U1, '7', 'RXD'); label(U1, '8', 'GND');
    label(J1, 'A4', 'V33'); label(J1, 'A5', 'TXD'); label(J1, 'A6', 'RXD'); label(J1, 'A1', 'GND');
    label(rs[0], '1', 'V33'); label(rs[0], '2', 'EN'); label(rs[1], '1', 'V33'); label(rs[1], '2', 'SDA'); label(rs[2], '1', 'V33'); label(rs[2], '2', 'SCL');
    label(cs[0], '1', 'V33'); label(cs[0], '2', 'GND'); label(cs[1], '1', 'V33'); label(cs[1], '2', 'GND');
    ed.dispatch(setOutline(50, 35));
    ed.dispatch(pcb.syncFromSchematic());
    const fp = (ref: string) => ed.project.board.footprints.find((f) => f.ref === ref)!;
    ed.dispatch(pcb.moveFootprint(fp('U1').id, { x: 15, y: 17 }));
    ed.dispatch(pcb.moveFootprint(fp('J1').id, { x: 42, y: 12 }));
    ed.dispatch(pcb.rotateFootprint(fp('J1').id, 90));
    ed.dispatch(pcb.moveFootprint(fp('R1').id, { x: 30, y: 8 })); ed.dispatch(pcb.moveFootprint(fp('R2').id, { x: 30, y: 12 })); ed.dispatch(pcb.moveFootprint(fp('R3').id, { x: 30, y: 16 }));
    ed.dispatch(pcb.moveFootprint(fp('C1').id, { x: 30, y: 22 })); ed.dispatch(pcb.moveFootprint(fp('C2').id, { x: 36, y: 22 }));
    const rules = ruleSetOf(ed.project);
    const r = autoroute(ed.project.board, rules);
    ed.dispatch(pcb.applyRoutes(r.traces, r.vias));
    const rep = runDrc(ed.project.board, rules);
    expect(rep.items.filter((i) => i.rule === 'clearance').map((i) => i.message + ' ' + i.refs.join(','))).toEqual([]);
    expect(r.failed.length, JSON.stringify(r.failed)).toBeLessThanOrEqual(1);
    expect(computeRatsnest(ed.project.board, rules).unrouted).toBe(r.failed.length);
    for (const t of r.traces) for (let i = 0; i < t.points.length - 1; i++) { const a = t.points[i], b = t.points[i + 1]; const ang = Math.abs(Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI); const k = ang % 45; expect(Math.min(k, 45 - k), `${t.net} seg ${i} ${ang.toFixed(1)}°`).toBeLessThan(0.5); }
  });
});
