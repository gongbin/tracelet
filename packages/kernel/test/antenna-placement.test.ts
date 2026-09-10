import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createProject,parseProject,BoardFootprintSchema,registerProjectLibrary,optimizePlacement,applyPlacement,footprintPads,RULE_SETS} from '../src/index.js';
import {antennaGeometry,placementBodyInside,antennaAreasClear} from '../src/board/antennaPlacement.js';
import {suggestRoutingMoves} from '../src/board/routingPlacement.js';
const fixture=()=>{
 const p=createProject({name:'antenna'});
 p.library.footprints=[JSON.parse(readFileSync(new URL('./fixtures/legacy-esp32-c6.json',import.meta.url),'utf8'))];
 p.board.outline=[{x:50,y:50},{x:82,y:50},{x:82,y:56.3},{x:100,y:56.3},{x:100,y:50},{x:132,y:50},{x:132,y:108},{x:50,y:108}];
 p.board.footprints=[BoardFootprintSchema.parse({id:'u1',ref:'U1',footprintId:p.library.footprints[0].id,x:91,y:65.75,padNets:{'1':'GND','2':'+3V3'}}),BoardFootprintSchema.parse({id:'r1',ref:'R1',footprintId:'fp:R_0603',x:140,y:85})];
 return parseProject(p);
};
it('preserves U1 at its notch during initial placement with all routing cleared',()=>{
 const p=fixture();registerProjectLibrary(p.library);const before=JSON.stringify(p.board),f=p.board.footprints[0];
 expect(antennaGeometry(f,p.board)).not.toBeNull();expect(placementBodyInside(f,p.board)).toBe(true);
 const pads=footprintPads(f,p.board);
 const r=optimizePlacement(p.board,RULE_SETS[0],{mode:'initial',iterations:10000,seed:1,verifyRouting:false});
 expect(r.rejected).toBeUndefined();expect(r.moves.some(m=>m.id==='u1')).toBe(false);
 const after=applyPlacement(p.board,r.moves);expect(after.footprints[0]).toEqual(f);expect(footprintPads(after.footprints[0],after)).toEqual(pads);
 expect(r.after.outside).toBe(0);expect(antennaAreasClear(after)).toBe(true);expect(JSON.stringify(p.board)).toBe(before);
 expect(suggestRoutingMoves(p.board,RULE_SETS[0],['+3V3','GND']).some(m=>m.id==='u1')).toBe(false);
});
it('does not waive support/pad containment or accept another part in the antenna region',()=>{
 const p=fixture(),f=p.board.footprints[0];registerProjectLibrary(p.library);
 expect(placementBodyInside({...f,y:53},p.board)).toBe(false);
 const ant=antennaGeometry(f,p.board)!;
 p.board.footprints[1]={...p.board.footprints[1],x:ant.area.x+ant.area.w/2,y:ant.area.y+ant.area.h/2};
 expect(antennaAreasClear(p.board)).toBe(false);
});
it('repairs an initially out-of-board antenna without rotating it or moving its pads independently',()=>{
 const p=fixture();p.board.footprints[0].y=53;
 const before=structuredClone(p.board),f=p.board.footprints[0],pads=footprintPads(f,p.board);
 expect(placementBodyInside(f,p.board)).toBe(false);
 const r=optimizePlacement(p.board,RULE_SETS[0],{mode:'initial',iterations:300,seed:1,verifyRouting:false});
 expect(r.rejected).toBeUndefined();
 const after=applyPlacement(p.board,r.moves),moved=after.footprints[0];
 expect(moved.rotation).toBe(f.rotation);expect(moved.y).toBeGreaterThan(f.y);
 expect(placementBodyInside(moved,after)).toBe(true);expect(antennaAreasClear(after)).toBe(true);
 footprintPads(moved,after).forEach((pad,i)=>{
  expect(pad.center.x-pads[i].center.x).toBeCloseTo(moved.x-f.x);
  expect(pad.center.y-pads[i].center.y).toBeCloseTo(moved.y-f.y);
  expect(pad.net).toBe(pads[i].net);
 });
 expect(p.board).toEqual(before);
 // The corrected RF module is an anchor on subsequent initializations.
 const again=optimizePlacement(after,RULE_SETS[0],{mode:'initial',iterations:300,verifyRouting:false});
 expect(again.rejected).toBeUndefined();expect(again.moves.some(m=>m.id===f.id)).toBe(false);
});
it('does not repair locked or wired RF anchors and identifies the outside component',()=>{
 for(const kind of ['locked','wired','incremental']){
  const p=fixture();p.board.footprints[0].y=53;
  if(kind==='locked')p.board.footprints[0].locked=true;
  if(kind==='wired'){
   const pad=footprintPads(p.board.footprints[0],p.board)[0];
   p.board.traces.push({id:'wire',net:pad.net,layer:'F.Cu',width:0.25,points:[pad.center,{x:pad.center.x+2,y:pad.center.y}]});
  }
  const r=optimizePlacement(p.board,RULE_SETS[0],{mode:kind==='incremental'?'incremental':'initial',iterations:0,verifyRouting:false});
  expect(r.moves).toEqual([]);expect(r.rejected).toContain('U1: outside');
 }
});
