/** OCCT returns millimetres / Z-up. GLB is metres / Y-up. Keep the STEP origin. */
export interface CadMesh {
  name: string;
  color?: number[];
  brep_faces?: { first: number; last: number; color?: number[] }[];
  attributes: { position: { array: number[] }; normal?: { array: number[] } };
  index: { array: number[] };
}
export const MAX_MODEL_BYTES = 8 * 1024 * 1024;
export const MAX_STEP_BYTES = 20 * 1024 * 1024;
export const MAX_TRIANGLES = 200_000;
export type ImportError = 'size' | 'invalid' | 'complex' | 'timeout' | 'engine';
export class ModelImportError extends Error {
  constructor(public code: ImportError) { super(code); }
}

/** Small, deterministic GLB writer: no FileReader, DOM or texture dependencies in the worker. */
export function cadMeshesToGlb(meshes: CadMesh[]): ArrayBuffer {
  if (!meshes.length) throw new ModelImportError('invalid');
  if (meshes.reduce((n, m) => n + m.index.array.length / 3, 0) > MAX_TRIANGLES) throw new ModelImportError('complex');
  const chunks: Uint8Array[] = [], views: object[] = [], accessors: object[] = [], materials: object[] = [];
  const nodes: object[] = [], outputMeshes: object[] = [];
  let byteLength = 0;
  const append = (data: Float32Array | Uint32Array, target: number) => {
    const index = views.length;
    views.push({ buffer: 0, byteOffset: byteLength, byteLength: data.byteLength, target });
    chunks.push(new Uint8Array(data.buffer)); byteLength += data.byteLength;
    if (byteLength > MAX_MODEL_BYTES) throw new ModelImportError('complex');
    return index;
  };
  const materialIds = new Map<string, number>();
  const material = (color?: number[]) => {
    const rgb = (color ?? [.65, .67, .7]).slice(0, 3).map(c => Math.max(0, Math.min(1, c)));
    if (rgb.length !== 3 || rgb.some(c => !Number.isFinite(c))) throw new ModelImportError('invalid');
    const key = rgb.join(',');
    if (!materialIds.has(key)) {
      materialIds.set(key, materials.length);
      materials.push({ pbrMetallicRoughness: { baseColorFactor: [...rgb, 1], metallicFactor: .15, roughnessFactor: .55 }, doubleSided: true });
    }
    return materialIds.get(key)!;
  };
  for (const mesh of meshes) {
    const p = mesh.attributes.position.array, ind = mesh.index.array, normal = mesh.attributes.normal?.array;
    if (!p.length || p.length % 3 || !ind.length || ind.length % 3 || p.some(v => !Number.isFinite(v)) || ind.some(i => !Number.isInteger(i) || i < 0 || i >= p.length / 3)) throw new ModelImportError('invalid');
    const pos = new Float32Array(p.length), min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) {
      pos[i] = p[i] / 1000; pos[i + 1] = p[i + 2] / 1000; pos[i + 2] = -p[i + 1] / 1000;
      for (let a = 0; a < 3; a++) { if (!Number.isFinite(pos[i + a])) throw new ModelImportError('invalid'); min[a] = Math.min(min[a], pos[i + a]); max[a] = Math.max(max[a], pos[i + a]); }
    }
    const attributes: { POSITION: number; NORMAL?: number } = { POSITION: accessors.length };
    accessors.push({ bufferView: append(pos, 34962), componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max });
    if (normal?.length === p.length) {
      if (normal.some(v => !Number.isFinite(v))) throw new ModelImportError('invalid');
      const ns = new Float32Array(normal.length);
      for (let i = 0; i < normal.length; i += 3) { ns[i] = normal[i]; ns[i + 1] = normal[i + 2]; ns[i + 2] = -normal[i + 1]; }
      attributes.NORMAL = accessors.length;
      accessors.push({ bufferView: append(ns, 34962), componentType: 5126, count: ns.length / 3, type: 'VEC3' });
    }
    const iv = append(new Uint32Array(ind), 34963), triangles = ind.length / 3;
    const colors = new Uint32Array(triangles).fill(material(mesh.color));
    for (const face of mesh.brep_faces ?? []) if (face.color) {
      if (!Number.isInteger(face.first) || !Number.isInteger(face.last) || face.first < 0 || face.last >= triangles || face.first > face.last) throw new ModelImportError('invalid');
      colors.fill(material(face.color), face.first, face.last + 1);
    }
    const primitives: object[] = [];
    for (let first = 0; first < triangles;) {
      let end = first + 1; while (end < triangles && colors[end] === colors[first]) end++;
      const indices = accessors.length;
      accessors.push({ bufferView: iv, byteOffset: first * 12, componentType: 5125, count: (end - first) * 3, type: 'SCALAR' });
      primitives.push({ attributes, indices, material: colors[first], mode: 4 }); first = end;
    }
    nodes.push({ name: mesh.name, mesh: outputMeshes.length }); outputMeshes.push({ primitives });
  }
  const doc = { asset: { version: '2.0', generator: 'Tracelet STEP import (occt-import-js)' }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes: outputMeshes, materials, accessors, bufferViews: views, buffers: [{ byteLength }] };
  const json = new TextEncoder().encode(JSON.stringify(doc)), jsonSize = Math.ceil(json.length / 4) * 4;
  const total = 28 + jsonSize + byteLength;
  if (total > MAX_MODEL_BYTES) throw new ModelImportError('complex');
  const buffer = new ArrayBuffer(total), v = new DataView(buffer), bytes = new Uint8Array(buffer);
  v.setUint32(0, 0x46546c67, true); v.setUint32(4, 2, true); v.setUint32(8, total, true);
  v.setUint32(12, jsonSize, true); v.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20, 20 + jsonSize); bytes.set(json, 20);
  v.setUint32(20 + jsonSize, byteLength, true); v.setUint32(24 + jsonSize, 0x004e4942, true);
  let offset = 28 + jsonSize; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return buffer;
}

export function glbDataUri(buffer: ArrayBuffer): string {
  let binary = ''; const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:model/gltf-binary;base64,${btoa(binary)}`;
}
