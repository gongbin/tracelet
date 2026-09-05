import { describe, it, expect } from 'vitest';
import { createDemoProject, createFromTemplate, ruleSetOf, checkPlacement, optimizePlacement, applyPlacement, placementMetrics, ProjectEditor, pcb, autoroute } from '../src/index.js';

describe('布局检查', () => {
  it('发现重叠、出板、去耦电容过远', () => {
    const p = createDemoProject(); const rules = ruleSetOf(p);
    const ed = new ProjectEditor(p);
    const c1 = p.board.footprints.find((f) => f.ref === 'C1')!, r1 = p.board.footprints.find((f) => f.ref === 'R1')!, d1 = p.board.footprints.find((f) => f.ref === 'D1')!;
    ed.dispatch(pcb.moveFootprint(c1.id, { x: 4, y: 26 })); // 远离 U1 电源脚
    ed.dispatch(pcb.moveFootprint(r1.id, { x: d1.x, y: d1.y })); // 与 D1 重叠
    ed.dispatch(pcb.moveFootprint(ed.project.board.footprints.find((f) => f.ref === 'D1')!.id, { x: 60, y: 10 })); // 出板
    const issues = checkPlacement(ed.project.board, rules);
    const rules_ = new Set(issues.map((i) => i.rule));
    expect(rules_.has('outside')).toBe(true);
    expect(issues.some((i) => i.rule === 'decoupling' && i.refs.includes('C1'))).toBe(true);
    expect(issues.every((i) => i.message && i.refs.length)).toBe(true);
  });
});
describe('布局优化', () => {
  it('STM32 模板：不产生重叠 / 出板，飞线更短，去耦更近，布线不变差', () => {
    const p = createFromTemplate('stm32'); const rules = ruleSetOf(p);
    const r = optimizePlacement(p.board, rules, { iterations: 120000, seed: 1, routeBudgetMs: 8000 });
    expect(r.moves.length).toBeGreaterThan(0);
    expect(r.after.overlaps).toBe(0); expect(r.after.outside).toBe(0);
    expect(r.after.hpwl).toBeLessThan(r.before.hpwl);
    expect(r.after.decouplingAvg).toBeLessThan(r.before.decouplingAvg);
    expect(r.routing!.after.routed).toBeGreaterThanOrEqual(r.routing!.before.routed);
    const b2 = applyPlacement(p.board, r.moves);
    expect(placementMetrics(b2, rules).hpwl).toBe(r.after.hpwl);
    // 锁定与连接器不动
    const j1 = p.board.footprints.find((f) => f.ref === 'J1')!;
    expect(r.moves.some((m) => m.id === j1.id)).toBe(false);
    expect(autoroute(b2, rules, { timeBudgetMs: 8000 }).routed).toBe(48);
  }, 60000);
  it('无可动器件时返回空建议', () => {
    const p = createFromTemplate('arduino'); const r = optimizePlacement(p.board, ruleSetOf(p), { timeBudgetMs: 200, verifyRouting: false });
    expect(r.moves).toEqual([]);
  });
});
