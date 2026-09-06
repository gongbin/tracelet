import {expect,it} from 'vitest';
import {emptyBoard,NetClassSchema,type Trace} from '../src/model/board.js';
import {RULE_SETS} from '../src/model/project.js';
import {electricalChecks} from '../src/board/routingQuality.js';
import {validateRoutingProposal} from '../src/board/routingValidation.js';
import {runDrc} from '../src/board/drc.js';
import {autoroute} from '../src/board/autoroute.js';
import {BoardFootprintSchema} from '../src/model/board.js';
import {registerFootprints} from '../src/library/registry.js';
const trace=(id:string,width=.25):Trace=>({id,net:'A',layer:'F.Cu',width,points:[{x:5,y:10},{x:15,y:10}]});
it('applies total length across split traces, allowed layers and explicit neckdown rules',()=>{
 const b=emptyBoard();b.netClasses=[NetClassSchema.parse({name:'A',nets:['A'],traceWidth:.5,clearance:.2,viaSize:.6,viaDrill:.3,allowedLayers:['B.Cu'],maxLength:15,neckdown:{allowed:true,minWidth:.2,maxLength:15}})];
 b.traces=[trace('a'),{...trace('b'),points:[{x:15,y:10},{x:25,y:10}]}];
 expect(electricalChecks(b).map(i=>i.rule).sort()).toEqual(['allowed-layers','max-length','neckdown']);
 b.netClasses[0].allowedLayers=['F.Cu'];b.netClasses[0].maxLength=20;b.netClasses[0].neckdown!.maxLength=20;
 expect(electricalChecks(b)).toEqual([]);
 b.netClasses[0].neckdown!.allowed=false;expect(electricalChecks(b)[0].rule).toBe('neckdown');
});
it('rejects only generated copper implicated in DRC, preserving imported copper and input',()=>{
 const b=emptyBoard();b.traces=[{...trace('__routing_trace_0'),net:'B',points:[{x:10,y:5},{x:10,y:15}]}];
 const before=JSON.stringify(b),{id,...proposal}=trace('proposal');
 const r=validateRoutingProposal(b,RULE_SETS[0],[proposal],[]);
 expect(r.rejectedNets).toEqual(['A']);expect(r.traces).toEqual([]);expect(JSON.stringify(b)).toBe(before);
});
it('checks via copper clearance even when drill-to-drill clearance passes',()=>{
 const b=emptyBoard();b.vias=[{id:'a',net:'A',x:10,y:10,size:1,drill:.2},{id:'b',net:'B',x:11,y:10,size:1,drill:.2}];
 expect(runDrc(b,RULE_SETS[0]).items.some(i=>i.rule==='clearance'&&i.objectIds?.includes('a')&&i.objectIds?.includes('b'))).toBe(true);
});
it('does not route an SMD connection using a forbidden layer',()=>{
 registerFootprints([{id:'quality:pad',name:'pad',body:{w:1,h:1},height:1,description:'',pads:[{number:'1',x:0,y:0,w:1,h:1,shape:'rect',drill:0,npth:false}]}]);
 const b=emptyBoard();b.footprints=[5,15].map((x,i)=>BoardFootprintSchema.parse({id:`p${i}`,ref:`P${i}`,footprintId:'quality:pad',x,y:10,padNets:{'1':'A'}}));
 b.netClasses[0].allowedLayers=['B.Cu'];
 const r=autoroute(b,RULE_SETS[0],{noRetry:true,fineRetry:false,timeBudgetMs:1000});
 expect(r.routed).toBe(0);expect(r.traces).toEqual([]);
 b.netClasses[0].allowedLayers=['F.Cu'];expect(autoroute(b,RULE_SETS[0],{noRetry:true}).routed).toBe(1);
});
it('screens pair spacing/skew separately from connectivity and never claims SI verification',()=>{
 const b=emptyBoard();b.traces=[{...trace('p'),net:'DP'},{...trace('n'),net:'DN',points:[{x:5,y:10.45},{x:15,y:10.45}]}];
 b.differentialPairs=[{positive:'DP',negative:'DN',maxSkew:.1,gap:.2,tolerance:.01}];
 expect(electricalChecks(b).map(i=>i.rule)).toEqual(['differential-unverified']);
 b.traces[1].points[1].x=14;
 expect(electricalChecks(b).map(i=>i.rule)).toContain('differential-skew');
 expect(electricalChecks(b).map(i=>i.rule)).toContain('differential-gap');
});
it('warns when an explicit reference plane is absent or not adjacent',()=>{
 const b=emptyBoard();b.traces=[trace('a')];b.netClasses[0].referenceLayer='B.Cu';b.netClasses[0].referenceNet='GND';
 expect(electricalChecks(b,RULE_SETS[0]).some(i=>i.rule==='reference-plane')).toBe(true);
});
