import {it,expect} from 'vitest';
import {emptyBoard,type Trace} from '../src/model/board.js';
import {RULE_SETS} from '../src/model/project.js';
import {copperShorts} from '../src/board/copperConnectivity.js';
const tr=(id:string,net:string,x:number,y:number,x2:number,y2:number,layer:Trace['layer']='F.Cu'):Trace=>({id,net,layer,width:.25,points:[{x,y},{x:x2,y:y2}]});
it('finds two named nets connected through anonymous copper without changing the input',()=>{
 const b=emptyBoard();b.traces=[tr('a','VCC',2,5,5,5),tr('bridge','',5,5,10,5),tr('b','GND',10,5,15,5)];
 const before=JSON.stringify(b);const result=copperShorts(b,RULE_SETS[0]);
 expect(result).toHaveLength(1);expect(result[0].refs).toEqual(['GND','VCC']);expect(result[0].objectIds).toContain('bridge');expect(JSON.stringify(b)).toBe(before);
});
it('does not join crossing copper on separate layers but recognizes a conducting via',()=>{
 const b=emptyBoard();b.traces=[tr('a','VCC',2,5,15,5),tr('b','GND',8,2,8,10,'B.Cu')];
 expect(copperShorts(b,RULE_SETS[0])).toEqual([]);
 b.vias=[{id:'v',net:'',x:8,y:5,size:.6,drill:.3}];expect(copperShorts(b,RULE_SETS[0])).toHaveLength(1);
 b.copperCount=4;b.vias[0].startLayer='F.Cu';b.vias[0].endLayer='In1.Cu';expect(copperShorts(b,RULE_SETS[0])).toEqual([]);
});
it('keeps disconnected zone islands separate',()=>{
 const b=emptyBoard();b.traces=[tr('a','A',2,3,3,3),tr('b','B',12,3,13,3)];
 const box=(x:number)=>[{x,y:1},{x:x+4,y:1},{x:x+4,y:5},{x,y:5}];
 const fill={zone:{id:'z',net:'',layer:'F.Cu' as const,polygon:[],thermal:'solid' as const,thermalGap:.3,spokeWidth:.4,clearance:0},polygons:[[box(0)],[box(10)]]};
 expect(copperShorts(b,RULE_SETS[0],[fill])).toEqual([]);
});
