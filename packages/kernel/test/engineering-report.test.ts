import {expect,it} from 'vitest';
import {createProject,DEFAULT_STACKUP} from '../src/index.js';
import {engineeringReport} from '../src/board/engineeringReport.js';
it('does not award an empty board a perfect score',()=>{
 const r=engineeringReport(createProject({name:'Empty'}));
 expect(r.score).toBeNull();expect(r.blockers.length).toBeGreaterThan(0);
});
it('keeps absent SI constraints and impedance evidence unassessed',()=>{
 const p=createProject({name:'Unknown'}); const r=engineeringReport(p);
 expect(r.categories.find(c=>c.id==='signal')?.score).toBeNull();
 expect(r.categories.find(c=>c.id==='impedance')?.score).toBeNull();
});
it('keeps profile estimates separate from actual board impedance verification',()=>{
 const p=createProject({name:'Estimates'});p.board.stackup={...DEFAULT_STACKUP,impedanceProfiles:[{kind:'microstrip',width:.2,height:.15,thickness:.035,er:4.2,target:50}]};
 const r=engineeringReport(p);
 expect(r.impedance[0].ohms).toBeGreaterThan(50);
 expect(r.impedance[0].deviationPercent).toBeGreaterThan(0);
 expect(r.categories.find(c=>c.id==='impedance')?.score).toBeNull();
 expect(engineeringReport(p)).toEqual(r);
});

import {BoardFootprintSchema} from '../src/index.js';
it('keeps blocking DRC findings independent from other category scores',()=>{
 const p=createProject({name:'Blocking'});
 p.board.footprints=[BoardFootprintSchema.parse({id:'r',ref:'R1',footprintId:'fp:R_0603',x:10,y:10})];
 const r=engineeringReport(p,{ratsnest:{total:2,unrouted:1,lines:[]},drc:{errors:1,warnings:0,items:[{id:'bad',rule:'clearance',severity:'error',message:'Clearance',why:'too close',refs:['R1'],objectIds:['r']}]}});
 expect(r.blockers).toContain('drc');expect(r.blockers).toContain('unrouted');
 expect(r.categories.find(c=>c.id==='manufacturing')?.score).toBe(85);
 expect(r.categories.find(c=>c.id==='routing')?.score).toBe(50);
});

import {createDemoProject} from '../src/index.js';
it('marks absent schematic evidence as unassessed rather than ERC passed',()=>{
 const r=engineeringReport(createProject({name:'PCB only'}));
 expect(r.erc.assessed).toBe(false);expect(r.erc.report).toBeNull();
});
it('includes cross-sheet ERC evidence and treats ERC errors as blockers',()=>{
 const p=createDemoProject();
 const item={id:'erc_test',rule:'output-conflict',severity:'error' as const,message:'Conflict',why:'Outputs tied together',refs:['U1'],objectIds:['u1'],sheetId:p.schematic.sheets[0].id};
 const r=engineeringReport(p,{drc:{errors:0,warnings:0,items:[]},ratsnest:{total:1,unrouted:0,lines:[]},erc:{errors:1,warnings:0,items:[item]}});
 expect(r.erc.assessed).toBe(true);expect(r.erc.report?.items[0].sheetId).toBe(item.sheetId);expect(r.blockers).toContain('erc');
});
