import { afterEach, expect, it, vi } from 'vitest';
import { File } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { convertStep, importModelFile } from '../src/editors/three/importModel';
import { MAX_STEP_BYTES } from '../src/editors/three/stepGeometry';
class WorkerMock {
 static last: WorkerMock;
 onmessage?: (e:{data:unknown})=>void;
 onerror?: ()=>void;
 terminate=vi.fn();postMessage=vi.fn();
 constructor(){WorkerMock.last=this;}
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it('keeps standalone GLB imports portable with a reproducible source fingerprint',async()=>{
 vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('Worker',WorkerMock);
 const bytes=readFileSync('public/models3d/kicad/R_0402.glb'),file=new File([bytes],'part.glb');
 const model=await importModelFile(file as unknown as globalThis.File,new AbortController().signal,()=>{});
 expect(model.source.startsWith('data:model/gltf-binary;base64,')).toBe(true);expect(model.provenance).toMatchObject({kind:'import',format:'glb',sha256:expect.stringMatching(/^[a-f0-9]{64}$/)});
 const again=await importModelFile(file as unknown as globalThis.File,new AbortController().signal,()=>{});expect(again).toEqual(model);
});
it('rejects oversized and unsupported input before reading its contents',async()=>{
 const arrayBuffer=vi.fn();for(const file of [{name:'large.step',size:MAX_STEP_BYTES+1,arrayBuffer},{name:'unknown.zip',size:1,arrayBuffer}]) await expect(importModelFile(file as unknown as globalThis.File,new AbortController().signal,()=>{})).rejects.toThrow();
 expect(arrayBuffer).not.toHaveBeenCalled();
});
it('terminates conversion immediately on cancellation and ignores late worker messages',async()=>{
 vi.stubGlobal('Worker',WorkerMock);const abort=new AbortController(),progress=vi.fn();
 const promise=convertStep(new ArrayBuffer(3),abort.signal,progress),error=expect(promise).rejects.toMatchObject({name:'AbortError'});
 const worker=WorkerMock.last;abort.abort();await error;expect(worker.terminate).toHaveBeenCalledOnce();
});
it('stops a stalled conversion and releases its worker on timeout',async()=>{
 vi.useFakeTimers();vi.stubGlobal('Worker',WorkerMock);
 const promise=convertStep(new ArrayBuffer(3),new AbortController().signal,()=>{}),error=expect(promise).rejects.toMatchObject({code:'timeout'});
 await vi.advanceTimersByTimeAsync(90_000);await error;expect(WorkerMock.last.terminate).toHaveBeenCalledOnce();
});
it('releases the worker after successful conversion or startup failure',async()=>{
 vi.stubGlobal('Worker',WorkerMock);const progress=vi.fn();const promise=convertStep(new ArrayBuffer(3),new AbortController().signal,progress),worker=WorkerMock.last;
 worker.onmessage!({data:{stage:'convert'}});const buffer=new ArrayBuffer(4);worker.onmessage!({data:{buffer}});expect(await promise).toBe(buffer);expect(worker.terminate).toHaveBeenCalledOnce();expect(progress).toHaveBeenCalledWith('convert');
 vi.stubGlobal('Worker',class{constructor(){throw new Error('blocked');}});await expect(convertStep(new ArrayBuffer(3),new AbortController().signal,progress)).rejects.toMatchObject({code:'engine'});
});
