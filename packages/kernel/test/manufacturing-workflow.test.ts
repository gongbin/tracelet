import {describe,it,expect} from 'vitest';
import {createParser} from '@tracespace/parser';
import {createDemoProject,createProject,buildBom,exportPickAndPlaceCsv,exportFabFiles,manufacturingBoard,validateAssembly,tidySchematic,electricalIdentity,assertElectricalIdentity,planPanel,exportPanelFiles,ProjectSchema,importKicadPcb} from '../src/index.js';
describe('manufacturing workflow',()=>{
  it('uses one origin and Y-up coordinates, normalizes bottom angles, excludes DNP consistently',()=>{
    const p=createDemoProject(),f=p.board.footprints.find(f=>f.componentId)!;
    p.settings.manufacturing={origin:{x:10,y:20},bottomRotation:'bottom-view',includeDnp:false};f.x=13;f.y=25;f.side='B';f.rotation=450;
    expect(exportPickAndPlaceCsv(p)).toContain(`${f.ref},3.000,-5.000,B,90`);
    expect(manufacturingBoard(p).footprints.find(x=>x.id===f.id)).toMatchObject({x:3,y:5});
    const c=p.schematic.sheets.flatMap(s=>s.components).find(c=>c.id===f.componentId)!;c.props.DNP='yes';
    expect(buildBom(p).flatMap(r=>r.refs)).not.toContain(f.ref);
    expect(exportPickAndPlaceCsv(p).split('\n').some(l=>l.startsWith(`${f.ref},`))).toBe(false);
    p.settings.manufacturing.includeDnp=true;
    expect(buildBom(p).flatMap(r=>r.refs)).toContain(f.ref);
  });
  it('separates part numbers and refuses ambiguous/missing placement identities',()=>{
    const p=createDemoProject(),s=p.schematic.sheets[0],c=s.components.find(c=>c.ref.startsWith('C'))!;
    s.components.push({...c,id:'second',ref:'C99',props:{mpn:'different'}});
    expect(buildBom(p).filter(r=>r.value===c.value).length).toBe(2);
    expect(validateAssembly(p).some(i=>i.code==='missing-placement'&&i.refs.includes('C99'))).toBe(true);
    expect(()=>exportFabFiles(p)).toThrow('missing-placement');
    expect(()=>exportFabFiles(p,{bom:false,pnp:false})).not.toThrow();
  });
  it('keeps electrical identity during cleanup and rejects a changed net',()=>{
    const p=createDemoProject(),before=JSON.stringify(p.schematic);
    const result=tidySchematic(p.schematic,p.schematic.sheets[0].id);
    expect(electricalIdentity(result.schematic)).toBe(electricalIdentity(p.schematic));
    expect(JSON.stringify(p.schematic)).toBe(before);
    result.schematic.sheets[0].components[0].ref='BROKEN';
    expect(()=>assertElectricalIdentity(p.schematic,result.schematic)).toThrow();
  });
  it('exports independently parsed panel files, keeps source unchanged and drills tooling',()=>{
    const p=createDemoProject();
    const f=p.board.footprints.find(f=>f.ref.startsWith('C'))!;f.x=25;f.y=15;
    p.board.footprints=[f];p.board.traces=[];p.board.vias=[];p.board.zones=[];
    p.schematic.sheets[0].components=p.schematic.sheets[0].components.filter(c=>c.id===f.componentId);
    const before=JSON.stringify(p);
    const options={columns:2,rows:2,gap:5,rail:5,tabWidth:3};
    const plan=planPanel(p.board,options);expect(plan.errors).toEqual([]);expect(plan.tabs).toHaveLength(8);
    const files=exportPanelFiles(p,options);
    for(const f of files.filter(f=>f.kind==='gerber'||f.kind==='drill')){
      const parser=createParser();parser.feed(f.content);const tree=parser.results();expect(tree.done,f.name).toBe(true);
      expect(tree.children.filter(n=>n.type==='unimplemented'&&!/^%T[FAOD]/.test((n as {value:string}).value)),f.name).toEqual([]);
    }
    expect(files.find(f=>f.name.endsWith('-NPTH.drl'))!.content).toContain('C1.500');
    const csv=files.find(f=>f.kind==='pnp')!.content;expect(csv).toContain(`B1_${f.ref}`);expect(csv).toContain(`B4_${f.ref}`);
    const copper=files.find(f=>f.name.endsWith('.gtl'))!.content;
    const defs=[...copper.matchAll(/%ADD(\d+)/g)].map(m=>m[1]);expect(new Set(defs).size).toBe(defs.length);
    expect([...copper.matchAll(/D03\*/g)]).toHaveLength(4*2+3);
    expect(JSON.stringify(p)).toBe(before);
  });
  it('rejects unsupported geometry/parameters instead of guessing tabs',()=>{
    const p=createProject({name:'triangle'});p.board.outline=[{x:0,y:0},{x:20,y:20},{x:0,y:40}];
    expect(planPanel(p.board,{columns:1,rows:1,gap:5,rail:5,tabWidth:3}).errors.length).toBeGreaterThan(0);
    expect(()=>planPanel(p.board,{columns:NaN,rows:1,gap:5,rail:5,tabWidth:3})).toThrow();
  });
  it('retains physical outline, source and model offsets on import/serialization',()=>{
    const result=importKicadPcb('(kicad_pcb (layers (0 "F.Cu" signal) (31 "B.Cu" signal)) (footprint "USB:TypeC" (layer "F.Cu") (at 10 10) (property "Reference" "J1") (fp_rect (start -5 -4) (end 5 4) (layer "F.CrtYd")) (fp_rect (start -4 -3) (end 4 3) (layer "F.Fab")) (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu")) (model "usb.step" (offset (xyz 1 2 3)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 90)))))');
    const p=createProject({name:'trust'});p.library.footprints=result.footprints;
    const round=ProjectSchema.parse(p).library.footprints[0];expect(round.physicalBody).toMatchObject({w:8,h:6});expect(round.modelPlacement?.offset).toEqual([1,2,3]);expect(round.provenance?.verified).toBe(false);
  });
});
