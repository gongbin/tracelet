import type { Model3d } from '@tracelet/kernel';
import { validateGlb } from './models.js';
import { MAX_MODEL_BYTES, MAX_STEP_BYTES, ModelImportError, glbDataUri, type ImportError } from './stepGeometry.js';

export type ImportStage = 'read' | 'engine' | 'convert';
export function convertStep(buffer: ArrayBuffer, signal: AbortSignal, progress: (stage: ImportStage) => void): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
    let worker: Worker;
    try { worker = new Worker(new URL('./step.worker.ts', import.meta.url), { type: 'module' }); }
    catch { reject(new ModelImportError('engine')); return; }
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); worker.onmessage = null; worker.onerror = null; worker.terminate(); };
    const fail = (error: Error) => { cleanup(); reject(error); };
    const abort = () => fail(new DOMException('Cancelled', 'AbortError'));
    const timer = setTimeout(() => fail(new ModelImportError('timeout')), 90_000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => fail(new ModelImportError('engine'));
    worker.onmessage = (event: MessageEvent<{ buffer?: ArrayBuffer; error?: ImportError; stage?: ImportStage }>) => {
      if (event.data.error) fail(new ModelImportError(event.data.error));
      else if (event.data.buffer) { cleanup(); resolve(event.data.buffer); }
      else if (event.data.stage) progress(event.data.stage);
    };
    worker.postMessage(buffer, [buffer]);
  });
}

export async function importModelFile(file: File, signal: AbortSignal, progress: (stage: ImportStage) => void): Promise<Model3d> {
  const step = /\.(stp|step)$/i.test(file.name);
  if (!step && !/\.glb$/i.test(file.name)) throw new ModelImportError('invalid');
  if (!file.size || file.size > (step ? MAX_STEP_BYTES : MAX_MODEL_BYTES)) throw new ModelImportError('size');
  progress('read');
  const input = await file.arrayBuffer(); signal.throwIfAborted();
  const hash = await crypto.subtle.digest('SHA-256', input); signal.throwIfAborted();
  const buffer = step ? await convertStep(input, signal, progress) : input;
  signal.throwIfAborted();
  try { validateGlb(buffer); } catch { throw new ModelImportError('invalid'); }
  return { name: file.name, source: glbDataUri(buffer), scale: 1000, offset: [0, 0, 0], rotation: [0, 0, 0], provenance: { kind: 'import', format: step ? 'step' : 'glb', sha256: Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join('') } };
}
