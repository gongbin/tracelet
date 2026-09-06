import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { footprintDef, type Board, type BoardFootprint, type Model3d } from '@tracelet/kernel';
import manifest from '../../../public/models3d/kicad/manifest.json';

export const MODEL_CATALOG = manifest as Record<string, { file: string; source: string }>;
export function needsModel(f: BoardFootprint): boolean {
  const d = footprintDef(f);
  return !(d.pads.length > 0 && d.pads.every(p => p.npth)) && !(/^TestPoint_Pad_/i.test(d.name.replace(/^.*:/, '')) || (/^TP\d/i.test(f.ref) && d.pads.length === 1 && d.pads[0].drill === 0));
}
/** 允许"同系列近似"的封装族（连接器类外形差异可接受；阻容 / IC 尺寸敏感，不做近似）。 */
const APPROX_FAMILIES = ['USB_C_Receptacle', 'USB_C_Plug', 'USB_Micro-B', 'USB_Mini-B', 'USB_A', 'USB_B', 'microSD', 'SD_', 'RJ45', 'BarrelJack', 'Barrel_Jack', 'JST_', 'Molex_', 'TerminalBlock', 'PinHeader_', 'PinSocket_', 'IDC-Header', 'Screw_Terminal'];
/** 标准目录里没有精确同名模型时，在同系列里挑共同前缀最长的一个作为近似模型。 */
export function approximateCatalogKey(key: string): string | undefined {
  if (!APPROX_FAMILIES.some((f) => key.startsWith(f))) return undefined;
  const toks = key.split('_');
  let best: string | undefined, bestN = 0;
  for (const k of Object.keys(MODEL_CATALOG)) {
    if (k === key) return k;
    const t = k.split('_'); let n = 0; while (n < toks.length && n < t.length && toks[n] === t[n]) n++;
    if (n >= Math.min(3, toks.length) && n > bestN) { bestN = n; best = k; }
  }
  return best;
}
export function modelFor(f: BoardFootprint, board: Board): Model3d | undefined {
  const override = board.models3d?.[f.footprintId];
  if (override) return override;
  const key = f.footprintId.split(':').pop()!;
  if (MODEL_CATALOG[key]) return { name: key, source: `catalog:${key}`, scale: 1000, offset: [0, 0, 0], rotation: [0, 0, 0] };
  const approx = approximateCatalogKey(key);
  if (approx) return { name: `${approx}（同系列近似）`, source: `catalog:${approx}`, scale: 1000, offset: [0, 0, 0], rotation: [0, 0, 0] };
  return undefined;
}
/** GLB imports must be self-contained; never fetch external buffers/images from uploaded files. */
export function validateGlb(buffer: ArrayBuffer) {
  const v = new DataView(buffer);
  if (buffer.byteLength < 20 || v.getUint32(0, true) !== 0x46546c67 || v.getUint32(4, true) !== 2 || v.getUint32(8, true) !== buffer.byteLength || v.getUint32(16, true) !== 0x4e4f534a) throw new Error('不是有效的 GLB 2.0 文件');
  const n = v.getUint32(12, true);
  if (20 + n > buffer.byteLength) throw new Error('GLB 文件不完整');
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, n)));
  if ([...(json.buffers ?? []), ...(json.images ?? [])].some(x => x.uri && !x.uri.startsWith('data:'))) throw new Error('请导出包含纹理和缓冲数据的单文件 GLB');
}
export async function loadModel(source: string): Promise<THREE.Group> {
  const url = source.startsWith('catalog:') ? `${import.meta.env.BASE_URL}models3d/kicad/${MODEL_CATALOG[source.slice(8)]?.file ?? 'missing.glb'}` : source;
  const response = await fetch(url); if (!response.ok) throw new Error(`模型加载失败 (${response.status})`);
  const buffer = await response.arrayBuffer(); validateGlb(buffer);
  const result = await new GLTFLoader().parseAsync(buffer, '');
  if (new THREE.Box3().setFromObject(result.scene).isEmpty()) throw new Error('模型没有可显示的几何');
  return result.scene;
}
export function disposeObject(group: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  group.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) geometries.add(m.geometry); if (m.material) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) materials.add(mat); });
  for (const mat of materials) { for (const v of Object.values(mat)) if (v instanceof THREE.Texture) textures.add(v); mat.dispose(); }
  geometries.forEach(g => g.dispose()); textures.forEach(t => t.dispose());
}
/** Own GPU resources for each scene instance so rebuilding it doesn't dispose cached model data. */
export function modelInstance(source: THREE.Group, config: Model3d): THREE.Group {
  const root = new THREE.Group(), orient = new THREE.Group(), instance = source.clone(true);
  instance.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) m.geometry = m.geometry.clone(); if (m.material) { const copy = (mat: THREE.Material) => { const c = mat.clone(); for (const [key,v] of Object.entries(c)) if (v instanceof THREE.Texture) (c as unknown as Record<string, unknown>)[key] = v.clone(); return c; }; m.material = Array.isArray(m.material) ? m.material.map(copy) : copy(m.material); } });
  // glTF uses metres, Y up; PCB scene uses millimetres, Z up.
  instance.scale.multiplyScalar(config.scale); instance.rotation.x += Math.PI / 2;
  orient.rotation.set(...config.rotation.map(v => v * Math.PI / 180) as [number, number, number]);
  root.position.set(...config.offset); orient.add(instance); root.add(orient); return root;
}
