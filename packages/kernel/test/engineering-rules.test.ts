import {expect,it} from 'vitest';
import {emptyBoard,NetClassSchema,type Trace} from '../src/model/board.js';
import {engineeringRules,referenceSupports,neighborCost} from '../src/board/engineeringRules.js';
import {electricalChecks} from '../src/board/routingQuality.js';
import type {ZoneFill} from '../src/board/zones.js';
const trace=(id:string,net:string,y:number,x1=5,x2=15):Trace=>({id,net,layer:'F.Cu',width:.2,points:[{x:x1,y},{x:x2,y}]});
it('keeps old projects opt-out and validates explicit finite engineering parameters',()=>{
 const b=emptyBoard();expect(engineeringRules(b,'A').preferredClearance).toBeUndefined();
 expect(NetClassSchema.safeParse({...b.netClasses[0],engineering:{preferredClearance:-1}}).success).toBe(false);
 b.traces=[trace('a','A',10),trace('b','B',10.5)];expect(electricalChecks(b)).toEqual([]);
});
it('detects accumulated parallel exposure across split traces and excludes differential partners',()=>{
 const b=emptyBoard();b.netClasses[0].engineering={preferredClearance:1,maxParallelLength:8};
 b.traces=[trace('a','A',10),trace('b','B',10.5,5,10),trace('c','B',10.5,10,15)];
 expect(electricalChecks(b).some(i=>i.rule==='parallel-exposure')).toBe(true);
 expect(neighborCost(b,'A','F.Cu',{x:8,y:10},.2,b.traces)).toBeGreaterThan(0);
 b.differentialPairs=[{positive:'A',negative:'B',gap:.3,tolerance:.01,maxSkew:.1}];
 expect(electricalChecks(b).some(i=>i.rule==='parallel-exposure')).toBe(false);
 expect(neighborCost(b,'A','F.Cu',{x:8,y:10},.2,b.traces)).toBe(0);
});
it('finds sub-sample reference plane holes, respects margin and never bridges separate islands',()=>{
 const b=emptyBoard();b.netClasses[0].referenceLayer='B.Cu';b.netClasses[0].referenceNet='GND';
 const ring=(x:number,y:number,w:number,h:number)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
 const fill:ZoneFill={zone:{id:'z',net:'GND',layer:'B.Cu',polygon:[],thermal:'solid',thermalGap:.3,spokeWidth:.4,clearance:0},polygons:[[ring(0,0,20,20),ring(8.21,9.9,.02,.2)]]};
 expect(referenceSupports(b,[fill],'A','F.Cu',{x:5,y:10},{x:15,y:10},.1)).toBe(false);
 fill.polygons=[[ring(0,0,20,20)]];
 expect(referenceSupports(b,[fill],'A','F.Cu',{x:5,y:10},{x:15,y:10},.1)).toBe(true);
 b.netClasses[0].engineering={referenceMargin:6};
 expect(referenceSupports(b,[fill],'A','F.Cu',{x:5,y:10},{x:15,y:10},.1)).toBe(false);
});
it('checks return vias at interior trace intersections and respects blind via spans',()=>{
 const b=emptyBoard();b.copperCount=4;b.netClasses[0].referenceNet='GND';b.netClasses[0].engineering={returnViaDistance:1};
 b.traces=[trace('a','A',10),{...trace('b','A',10),layer:'B.Cu'}];
 b.vias=[{id:'signal',net:'A',x:10,y:10,size:.6,drill:.3}];
 expect(electricalChecks(b).some(i=>i.rule==='return-via')).toBe(true);
 b.vias.push({id:'return',net:'GND',x:10,y:10.8,size:.6,drill:.3,startLayer:'F.Cu',endLayer:'In1.Cu'});
 expect(electricalChecks(b).some(i=>i.rule==='return-via')).toBe(true);
 delete b.vias[1].startLayer;delete b.vias[1].endLayer;
 expect(electricalChecks(b).some(i=>i.rule==='return-via')).toBe(false);
});
