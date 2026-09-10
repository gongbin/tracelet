import {describe,it,expect} from 'vitest';
import {importKicadPcb,createProject,emptyBoard,BoardFootprintSchema,registerFootprints,RULE_SETS,routeTarget,route45,InteractiveRouter,manualCopperIssues,computeRatsnest,ProjectEditor,pcb,lib,holeFootprint,castellatedFootprint,snapCastellatedRow,runDrc,exportFabFiles,exportExcellon,planPanel,exportPanelFiles,allPads,ProjectSchema,checkPlacement} from '../src/index.js';
const rules=RULE_SETS[0],request={net:'SIG',layer:'F.Cu' as const,width:.25};
const padDef={id:'test:interactive',name:'Test pad',body:{w:1,h:1},height:1,description:'',pads:[{number:'1',x:0,y:0,w:.8,h:.8,shape:'circle' as const,drill:0,npth:false}]};
registerFootprints([padDef]);
function fixture(){const b=emptyBoard();b.footprints=[{id:'a',x:5.07,y:10.03},{id:'b',x:25.07,y:20.03}].map((f,i)=>BoardFootprintSchema.parse({...f,ref:`TP${i+1}`,footprintId:padDef.id,padNets:{'1':'SIG'}}));return b;}

describe('interactive route geometry and validation',()=>{
 it('snaps to exact off-grid pads, same-layer copper branches and vias, never to NPTH or an opposite-side SMD',()=>{
  const b=fixture();b.footprints[1].side='B';
  expect(routeTarget(b,{x:5.3,y:10.1},'F.Cu',.5)?.point).toEqual({x:5.07,y:10.03});
  expect(routeTarget(b,{x:25.07,y:20.03},'F.Cu',.5)).toBeNull();
  expect(routeTarget(b,{x:5.07,y:10.03},'F.Cu',.5,'GND')).toBeNull();
  b.traces=[{id:'t',net:'SIG',layer:'F.Cu',width:.25,points:[{x:10,y:5},{x:20,y:5}]}];
  expect(routeTarget(b,{x:13.07,y:5.2},'F.Cu',.5)).toMatchObject({kind:'trace',point:{x:13.07,y:5}});
  const hole=holeFootprint(3.2);registerFootprints([hole]);b.footprints.push(BoardFootprintSchema.parse({id:'h',ref:'H1',footprintId:hole.id,x:30,y:10,padNets:{'1':'SIG'}}));
  expect(routeTarget(b,{x:30,y:10},'F.Cu',1)).toBeNull();
 });
 it('both 45-degree postures preserve exact endpoints and produce genuinely connected copper',()=>{
  const b=fixture(),a=b.footprints[0],end=b.footprints[1];
  for(const flip of [false,true]){
   const points=route45(a,end,flip);expect(points.at(-1)).toEqual(end);
   points.slice(1).forEach((p,i)=>{const dx=Math.abs(p.x-points[i].x),dy=Math.abs(p.y-points[i].y);expect(Math.min(dx,dy,Math.abs(dx-dy))).toBeLessThan(1e-7);});
   expect(manualCopperIssues(b,rules,[{...request,points}])).toEqual([]);
   expect(computeRatsnest({...b,traces:[{...request,points,id:'new'}]},rules).unrouted).toBe(0);
  }
 });
 it('offers a clear detour around a foreign trace and never commits the colliding direct path',()=>{
  const b=fixture();b.traces=[{id:'barrier',net:'GND',layer:'F.Cu',width:.4,points:[{x:15,y:8},{x:15,y:18}]}];
  const r=new InteractiveRouter(b,rules),a={x:5,y:12},end={x:25,y:12};
  expect(r.suggest(a,end,request,false,false).reason).toBe('clearance');
  const suggestion=r.suggest(a,end,request);expect(suggestion.reason).toBeNull();expect(suggestion.detour).toBe(true);
  expect(manualCopperIssues(b,rules,[{...request,points:[a,end]}])).toContain('clearance');
  expect(manualCopperIssues(b,rules,[{...request,points:suggestion.points}])).toEqual([]);
 });
 it('respects net-class gaps, heavy copper, layer rules and concave edges',()=>{
  const b=fixture();b.netClasses.unshift({name:'wide',nets:['GND'],traceWidth:.3,viaSize:.6,viaDrill:.3,clearance:1});
  b.traces=[{id:'gnd',net:'GND',layer:'F.Cu',width:.3,points:[{x:10,y:5},{x:20,y:5}]}];
  expect(new InteractiveRouter(b,rules).check([{x:10,y:5.6},{x:20,y:5.6}],request)).toBe('clearance');
  b.netClasses[1].allowedLayers=['B.Cu'];expect(new InteractiveRouter(b,rules).check([{x:3,y:3},{x:4,y:4}],request)).toBe('layer');
  b.netClasses[1].allowedLayers=undefined;b.stackup={material:'FR-4',copperWeight:2,innerCopperWeight:.5,finish:'ENIG',maskColor:'绿',silkColor:'白',impedance:false,viaTenting:true};
  expect(new InteractiveRouter(b,rules).check([{x:3,y:3},{x:4,y:4}],{...request,width:.15})).toBe('width');
  b.outline=[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:12,y:20},{x:12,y:8},{x:8,y:8},{x:8,y:20},{x:0,y:20}];
  expect(new InteractiveRouter(b,rules).check([{x:5,y:12},{x:15,y:12}],request)).toBe('board-edge');
 });
 it('validates via copper on every spanned layer and ignores unrelated existing DRC errors',()=>{
  const b=fixture();b.traces=[{id:'back',net:'GND',layer:'B.Cu',width:.5,points:[{x:10,y:10},{x:20,y:10}]}];
  expect(manualCopperIssues(b,rules,[],[{x:15,y:10,net:'SIG',size:.6,drill:.3}])).toContain('clearance');
  b.footprints.push({...b.footprints[0],id:'unrelated',ref:'TP99',x:-5});
  expect(manualCopperIssues(b,rules,[{...request,points:route45(b.footprints[0],b.footprints[1])}])).toEqual([]);
 });
});

describe('manufacturable hole tools',()=>{
 it('preserves PTH networks, isolates NPTH and separates drill exports through undo and reload',()=>{
  const p=createProject({name:'Hole tools'}),e=new ProjectEditor(p);
  const plated=holeFootprint(3.2,true,.5),plain=holeFootprint(2.2,false);registerFootprints([plated,plain]);
  e.begin('holes');e.dispatch(lib.addLibraryItems({footprints:[plated,plain]}));
  for(const [i,def] of [plated,plain].entries()){const a=pcb.addBoardFootprint(e.project,{footprintId:def.id,x:10+i*15,y:10,padNets:{'1':'GND'}});e.dispatch(a.command);}
  e.commit();const restored=ProjectSchema.parse(e.project);
  expect(allPads(restored.board).map(p=>p.net)).toEqual(['GND','']);
  expect(exportExcellon(restored.board,true)).toContain('C3.200');expect(exportExcellon(restored.board,true)).not.toContain('C2.200');
  expect(exportExcellon(restored.board,false)).toContain('C2.200');
  e.undo();expect(e.project.board.footprints).toHaveLength(0);e.redo();expect(e.project.board.footprints).toHaveLength(2);
 });
 it('snaps half-hole arrays onto straight edges, checks displaced arrays and exports process instructions',()=>{
  const p=createProject({name:'Half holes'}),def=castellatedFootprint(.8,.4,4,2.54);registerFootprints([def]);p.library.footprints.push(def);
  const snap=snapCastellatedRow(p.board,{x:20,y:.2},def.body.w,1)!;expect(snap.y).toBe(0);
  const fp=BoardFootprintSchema.parse({id:'cast',ref:'CAST1',footprintId:def.id,...snap,padNets:{'1':'SIG'}});p.board.footprints=[fp];
  expect(runDrc(p.board,rules).items.filter(i=>i.rule==='castellated-edge'||i.rule==='copper-to-edge')).toEqual([]);
  expect(checkPlacement(p.board,rules).filter(i=>i.rule==='outside')).toEqual([]);
  const pad=allPads(p.board)[0];expect(new InteractiveRouter(p.board,rules).check([{x:pad.center.x,y:5},pad.center],request)).toBeNull();
  expect(new InteractiveRouter(p.board,rules).check([{x:5,y:.1},{x:10,y:.1}],request)).toBe('board-edge');
  p.settings.manufacturing={origin:{x:10,y:5},bottomRotation:'top-view',includeDnp:false};
  const files=exportFabFiles(p,{bom:false,pnp:false});
  const manifest=JSON.parse(files.find(f=>f.name.endsWith('castellated-holes.json'))!.content);expect(manifest.holes[0].x).toBeCloseTo(pad.center.x-10);expect(manifest.holes[0].y).toBe(5);
  fp.y=1;expect(runDrc(p.board,rules).items.some(i=>i.rule==='castellated-edge')).toBe(true);
  fp.y=-1;expect(checkPlacement(p.board,rules).some(i=>i.rule==='outside')).toBe(true);
  expect(snapCastellatedRow(p.board,{x:20,y:15},def.body.w,1)).toBeNull();
  expect(()=>castellatedFootprint(.8,.4,4,1)).toThrow();
 });
 it('uses configurable mouse bite geometry in preview, drill files and manifest',()=>{
  const p=createProject({name:'Panel'}),options={columns:2,rows:1,gap:5,rail:5,tabWidth:4,mouseBiteDrill:.6,mouseBitePitch:1};
  const plan=planPanel(p.board,options,rules);expect(plan.errors).toEqual([]);expect(plan.holes.length).toBeGreaterThan(0);expect(plan.holes[1].x-plan.holes[0].x).toBe(1);
  const files=exportPanelFiles(p,options);expect(files.find(f=>f.name.endsWith('NPTH.drl'))!.content).toContain('C0.600');
  expect(JSON.parse(files.find(f=>f.name==='panel-manifest.json')!.content).options.mouseBitePitch).toBe(1);
  expect(()=>planPanel(p.board,{...options,mouseBitePitch:.7})).toThrow();
 });
 it('protects both imported locks and user fixed placements from move/rotate/flip commands',()=>{
  const p=createProject({name:'Locks'});p.board=fixture();p.board.footprints[0].locked=true;p.board.footprints[1].placement={fixed:true};
  const e=new ProjectEditor(p),before=structuredClone(p.board.footprints);
  for(const f of before){e.dispatch(pcb.moveFootprint(f.id,{x:40,y:20}));e.dispatch(pcb.rotateFootprint(f.id));e.dispatch(pcb.flipFootprint(f.id));}
  e.dispatch(pcb.moveFootprints(before.map(f=>({id:f.id,x:42,y:22}))));expect(e.project.board.footprints).toEqual(before);
 });
});

// Modern files can put a quoted net name directly on every copper object.
it.each([true,false])('retains KiCad PCB net identity for direct-name format=%s',modern=>{
 const net=modern?'(net "/SIGNAL")':'(net 1)',padNet=modern?net:'(net 1 "/SIGNAL")';
 const {board}=importKicadPcb(`(kicad_pcb ${modern?'':'(net 1 "/SIGNAL")'}
 (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
 (footprint "TP" (layer "F.Cu") (at 5 5) (property "Reference" "TP1")
   (pad "1" smd circle (at 0 0) (size 1 1) (layers "F.Cu") ${padNet}))
 (segment (start 5 5) (end 10 5) (width .25) (layer "F.Cu") ${net})
 (via (at 10 5) (size .6) (drill .3) (layers "F.Cu" "B.Cu") ${net})
 (zone ${net} (layer "B.Cu") (polygon (pts (xy 1 1) (xy 15 1) (xy 15 15) (xy 1 15)))))`);
 expect(board.footprints[0].padNets['1']).toBe('SIGNAL');
 expect(board.traces[0].net).toBe('SIGNAL');expect(board.vias[0].net).toBe('SIGNAL');expect(board.zones[0].net).toBe('SIGNAL');
});
