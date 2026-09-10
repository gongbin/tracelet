import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createDemoProject, parseProject, serializeProject, ProjectEditor, pcb, type Model3d, footprintBody, registerFootprints } from '@tracelet/kernel';
import { modelFor, needsModel, modelInstance, validateGlb, MODEL_CATALOG } from '../src/editors/three/models';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const cfg: Model3d = { name: 'R', source: 'catalog:R_0805_2012Metric', scale: 1000, rotation: [0,0,0], offset: [0,0,0] };
describe('3D models', () => {
 it('does not treat bare test pads as component bodies', () => {
  registerFootprints([{id:'test:bare-pad',name:'USB_TestPad_D0.5mm',body:{w:1,h:1},height:1,description:'',pads:[{number:'1',x:0,y:0,w:.5,h:.5,drill:0,npth:false,shape:'circle'}]}]);
  const f={...createDemoProject().board.footprints[0],ref:'TP1',footprintId:'test:bare-pad'};
  expect(needsModel(f)).toBe(false);
 });
 it('preserves model assignment in project export and supports undo', () => {
  const ed = new ProjectEditor(createDemoProject()), f = ed.project.board.footprints[0];
  ed.dispatch(pcb.setFootprintModel(f.footprintId, cfg));
  expect(modelFor(f, parseProject(serializeProject(ed.project)).board)).toEqual(cfg);
  ed.undo(); expect(ed.project.board.models3d?.[f.footprintId]).toBeUndefined();
 });
 it('converts metres/Y-up into millimetres/Z-up without changing source geometry', () => {
  const src = new THREE.Group(); const mesh = new THREE.Mesh(new THREE.BoxGeometry(.002,.001,.003),new THREE.MeshStandardMaterial()); mesh.position.y=.0005;src.add(mesh);
  const inst = modelInstance(src,cfg), box = new THREE.Box3().setFromObject(inst), size = box.getSize(new THREE.Vector3());
  expect(size.x).toBeCloseTo(2);expect(size.y).toBeCloseTo(3);expect(size.z).toBeCloseTo(1);expect(box.min.z).toBeCloseTo(0);
  expect(mesh.scale.x).toBe(1);
 });
 it('loads every bundled GLB and checks resistor dimensions and PCB offset removal', async () => {
  for(const [name, entry] of Object.entries(MODEL_CATALOG)) {
   const bytes=readFileSync(new URL('../public/models3d/kicad/'+entry.file,import.meta.url));const buffer=new Uint8Array(bytes).buffer;
   validateGlb(buffer);const gltf=await new GLTFLoader().parseAsync(buffer,'');
   const box=new THREE.Box3().setFromObject(modelInstance(gltf.scene,cfg));expect(box.isEmpty(),name).toBe(false);
   if(name==='R_0805_2012Metric'){expect(box.getSize(new THREE.Vector3()).x).toBeCloseTo(2,1);expect(box.min.z).toBeCloseTo(0,1);}
  }
 });
 it('rejects truncated and externally referenced model payloads', () => {
  expect(()=>validateGlb(new ArrayBuffer(0))).toThrow();
  const json=new TextEncoder().encode(JSON.stringify({asset:{version:'2.0'},buffers:[{uri:'https://example.com/mesh.bin'}]}));
  const b=new ArrayBuffer(20+json.length),v=new DataView(b);v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,b.byteLength,true);v.setUint32(12,json.length,true);v.setUint32(16,0x4e4f534a,true);new Uint8Array(b,20).set(json);
  expect(()=>validateGlb(b)).toThrow('单文件');
 });
});

describe('header origin alignment', () => {
 it('aligns a real 1x4 GLB with centered and pin-1 origins on both sides and at all right-angle rotations', async () => {
  const key='PinHeader_1x04_P2.54mm_Vertical';
  const bytes=readFileSync(new URL('../public/models3d/kicad/'+MODEL_CATALOG[key].file,import.meta.url));
  const gltf=await new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer,'');
  for(const center of [0,3.81]) {
   const id=`test:header-${center}:${key}`;
   registerFootprints([{id,name:key,body:{w:2.54,h:10.16,x:0,y:center},height:6,description:'',pads:[0,1,2,3].map(i=>({number:String(i+1),x:0,y:center-3.81+i*2.54,w:1.7,h:1.7,shape:'circle',drill:1,npth:false}))}]);
   const board=createDemoProject().board;
   for(const side of ['F','B'] as const)for(const rotation of [0,90,180,270]) {
    const f={...board.footprints[0],footprintId:id,x:33,y:6,rotation,side};
    const config=modelFor(f,board)!;
    expect(config.offset[0]).toBeCloseTo(0);
    expect(config.offset[1]).toBeCloseTo(3.81-center);
    const root=new THREE.Group();root.add(modelInstance(gltf.scene,config));
    root.position.set(f.x,-f.y,0);root.rotation.z=-rotation*Math.PI/180;
    if(side==='B')root.rotation.y=Math.PI;
    root.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(root), actual=box.getCenter(new THREE.Vector3());
    const expected=root.localToWorld(new THREE.Vector3(0,-center,0));
    expect(actual.x).toBeCloseTo(expected.x,1);expect(actual.y).toBeCloseTo(expected.y,1);
    const size=box.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(rotation%180===0?2.54:10.16,1);
    expect(size.y).toBeCloseTo(rotation%180===0?10.16:2.54,1);
   }
  }
 });
});

// Optional private-project regression: the source file stays outside the repository.
it.skipIf(!process.env.TRACELET_MODEL_PROJECT)('keeps J2/D1 and J3/U3 separate in the supplied project', async () => {
 const source=readFileSync(process.env.TRACELET_MODEL_PROJECT!, 'utf8');
 const project=parseProject(source), before=JSON.stringify(project);
 for(const [headerRef,neighborRef] of [['J2','D1'],['J3','U3']]) {
  const f=project.board.footprints.find(f=>f.ref===headerRef)!;
  const other=project.board.footprints.find(f=>f.ref===neighborRef)!;
  const config=modelFor(f,project.board)!;
  const entry=MODEL_CATALOG[config.source.slice('catalog:'.length)];
  const bytes=readFileSync(new URL('../public/models3d/kicad/'+entry.file,import.meta.url));
  const gltf=await new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer,'');
  const root=new THREE.Group();root.add(modelInstance(gltf.scene,config));
  root.position.set(f.x,-f.y,0);root.rotation.z=-f.rotation*Math.PI/180;
  if(f.side==='B')root.rotation.y=Math.PI;
  const box=new THREE.Box3().setFromObject(root), r=footprintBody(other);
  const gap=Math.max(box.min.x-(r.x+r.w),r.x-box.max.x,box.min.y+r.y,-r.y-r.h-box.max.y);
  expect(gap).toBeGreaterThan(0);
  console.log(`${headerRef}/${neighborRef}: projected body gap ${gap.toFixed(2)} mm`);
 }
 expect(JSON.stringify(project)).toBe(before);
 expect(readFileSync(process.env.TRACELET_MODEL_PROJECT!, 'utf8')).toBe(source);
});
