import { it, expect, vi } from 'vitest';
import { createFromTemplate, ruleSetOf, autoroute, computeRatsnest, runDrc, type Board } from '../src/index.js';
import { emptyBoard } from '../src/model/board.js';
import { registerFootprints } from '../src/library/registry.js';
import { RULE_SETS } from '../src/model/project.js';
registerFootprints([{id:'test:search',name:'search',body:{w:1,h:1},height:1,description:'',pads:[{number:'1',x:0,y:0,w:1,h:1,shape:'rect',drill:0,npth:false}]}]);
function fixture():Board {
 const b=emptyBoard();
 b.footprints=[['A',5,5],['A',25,5],['B',5,15],['B',10,15]].map(([net,x,y],i)=>({id:'p'+i,ref:'R'+i,footprintId:'test:search',x:Number(x),y:Number(y),rotation:0,side:'F',value:'',padNets:{'1':String(net)}}));
 return b;
}
it.each([2,4] as const)('directional search produces connected, clearance-safe copper on %i layers',copperCount=>{
 const b=fixture();b.copperCount=copperCount;
 const debug:Record<string,unknown>[]=[];
 const r=autoroute(b,RULE_SETS[0],{directionalSearch:true,optimize:false,debug:v=>debug.push(v)});
 const output={...b,traces:r.traces.map((t,i)=>({...t,id:'t'+i})),vias:r.vias.map((v,i)=>({...v,id:'v'+i}))};
 expect(computeRatsnest(output,RULE_SETS[0]).unrouted).toBe(0);
 expect(runDrc(output,RULE_SETS[0]).items.filter(i=>i.rule==='clearance')).toEqual([]);
 expect(debug.some(d=>d.directional===true && d.found===true && Number(d.states)>0)).toBe(true);
});
it('honours explicit network order even when the first connection is longer',()=>{
 const b=fixture(),order:string[]=[];
 autoroute(b,RULE_SETS[0],{priorityNets:['A','B'],optimize:false,onProgress:(_,__,net)=>order.push(net)});
 expect(order[0]).toBe('A');
});
it.each([false,true])('returns a safe incomplete proposal when the time budget is exhausted (global=%s)',globalRoute=>{
 const p=createFromTemplate('stm32'), original=JSON.stringify(p.board);
 // No elapsed-wall-time assertion: deterministic clock advancement, no timer scheduling.
 let time=0;const clock=vi.spyOn(Date,'now').mockImplementation(()=>time+=100);
 try {
  const r=autoroute(p.board,ruleSetOf(p),{timeBudgetMs:1,allowComponentMoves:false,globalRoute});
  expect(r.routed).toBe(0);expect(r.traces).toEqual([]);expect(r.failed.length).toBeGreaterThan(0);
  expect(JSON.stringify(p.board)).toBe(original);
 } finally {clock.mockRestore();}
});

it('preserves directional state across vias when outer-layer barriers require inner copper',()=>{
 const b=fixture();b.copperCount=4;
 b.traces=(['F.Cu','B.Cu'] as const).map(layer=>({id:layer,layer,net:'OTHER',width:1,points:[{x:15,y:0},{x:15,y:30}]}));
 const r=autoroute(b,RULE_SETS[0],{directionalSearch:true,grid:.5,fineRetry:false,optimize:false});
 expect(r.routed).toBe(r.total);expect(r.vias.length).toBeGreaterThanOrEqual(2);
 const output={...b,traces:[...b.traces,...r.traces.map((t,i)=>({...t,id:'t'+i}))],vias:r.vias.map((v,i)=>({...v,id:'v'+i}))};
 expect(computeRatsnest(output,RULE_SETS[0]).unrouted).toBe(0);
 expect(runDrc(output,RULE_SETS[0]).items.filter(i=>i.rule==='clearance')).toEqual([]);
});
it('keeps the dense template connected and clearance-safe with cascade shoving enabled',()=>{
 const p=createFromTemplate('stm32'),rules=ruleSetOf(p),original=JSON.stringify(p.board);
 const r=autoroute(p.board,rules,{shove:3,timeBudgetMs:15000});
 const output={...p.board,traces:[...p.board.traces,...r.traces.map((t,i)=>({...t,id:'cascade-t'+i}))],vias:[...p.board.vias,...r.vias.map((v,i)=>({...v,id:'cascade-v'+i}))]};
 expect(computeRatsnest(output,rules).unrouted).toBe(0);
 expect(runDrc(output,rules).items.filter(i=>i.rule==='clearance')).toEqual([]);
 expect(JSON.stringify(p.board)).toBe(original);
});
