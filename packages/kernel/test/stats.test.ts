import { describe, it, expect } from 'vitest';
import { createFromTemplate, ruleSetOf, autoroute, ProjectEditor, pcb, traceLengthStats, polylineLength } from '../src/index.js';

describe('走线长度统计', () => {
  it('polylineLength 与按网络汇总', () => {
    expect(polylineLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }])).toBeCloseTo(11, 9);
    const ed = new ProjectEditor(createFromTemplate('esp32'));
    const rules = ruleSetOf(ed.project);
    const r = autoroute(ed.project.board, rules, { timeBudgetMs: 8000 });
    ed.dispatch(pcb.applyRoutes(r.traces, r.vias));
    const st = traceLengthStats(ed.project.board);
    expect(st.nets.length).toBeGreaterThan(3);
    expect(st.total).toBeGreaterThan(0);
    expect(st.nets.every((n, i, a) => i === 0 || a[i - 1].length >= n.length)).toBe(true);
    const sum = st.nets.reduce((n, s) => n + s.length, 0) + st.unassigned;
    expect(Math.abs(sum - st.total)).toBeLessThan(0.05 * st.nets.length + 0.01);
    expect(st.nets.reduce((n, s) => n + s.vias, 0)).toBe(ed.project.board.vias.filter((v) => v.net).length);
    for (const n of st.nets) expect(Math.abs(Object.values(n.byLayer).reduce((a, b) => a + (b ?? 0), 0) - n.length)).toBeLessThan(0.05);
  }, 30000);
});
