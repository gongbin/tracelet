import {expect,it} from 'vitest';
import {alignDrag,rulerTicks} from '../src/editors/pcb/alignment';
it('snaps near equal edges and centers but leaves unrelated positions on grid',()=>{
 const targets=[{x:10,y:10,w:4,h:4}];
 const hit=alignDrag({x:10.2,y:20},{x:0,y:0,w:4,h:4},targets,.5,.25);
 expect(hit.position.x).toBe(10);expect(hit.guides.some(g=>g.axis==='x')).toBe(true);
 expect(alignDrag({x:20.13,y:20.12},{x:0,y:0,w:4,h:4},targets,.5,.25).position).toEqual({x:20.25,y:20});
});
it('does not attract a dragged component into an overlap',()=>{
 const r=alignDrag({x:14.2,y:10.1},{x:0,y:0,w:4,h:4},[{x:10,y:10,w:4,h:4}],.5,.25);
 expect(r.position.x).toBeGreaterThanOrEqual(14);
});
it('ruler coordinates remain consistent with pan, zoom and negative origins',()=>{
 const ticks=rulerTicks(37,12,600);
 expect(ticks.length).toBeGreaterThan(5);
 for(const t of ticks)expect(t.pixel).toBeCloseTo(t.value*12+37);
 expect(ticks.some(t=>t.value===0)).toBe(true);
});
