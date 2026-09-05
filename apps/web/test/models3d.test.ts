import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createDemoProject, parseProject, serializeProject, ProjectEditor, pcb, type Model3d, registerFootprints } from '@tracelet/kernel';
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
