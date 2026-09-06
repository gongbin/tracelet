import { describe, it, expect } from 'vitest';
import { emptyBoard, BoardFootprintSchema } from '../src/model/board.js';
import { RULE_SETS } from '../src/model/project.js';
import { registerFootprints } from '../src/library/registry.js';
import { optimizePlacement, applyPlacement } from '../src/board/placement.js';
import { placementConstraintErrors } from '../src/board/placementConstraints.js';
import { createProject, ProjectEditor, pcb } from '../src/index.js';

registerFootprints([{id:'test:p1',name:'p1',body:{w:2,h:2},height:1,description:'',
  pads:[{number:'1',x:0,y:0,w:.6,h:.6,shape:'rect',drill:0,npth:false}]}]);
const part = (id:string,x:number,y:number) => BoardFootprintSchema.parse({id,ref:id,footprintId:'test:p1',x,y,padNets:{'1':'A'}});
describe('initial placement and intent',()=>{
 it('reconstructs staged parts inside the board without moving locked, mechanical or wired parts',()=>{
  const b=emptyBoard();
  b.footprints=[{...part('U1',8,8),locked:true},{...part('H1',25,8),placement:{role:'mechanical'}},part('R1',16,8),part('R2',60,8),part('R3',65,8)];
  b.traces=[{id:'wired',layer:'F.Cu',net:'A',width:.25,points:[{x:16,y:8},{x:16,y:10}]}];
  const original=JSON.stringify(b);
  const r=optimizePlacement(b,RULE_SETS[0],{mode:'initial',iterations:2000,seed:1,verifyRouting:false});
  expect(r.rejected).toBeUndefined();expect(r.after.outside).toBe(0);expect(r.after.overlaps).toBe(0);
  expect(r.moves.map(m=>m.id).sort()).toEqual(['R2','R3']);
  expect(JSON.stringify(b)).toBe(original);
 });
 it('places a connector on its specified edge facing outwards',()=>{
  const b=emptyBoard();b.footprints=[{...part('J1',25,15),placement:{role:'connector',edge:{index:1,direction:0,distance:2}}}];
  const r=optimizePlacement(b,RULE_SETS[0],{mode:'initial',iterations:1000,verifyRouting:false});
  expect(r.rejected).toBeUndefined();expect(r.moves).toHaveLength(1);
  const after=applyPlacement(b,r.moves);expect(after.footprints[0].x).toBeGreaterThan(45);
  expect(placementConstraintErrors(after)).toEqual([]);
 });
 it('honours an explicit target pad and rejects an invalid reference',()=>{
  const b=emptyBoard();b.footprints=[{...part('U1',20,15),locked:true},{...part('C1',60,15),placement:{target:{footprintId:'U1',pad:'1',maxDistance:5}}}];
  const r=optimizePlacement(b,RULE_SETS[0],{mode:'initial',iterations:1000,verifyRouting:false});
  expect(r.rejected).toBeUndefined();expect(placementConstraintErrors(applyPlacement(b,r.moves))).toEqual([]);
  b.footprints[1].placement!.target!.pad='missing';
  expect(optimizePlacement(b,RULE_SETS[0],{mode:'initial',iterations:20,verifyRouting:false}).rejected).toBeTruthy();
 });
 it('saves constraints and restores them using undo/redo',()=>{
  const project=createProject({name:'intent'});project.board.footprints=[part('R1',10,10)];
  const ed=new ProjectEditor(project),intent={fixed:true,group:'power'};
  ed.dispatch(pcb.setPlacementConstraints('R1',intent));
  expect(BoardFootprintSchema.parse(ed.project.board.footprints[0]).placement).toEqual(intent);
  ed.undo();expect(ed.project.board.footprints[0].placement).toBeUndefined();
  ed.redo();expect(ed.project.board.footprints[0].placement).toEqual(intent);
 });
});

it('offers capacity estimates without silently resizing constrained boards and supports atomic undo',async()=>{
 const {estimateBoardSize}=await import('../src/board/placement.js');
 const project=createProject({name:'estimate'});project.board.footprints=[part('R1',60,8),part('R2',65,8)];
 const original=project.board;
 const size=estimateBoardSize(original,RULE_SETS[0]);expect(size.canResize).toBe(true);
 const r=optimizePlacement(original,RULE_SETS[0],{mode:'initial',estimateOutline:true,iterations:100,verifyRouting:false});
 expect(r.rejected).toBeUndefined();expect(r.outline).toEqual(size.outline);expect(r.after.outside).toBe(0);
 const ed=new ProjectEditor(project);ed.dispatch(pcb.applyPlacementMoves(r.moves,r.outline));expect(ed.project.board.outline).toEqual(size.outline);
 ed.undo();expect(ed.project.board).toEqual(original);
 expect(estimateBoardSize({...original,footprints:[{...original.footprints[0],locked:true}]},RULE_SETS[0]).canResize).toBe(false);
});
it('places an unconstrained connector near an edge during initial placement',()=>{
 const b=emptyBoard();b.footprints=[part('J1',25,15),part('R1',60,15)];
 const r=optimizePlacement(b,RULE_SETS[0],{mode:'initial',iterations:0,verifyRouting:false});
 expect(r.rejected).toBeUndefined();
 const j=applyPlacement(b,r.moves).footprints[0];
 expect(Math.min(j.x,50-j.x,j.y,30-j.y)).toBeLessThanOrEqual(3);
});
it('rejects a body spanning a concave notch even when all its corners are inside',async()=>{
 const {bodyInsideOutline}=await import('../src/board/placementConstraints.js');
 const outline=[{x:0,y:0},{x:4,y:0},{x:4,y:6},{x:6,y:6},{x:6,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];
 expect(bodyInsideOutline({x:2,y:2,w:6,h:6},outline)).toBe(false);
 expect(bodyInsideOutline({x:1,y:7,w:8,h:2},outline)).toBe(true);
});
