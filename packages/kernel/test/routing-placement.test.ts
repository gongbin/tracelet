import { it, expect } from 'vitest';
import { emptyBoard } from '../src/model/board.js';
import { RULE_SETS } from '../src/model/project.js';
import { registerFootprints } from '../src/library/registry.js';
import { suggestRoutingMoves } from '../src/board/routingPlacement.js';
import { autoroute } from '../src/board/autoroute.js';
import { createProject, ProjectEditor, pcb } from '../src/index.js';
registerFootprints([{ id: 'test:move-pad',name:'move pad',body:{w:1,h:1},height:1,description:'',pads:[{number:'1',x:0,y:0,w:1,h:1,shape:'rect',drill:0,npth:false}]}]);
function fixture(){const b=emptyBoard();b.footprints=[{id:'r1',ref:'R1',footprintId:'test:move-pad',x:5,y:10,rotation:0,side:'F' as const,value:'',padNets:{'1':'A'}},{id:'r2',ref:'R2',footprintId:'test:move-pad',x:5.6,y:10,rotation:0,side:'F' as const,value:'',padNets:{'1':'B'}},{id:'r3',ref:'R3',footprintId:'test:move-pad',x:15,y:10,rotation:0,side:'F' as const,value:'',padNets:{'1':'A'}}];return b;}
it('proposes bounded moves without mutating input and improves an obstructed route',()=>{
 const b=fixture(), original=JSON.stringify(b);
 const r=autoroute(b,RULE_SETS[0],{noRetry:true,maxNodes:10000,allowComponentMoves:true});
 expect(r.routed).toBe(r.total);expect(r.moves?.length).toBeGreaterThan(0);
 for(const m of r.moves!)expect(Math.hypot(m.x-m.from.x,m.y-m.from.y)).toBeLessThanOrEqual(2.000001);
 expect(JSON.stringify(b)).toBe(original);
 const p=createProject({name:'move'});p.board=b;const ed=new ProjectEditor(p);
 ed.dispatch(pcb.applyRoutes(r.traces,r.vias,r.moves));expect(ed.project.board.footprints).not.toEqual(b.footprints);
 ed.undo();expect(ed.project.board).toEqual(b);
});
it('does not move locked components, connectors, or wired pads',()=>{
 for(const variant of ['locked','connector','wired']){
  const b=fixture();if(variant==='locked')b.footprints[0].locked=true;
  if(variant==='connector')b.footprints[0].ref='J1';
  if(variant==='wired')b.traces=[{id:'existing',net:'A',layer:'F.Cu',width:.25,points:[{x:5,y:10},{x:5,y:12}]}];
  expect(suggestRoutingMoves(b,RULE_SETS[0],['A']).some(m=>m.id==='r1')).toBe(false);
 }
});
