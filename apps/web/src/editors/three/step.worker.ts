import init from 'occt-import-js';
import wasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url';
import { cadMeshesToGlb, ModelImportError, MAX_STEP_BYTES } from './stepGeometry.js';

self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const buffer = event.data;
    if (!buffer.byteLength || buffer.byteLength > MAX_STEP_BYTES) throw new ModelImportError('size');
    // ISO 10303-21 signature avoids sending arbitrary formats to the geometry kernel.
    if (!new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 1024))).includes('ISO-10303-21;')) throw new ModelImportError('invalid');
    self.postMessage({ stage: 'engine' });
    const occt = await init({ locateFile: () => wasmUrl, print: () => {}, printErr: () => {} });
    self.postMessage({ stage: 'convert' });
    const result = occt.ReadStepFile(new Uint8Array(buffer), { linearUnit: 'millimeter', linearDeflectionType: 'absolute_value', linearDeflection: .025, angularDeflection: .35 });
    if (!result.success) throw new ModelImportError('invalid');
    const glb = cadMeshesToGlb(result.meshes);
    self.postMessage({ buffer: glb }, { transfer: [glb] });
  } catch (error) {
    self.postMessage({ error: error instanceof ModelImportError ? error.code : 'engine' });
  }
};
