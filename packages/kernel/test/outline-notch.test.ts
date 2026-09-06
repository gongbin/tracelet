import { expect, it } from 'vitest';
import { notchOutline, pointInPolygon, createDemoProject, ProjectEditor, pcb } from '../src/index.js';
const rect = [{x:0,y:0},{x:30,y:0},{x:30,y:20},{x:0,y:20}];
it('cuts inward for either winding, on every edge, without changing input', () => {
  for (const outline of [rect, [...rect].reverse()]) for (let edge = 0; edge < 4; edge++) {
    const result = notchOutline(outline, edge, 5, 5, 3);
    expect(result).toHaveLength(8);
    const inner = result[edge + 2];
    expect(pointInPolygon(inner, rect)).toBe(true);
  }
  expect(rect).toHaveLength(4);
  const result = notchOutline(rect, 0, 5, 5, 3);
  expect(pointInPolygon({x:7,y:1}, result)).toBe(false);
  expect(pointInPolygon({x:7,y:4}, result)).toBe(true);
});
it('rejects invalid dimensions and cuts through the opposite edge', () => {
  for (const [offset,width,depth] of [[0,5,3],[5,-1,3],[5,25,3],[5,5,20],[5,5,30],[5,NaN,3]])
    expect(() => notchOutline(rect,0,offset,width,depth)).toThrow();
});
it('supports repeated notches and an undo without moving copper or components', () => {
  const project = createDemoProject(); project.board.outline = rect;
  const ed = new ProjectEditor(project);
  const result = notchOutline(notchOutline(rect,0,5,5,3),5,5,5,3);
  ed.dispatch(pcb.setOutline(result));
  expect(ed.project.board.footprints).toEqual(project.board.footprints);
  expect(ed.project.board.traces).toEqual(project.board.traces);
  expect(ed.project.board.outline).toEqual(result);
  ed.undo(); expect(ed.project.board.outline).toEqual(rect);
});
