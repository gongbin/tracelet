import { describe, it, expect } from 'vitest';
import { createFromTemplate, ruleSetOf, autoroute, ProjectEditor, pcb, boardBounds, rectOutline, runDrc } from '../src/index.js';

describe('板框圆角与撤销布线', () => {
  it('rectOutline：r=0 为 4 点，r>0 为圆角折线且外接矩形不变，半径自动限制', () => {
    expect(rectOutline(0, 0, 50, 30, 0)).toHaveLength(4);
    const r = rectOutline(10, 5, 50, 30, 3);
    expect(r.length).toBeGreaterThan(20);
    const xs = r.map((p) => p.x), ys = r.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(10, 3); expect(Math.max(...xs)).toBeCloseTo(60, 3); expect(Math.min(...ys)).toBeCloseTo(5, 3); expect(Math.max(...ys)).toBeCloseTo(35, 3);
    expect(r.some((p) => Math.abs(p.x - 10) < 1e-6 && Math.abs(p.y - 5) < 1e-6)).toBe(false); // 角被切掉
    const big = rectOutline(0, 0, 10, 4, 100); expect(Math.max(...big.map((p) => p.x))).toBeCloseTo(10, 3);
  });
  it('setOutlineRadius 保持外接矩形，改长宽后圆角仍在，DRC 与布线正常', () => {
    const ed = new ProjectEditor(createFromTemplate('stm32'));
    const before = boardBounds(ed.project.board);
    ed.dispatch(pcb.setOutlineRadius(2));
    expect(ed.project.board.outlineRadius).toBe(2);
    expect(boardBounds(ed.project.board)).toEqual(before);
    ed.dispatch(pcb.setOutlineRect(before.w + 5, before.h));
    expect(ed.project.board.outline.length).toBeGreaterThan(20);
    expect(boardBounds(ed.project.board).w).toBeCloseTo(before.w + 5, 3);
    const rules = ruleSetOf(ed.project);
    const r = autoroute(ed.project.board, rules, { timeBudgetMs: 8000 });
    expect(r.routed).toBe(r.total);
    ed.dispatch(pcb.applyRoutes(r.traces, r.vias));
    expect(runDrc(ed.project.board, rules).items.filter((i) => i.rule === 'clearance' || i.rule === 'edge-clearance').length).toBe(0);
    // 撤销布线：走线 / 过孔清空、铺铜可保留
    ed.dispatch(pcb.addZone({ layer: 'B.Cu', net: 'GND', polygon: ed.project.board.outline }));
    ed.dispatch(pcb.clearRouting({ traces: true, vias: true, zones: false }));
    expect(ed.project.board.traces).toHaveLength(0); expect(ed.project.board.vias).toHaveLength(0); expect(ed.project.board.zones).toHaveLength(1);
    ed.undo();
    expect(ed.project.board.traces.length).toBeGreaterThan(0);
    ed.dispatch(pcb.clearRouting());
    expect(ed.project.board.zones).toHaveLength(0);
  }, 30000);
});
