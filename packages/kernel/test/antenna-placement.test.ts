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
