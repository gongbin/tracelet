// @vitest-environment node
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { cadMeshesToGlb, MAX_TRIANGLES, type CadMesh } from '../src/editors/three/stepGeometry';
import { modelInstance, validateGlb, disposeObject } from '../src/editors/three/models';
const require = createRequire(import.meta.url);
const init = require('occt-import-js');

it('converts an actual STEP solid to standalone GLB with origin, size and orientation preserved', async () => {
 const path = require.resolve('occt-import-js/test/testfiles/simple-basic-cube/cube.stp');
 const occt = await init();
 const result = occt.ReadStepFile(readFileSync(path), {linearUnit:'millimeter',linearDeflectionType:'absolute_value',linearDeflection:.025,angularDeflection:.35});
 expect(result.success).toBe(true);
 const buffer = cadMeshesToGlb(result.meshes);validateGlb(buffer);
 const gltf = await new GLTFLoader().parseAsync(buffer,'');
 const instance = modelInstance(gltf.scene,{name:'cube',source:'catalog:test',scale:1000,offset:[0,0,0],rotation:[0,0,0]});
 const actual = new THREE.Box3().setFromObject(instance), expected = new THREE.Box3();
 for (const m of result.meshes) for(let i=0;i<m.attributes.position.array.length;i+=3) expected.expandByPoint(new THREE.Vector3(...m.attributes.position.array.slice(i,i+3) as [number,number,number]));
 for(const edge of ['min','max'] as const) for(const axis of ['x','y','z'] as const) expect(actual[edge][axis]).toBeCloseTo(expected[edge][axis],3);
 expect(actual.getSize(new THREE.Vector3()).length()).toBeGreaterThan(1);
 disposeObject(instance);disposeObject(gltf.scene);
});

it('retains per-face colors, normals, and non-centred geometry without duplicate surfaces', async () => {
 const mesh:CadMesh={name:'two faces',color:[.2,.2,.2],brep_faces:[{first:1,last:1,color:[1,0,0]}],attributes:{position:{array:[1,2,3,4,2,3,1,5,3,4,5,3]},normal:{array:[0,0,1,0,0,1,0,0,1,0,0,1]}},index:{array:[0,1,2,1,3,2]}};
 const buffer=cadMeshesToGlb([mesh]);validateGlb(buffer);
 const n=new DataView(buffer).getUint32(12,true),json=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,n)));
 expect(json.meshes[0].primitives).toHaveLength(2);
 expect(json.accessors.filter((a:any)=>a.type==='SCALAR').reduce((n:number,a:any)=>n+a.count,0)).toBe(6);
 expect(json.materials.map((m:any)=>m.pbrMetallicRoughness.baseColorFactor)).toEqual([[.2,.2,.2,1],[1,0,0,1]]);
 expect(json.accessors[0].min).toEqual([expect.closeTo(.001,6),expect.closeTo(.003,6),expect.closeTo(-.005,6)]);
});

it('rejects empty, invalid or overly complex conversion results',()=>{
 const mesh:CadMesh={name:'bad',attributes:{position:{array:[0,0,0,1,0,0,0,1,0]}},index:{array:[0,1,99]}};
 expect(()=>cadMeshesToGlb([])).toThrow('invalid');expect(()=>cadMeshesToGlb([mesh])).toThrow('invalid');
 mesh.index.array=[0,1,2];mesh.attributes.position.array[0]=NaN;expect(()=>cadMeshesToGlb([mesh])).toThrow('invalid');
 mesh.index.array=new Array((MAX_TRIANGLES+1)*3).fill(0);expect(()=>cadMeshesToGlb([mesh])).toThrow('complex');
});

it.skipIf(!process.env.TRACELET_STEP_MODEL)('converts the supplied USB-C STEP and preserves measured geometry',async()=>{
 const occt=await init();const r=occt.ReadStepFile(readFileSync(process.env.TRACELET_STEP_MODEL!),{linearUnit:'millimeter',linearDeflectionType:'absolute_value',linearDeflection:.025,angularDeflection:.35});
 expect(r.success).toBe(true);const b=cadMeshesToGlb(r.meshes);validateGlb(b);const g=await new GLTFLoader().parseAsync(b,'');
 const inst=modelInstance(g.scene,{name:'USB-C',source:'catalog:test',scale:1000,offset:[0,0,0],rotation:[0,0,0]});
 const bounds=new THREE.Box3().setFromObject(inst),size=bounds.getSize(new THREE.Vector3());
 console.log({bytes:b.byteLength,meshes:r.meshes.length,size:size.toArray(),min:bounds.min.toArray()});
 expect(size.x).toBeGreaterThan(8);expect(size.x).toBeLessThan(12);expect(size.z).toBeLessThan(10);
 disposeObject(inst);disposeObject(g.scene);
});
