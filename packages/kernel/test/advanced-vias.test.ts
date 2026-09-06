import { expect, it } from 'vitest';
import { createProject, copperLayers } from '../src/index.js';
import { viaLayers, viaSpan, validateVia } from '../src/board/via.js';
import { estimateImpedance } from '../src/board/impedance.js';
const b=createProject({name:'HDI',copperCount:6}).board;
const v={id:'v',x:10,y:10,size:.6,drill:.3,net:'A'};
it('defaults to through-hole and restricts blind/buried connectivity',()=>{
 expect(viaLayers(b,v)).toEqual(copperLayers(6));
 expect(viaLayers(b,{...v,startLayer:'F.Cu',endLayer:'In1.Cu'})).toEqual(['F.Cu','In1.Cu']);
 expect(viaSpan(b,{...v,startLayer:'In2.Cu',endLayer:'In4.Cu'})).toEqual(['In2.Cu','In3.Cu','In4.Cu']);
});
it('removes backdrilled layers but preserves the stop layer',()=>{
 expect(viaLayers(b,{...v,backdrill:{side:'B',stopLayer:'In2.Cu',diameter:.8,stub:.1}})).toEqual(['F.Cu','In1.Cu','In2.Cu']);
 expect(validateVia(b,{...v,startLayer:'In4.Cu',endLayer:'In1.Cu'})).not.toEqual([]);
 expect(validateVia(b,{...v,backdrill:{side:'B',stopLayer:'In2.Cu',diameter:.2,stub:.1}})).not.toEqual([]);
});
it('estimates impedance with dimension checks and expected monotonic behavior',()=>{
 const p={kind:'microstrip' as const,width:.2,height:.15,thickness:.035,er:4.2};
 expect(estimateImpedance(p)).toBeGreaterThan(40);expect(estimateImpedance(p)).toBeLessThan(70);
 expect(estimateImpedance({...p,width:.3})).toBeLessThan(estimateImpedance(p));
 expect(()=>estimateImpedance({...p,height:0})).toThrow();
});

import { exportFabFiles, DEFAULT_STACKUP, computeRatsnest, registerFootprints, BoardFootprintSchema, runDrc, ruleSetOf } from '../src/index.js';
it('does not falsely connect a blind via to a bottom SMD pad',()=>{
 registerFootprints([{id:'adv:pad',name:'pad',body:{w:1,h:1},height:1,description:'',pads:[{number:'1',x:0,y:0,w:1,h:1,shape:'circle',drill:0,npth:false}]}]);
 const p=createProject({name:'span',copperCount:6});
 p.board.footprints=['F','B'].map((side,i)=>BoardFootprintSchema.parse({id:`p${i}`,ref:`P${i}`,footprintId:'adv:pad',x:10,y:10,side,padNets:{'1':'A'}}));
 p.board.vias=[{...v,startLayer:'F.Cu',endLayer:'In1.Cu'}];
 expect(computeRatsnest(p.board).unrouted).toBe(1);
 p.board.vias=[v];expect(computeRatsnest(p.board).unrouted).toBe(0);
 p.board.stackup={...DEFAULT_STACKUP,copperDepths:[0,.2,.5,1,1.3,1.6]};
 p.board.vias=[{...v,backdrill:{side:'B',stopLayer:'In2.Cu',diameter:.8,stub:.1}}];
 expect(computeRatsnest(p.board).unrouted).toBe(1);
 expect(runDrc(p.board,ruleSetOf(p)).items.some(x=>x.rule==='backdrill-clearance')).toBe(true);
});
it('separates blind drilling and calculates backdrill nominal depth',()=>{
 const p=createProject({name:'fab',copperCount:6});
 p.board.stackup={...DEFAULT_STACKUP,copperDepths:[0,.2,.5,1,1.3,1.6]};
 p.board.vias=[{...v,startLayer:'F.Cu',endLayer:'In1.Cu'},{...v,id:'back',x:20,backdrill:{side:'B',stopLayer:'In2.Cu',diameter:.8,stub:.1}}];
 const files=exportFabFiles(p);
 expect(files.find(f=>f.name.endsWith('PTH-L1-L2.drl'))?.content).toContain('X10.0000Y-10.0000');
 expect(files.find(f=>f.name==='fab-PTH.drl')?.content).not.toContain('X10.0000Y-10.0000');
 expect(files.find(f=>f.name.includes('BACKDRILL'))?.content).toContain('DEPTH_MM=1.0000');
 expect(files.find(f=>f.name.includes('In4_Cu'))?.content).not.toContain('X10000000Y-10000000D03');
});
it('matches the TI 50-ohm microstrip worked example',()=>{
 expect(estimateImpedance({kind:'microstrip',width:20*.0254,height:10*.0254,thickness:1.4*.0254,er:4})).toBeCloseTo(46.02,0);
});
