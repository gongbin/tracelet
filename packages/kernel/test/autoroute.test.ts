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
