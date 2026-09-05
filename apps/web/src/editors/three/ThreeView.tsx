import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { footprintBody, footprintDef, footprintPads, boardBounds, type Board, type Project } from '@tracelet/kernel';
import { useApp, useProject } from '../../store/app.js';
import { getAnalysis } from '../../store/analysis.js';

export const MASK_COLORS: Record<string, [string, string, string]> = {
  '绿': ['#1E6B3A', '#144A28', '#0F3A1F'], '黑': ['#2B2B2B', '#1C1C1C', '#141414'], '白': ['#E8E8E4', '#BDBDB8', '#9E9E99'],
  '蓝': ['#1F4E8C', '#153661', '#0F2846'], '红': ['#8C1F1F', '#611515', '#460F0F'], '黄': ['#B59A1E', '#7F6B15', '#5C4D0F'], '紫': ['#5B2D8C', '#3F1F61', '#2D1646']
};

interface View3dState { components: boolean; silk: boolean; mask: boolean; copper: boolean; autoRotate: boolean; maskColor: string; silkColor: string; finish: string; set: (p: Partial<View3dState>) => void }
export const use3d = create<View3dState>((set) => ({ components: true, silk: true, mask: true, copper: false, autoRotate: false, maskColor: '绿', silkColor: '白', finish: 'HASL', set: (p) => set(p) }));

const hasWebGL = () => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } };

function labelSprite(text: string, color: string, size = 1.6): THREE.Sprite {
  const cv = document.createElement('canvas'); const ctx = cv.getContext('2d')!;
  const w = Math.max(128, Math.ceil(text.length * 26) + 24);
  cv.width = w; cv.height = 64;
  ctx.font = 'bold 40px JetBrains Mono, monospace'; ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, w / 2, 32);
  const tex = new THREE.CanvasTexture(cv); tex.minFilter = THREE.LinearFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(size * (w / 64), size, 1);
  return sp;
}

/** 由内核数据构建场景：板体（含孔）、焊盘、走线、铺铜、元件占位、丝印文字。板坐标 (x, y) → three (x, -y)，z 向上。 */
function buildScene(project: Project, s: View3dState, selection: string[]): { group: THREE.Group; pick: Map<THREE.Object3D, string> } {
  const board: Board = project.board;
  const bb = boardBounds(board);
  const g = new THREE.Group();
  const pick = new Map<THREE.Object3D, string>();
  const T = board.thickness;
  const [maskHex] = MASK_COLORS[s.maskColor] ?? MASK_COLORS['绿'];
  const copperColor = s.finish === 'ENIG' ? 0xd4af37 : 0xc8c8c8;
  const X = (x: number) => x - (bb.x + bb.w / 2), Y = (y: number) => -(y - (bb.y + bb.h / 2));

  // 板体
  const shape = new THREE.Shape(board.outline.map((p) => new THREE.Vector2(X(p.x), Y(p.y))));
  const pads = board.footprints.flatMap((f) => footprintPads(f, board));
  for (const p of pads) if (p.def.drill > 0) { const hole = new THREE.Path(); hole.absarc(X(p.center.x), Y(p.center.y), p.def.drill / 2, 0, Math.PI * 2, true); shape.holes.push(hole); }
  for (const v of board.vias) { const hole = new THREE.Path(); hole.absarc(X(v.x), Y(v.y), v.drill / 2, 0, Math.PI * 2, true); shape.holes.push(hole); }
  const boardGeo = new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: false });
  const boardMat = new THREE.MeshStandardMaterial({ color: s.mask ? maskHex : 0xb8862b, roughness: 0.6, metalness: 0.1 });
  const boardMesh = new THREE.Mesh(boardGeo, boardMat); g.add(boardMesh);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(boardGeo, 30), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })); g.add(edges);

  // 铺铜与走线（阻焊下为深色铜，铜层透视时露出）
  const a = getAnalysis(project);
  const cuMat = new THREE.MeshStandardMaterial({ color: s.copper || !s.mask ? copperColor : 0x1a5a30, roughness: 0.5, metalness: s.copper ? 0.8 : 0.2 });
  const zAt = (layer: string) => (layer === 'F.Cu' ? T + 0.02 : layer === 'B.Cu' ? -0.02 : T / 2);
  if (s.copper || !s.mask) for (const f of a.zones) {
    for (const poly of f.polygons) {
      const sh = new THREE.Shape(poly[0].map((p) => new THREE.Vector2(X(p.x), Y(p.y))));
      for (const h of poly.slice(1)) sh.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(X(p.x), Y(p.y)))));
      const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), cuMat); m.position.z = zAt(f.zone.layer); g.add(m);
    }
  }
  for (const t of board.traces) {
    if (board.hiddenLayers.includes(t.layer)) continue;
    for (let i = 0; i < t.points.length - 1; i++) {
      const p1 = t.points[i], p2 = t.points[i + 1]; const len = Math.hypot(p2.x - p1.x, p2.y - p1.y); if (len < 1e-6) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, t.width, 0.035), cuMat);
      m.position.set(X((p1.x + p2.x) / 2), Y((p1.y + p2.y) / 2), zAt(t.layer)); m.rotation.z = -Math.atan2(p2.y - p1.y, p2.x - p1.x); g.add(m);
    }
  }
  // 焊盘（露铜）
  const padMat = new THREE.MeshStandardMaterial({ color: copperColor, roughness: 0.35, metalness: 0.9 });
  for (const p of pads) {
    if (p.def.npth) continue;
    const layersZ = p.through ? [T + 0.03, -0.03] : [p.layers[0] === 'F.Cu' ? T + 0.03 : -0.03];
    for (const z of layersZ) {
      const geo = p.def.shape === 'circle' || p.def.shape === 'oval' ? new THREE.CylinderGeometry(p.rect.w / 2, p.rect.w / 2, 0.05, 24).rotateX(Math.PI / 2) : new THREE.BoxGeometry(p.rect.w, p.rect.h, 0.05);
      const m = new THREE.Mesh(geo, padMat); m.position.set(X(p.center.x), Y(p.center.y), z); g.add(m);
    }
  }
  for (const v of board.vias) { const m = new THREE.Mesh(new THREE.CylinderGeometry(v.size / 2, v.size / 2, T + 0.06, 20).rotateX(Math.PI / 2), padMat); m.position.set(X(v.x), Y(v.y), T / 2); g.add(m); }

  // 元件占位（灰色盒子；选中黄色）
  if (s.components) for (const f of board.footprints) {
    const def = footprintDef(f); const b = footprintBody(f);
    const h = Math.max(0.3, def.height);
    if (def.pads.every((p) => p.npth)) continue;
    const sel = selection.includes(f.id);
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, h), new THREE.MeshStandardMaterial({ color: sel ? 0xffd84d : 0x9aa1ad, roughness: 0.7 }));
    m.position.set(X(f.x), Y(f.y), f.side === 'F' ? T + h / 2 + 0.05 : -h / 2 - 0.05);
    g.add(m); pick.set(m, f.id);
    if (s.silk) { const sp = labelSprite(f.ref, s.silkColor === '黑' ? '#111' : '#fff', Math.max(1.2, Math.min(2.5, b.w / 3))); sp.position.set(X(f.x), Y(f.y), (f.side === 'F' ? T + h : -h) + 1.2); g.add(sp); }
  }
  if (s.silk) for (const t of board.texts) { const sp = labelSprite(t.text, s.silkColor === '黑' ? '#111' : '#fff', t.size * 1.5); sp.position.set(X(t.x), Y(t.y), t.layer === 'F.Silk' ? T + 0.4 : -0.4); g.add(sp); }
  return { group: g, pick };
}

export function ThreeView() {
  const project = useProject();
  const app = useApp();
  const s3 = use3d();
  const host = useRef<HTMLDivElement>(null);
  const three = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; group?: THREE.Group; pick: Map<THREE.Object3D, string>; raf: number } | null>(null);
  const ok = typeof document !== 'undefined' && hasWebGL();
  const board = project.board;
  const bb = boardBounds(board);
  const view = app.view3d;

  // 初始化渲染器
  useEffect(() => {
    if (!ok || !host.current) return;
    const el = host.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, el.clientWidth / Math.max(1, el.clientHeight), 0.1, 2000);
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(40, -60, 90); scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.4); fill.position.set(-50, 40, 40); scene.add(fill);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08; controls.autoRotateSpeed = 1.2;
    const state = { renderer, scene, camera, controls, pick: new Map<THREE.Object3D, string>(), raf: 0 };
    three.current = state;
    const loop = () => { controls.update(); renderer.render(scene, camera); state.raf = requestAnimationFrame(loop); };
    loop();
    const ro = new ResizeObserver(() => { const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); });
    ro.observe(el);
    const onClick = (e: MouseEvent) => {
      const st = three.current; if (!st) return;
      const r = renderer.domElement.getBoundingClientRect();
      const nd = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      const rc = new THREE.Raycaster(); rc.setFromCamera(nd, camera);
      const hits = rc.intersectObjects([...st.pick.keys()], false);
      useApp.getState().patch({ pcbSelection: hits.length ? [st.pick.get(hits[0].object)!] : [] });
    };
    renderer.domElement.addEventListener('click', onClick);
    return () => { cancelAnimationFrame(state.raf); ro.disconnect(); renderer.domElement.removeEventListener('click', onClick); controls.dispose(); renderer.dispose(); el.removeChild(renderer.domElement); three.current = null; };
  }, [ok]);

  // 场景内容
  useEffect(() => {
    const st = three.current; if (!st) return;
    if (st.group) { st.scene.remove(st.group); st.group.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); const mat = m.material as THREE.Material | THREE.Material[] | undefined; if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose?.(); }); }
    const { group, pick } = buildScene(project, s3, app.pcbSelection);
    st.scene.add(group); st.group = group; st.pick = pick;
  }, [project, s3, app.pcbSelection]);

  // 视角
  useEffect(() => {
    const st = three.current; if (!st) return;
    const d = Math.max(bb.w, bb.h) * 1.4;
    const pos = view === 'top' ? [0, 0.001, d] : view === 'back' ? [0, -d * 0.6, -d * 0.9] : view === 'front' ? [0, -d * 0.9, d * 0.5] : [d * 0.6, -d * 0.7, d * 0.7];
    st.camera.position.set(pos[0], pos[1], pos[2]); st.camera.up.set(0, 0, 1); st.controls.target.set(0, 0, 0); st.controls.update();
  }, [view, bb.w, bb.h]);
  useEffect(() => { if (three.current) three.current.controls.autoRotate = s3.autoRotate; }, [s3.autoRotate]);

  const placeholderCount = board.footprints.length;
  return (
    <div className="canvas-wrap" style={{ background: 'radial-gradient(ellipse at 50% 40%,#2A2F38,#1A1D23 70%)' }}>
      {ok ? <div ref={host} style={{ position: 'absolute', inset: 0 }} /> : <div className="empty-state"><div className="muted">当前环境不支持 WebGL，无法显示 3D 视图</div></div>}
      <div className="float" style={{ left: '50%', bottom: 14, top: 'auto', transform: 'translateX(-50%)', padding: 3, gap: 2, fontFamily: 'var(--font-ui)', fontSize: 12 }}>
        {([['front', '正面'], ['back', '背面'], ['top', '俯视'], ['iso', '等轴']] as const).map(([id, l]) => <span key={id} style={{ padding: '4px 12px', borderRadius: 4, cursor: 'pointer', background: view === id ? 'var(--bg-raised)' : 'transparent', color: view === id ? 'var(--text)' : 'var(--text-2)' }} onClick={() => app.set('view3d', id)}>{l}</span>)}
        <span style={{ padding: '4px 12px', borderRadius: 4, cursor: 'pointer', background: s3.autoRotate ? 'var(--bg-raised)' : 'transparent', color: s3.autoRotate ? 'var(--text)' : 'var(--text-2)' }} onClick={() => s3.set({ autoRotate: !s3.autoRotate })}>⟲ 自动旋转</span>
      </div>
      <div className="float" style={{ left: 12, top: 12, fontFamily: 'var(--font-ui)', fontSize: 12, padding: '6px 10px' }}>
        <span style={{ color: 'var(--warning)' }}>⚠</span>{placeholderCount} 个元件使用占位模型（STEP → glTF 在后续接入）<a href="#" onClick={(e) => { e.preventDefault(); app.toast('3D 模型匹配在后续里程碑'); }}>去匹配 →</a>
      </div>
      <div className="float" style={{ right: 12, top: 12 }}><span className="dim">板</span><span>{bb.w.toFixed(1)}×{bb.h.toFixed(1)}×{board.thickness} mm</span><span className="dim">· 拖动旋转 · 滚轮缩放 · 右键平移</span></div>
    </div>
  );
}
