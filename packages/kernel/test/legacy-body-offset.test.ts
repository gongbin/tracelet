import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createProject,parseProject,serializeProject,footprintBody,footprintPads,BoardFootprintSchema} from '../src/index.js';
const fixture=()=>JSON.parse(readFileSync(new URL('./fixtures/legacy-esp32-c6.json',import.meta.url),'utf8'));
it('restores the verified old ESP32-C6 courtyard offset without moving any pad or placed component',()=>{
 const p=createProject({name:'legacy'});p.library.footprints=[fixture()];
 p.board.footprints=[BoardFootprintSchema.parse({id:'u1',ref:'U1',footprintId:p.library.footprints[0].id,x:91,y:65.75})];
 const raw=JSON.stringify(p),pads=JSON.stringify(p.library.footprints[0].pads),before=p.board.footprints[0];
 const fixed=parseProject(raw),f=fixed.board.footprints[0];
 expect(f).toEqual(before);expect(JSON.stringify(fixed.library.footprints[0].pads)).toBe(pads);
 expect(fixed.library.footprints[0].body).toEqual({w:19.6,h:26.6,x:0,y:-2.75});
 expect(footprintBody(f).y).toBeCloseTo(49.7);
 expect(footprintPads(f,fixed.board).find(p=>p.number==='1')!.center).toEqual({x:82.25,y:57.49});
 expect(parseProject(serializeProject(fixed))).toEqual(fixed);
 expect(JSON.stringify(p)).toBe(raw);
});
it('does not override explicit offsets or a different footprint with the same name',()=>{
 const p=createProject({name:'custom'});p.library.footprints=[fixture()];p.library.footprints[0].body.y=1;
 expect(parseProject(p).library.footprints[0].body.y).toBe(1);
 delete p.library.footprints[0].body.y;p.library.footprints[0].pads[0].x+=.1;
 expect(parseProject(p).library.footprints[0].body.y).toBeUndefined();
});
