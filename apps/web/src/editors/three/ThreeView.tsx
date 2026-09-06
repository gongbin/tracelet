import { viaSpan, viaLayers, copperDepths, backdrillDepth } from '@tracelet/kernel';
import { copperLayers, type CopperLayer } from '@tracelet/kernel';
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { footprintBody, footprintDef, footprintPads, boardBounds, type Board, type Project } from '@tracelet/kernel';
import { useApp, useProject } from '../../store/app.js';
import { getAnalysis } from '../../store/analysis.js';
import { disposeObject, loadModel, modelFor, modelInstance, needsModel } from './models.js';
import { ModelMatcher } from './ModelMatcher.js';

export const MASK_COLORS: Record<string, [string, string, string]> = {
  '绿': ['#124A29', '#0D351E', '#092817'], '黑': ['#2B2B2B', '#1C1C1C', '#141414'], '白': ['#E8E8E4', '#BDBDB8', '#9E9E99'],
  '蓝': ['#1F4E8C', '#153661', '#0F2846'], '红': ['#8C1F1F', '#611515', '#460F0F'], '黄': ['#B59A1E', '#7F6B15', '#5C4D0F'], '紫': ['#5B2D8C', '#3F1F61', '#2D1646']
};

interface View3dState { components: boolean; silk: boolean; mask: boolean; copper: boolean; autoRotate: boolean; maskColor: string; silkColor: string; finish: string; capture?: () => void; exportGlb?: () => Promise<void>; set: (p: Partial<View3dState>) => void }
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
function buildScene(project: Project, s: View3dState, selection: string[], models: Map<string, THREE.Group>): { group: THREE.Group; pick: Map<THREE.Object3D, string> } {
  const board: Board = project.board;
  const bb = boardBounds(board);
  const g = new THREE.Group();
  const maskColor = board.stackup?.maskColor ?? s.maskColor, silkColor = board.stackup?.silkColor ?? s.silkColor;
  const pick = new Map<THREE.Object3D, string>();
  const T = board.thickness;
  const [maskHex] = MASK_COLORS[maskColor] ?? MASK_COLORS['绿'];
  const copperColor = s.finish === 'ENIG' ? 0xd4af37 : 0xc8c8c8;
  const X = (x: number) => x - (bb.x + bb.w / 2), Y = (y: number) => -(y - (bb.y + bb.h / 2));

  // 板体
  const shape = new THREE.Shape(board.outline.map((p) => new THREE.Vector2(X(p.x), Y(p.y))));
  const pads = board.footprints.flatMap((f) => footprintPads(f, board));
  for (const p of pads) if (p.def.drill > 0) { const hole = new THREE.Path(); hole.absarc(X(p.center.x), Y(p.center.y), p.def.drill / 2, 0, Math.PI * 2, true); shape.holes.push(hole); }
  const depthList=copperDepths(board)??copperLayers(board.copperCount).map((_,i)=>T*i/(board.copperCount-1));
  const viaBounds=(v:Board['vias'][number])=>{ const span=viaSpan(board,v), cu=copperLayers(board.copperCount); return [depthList[cu.indexOf(span[0])]??0,depthList[cu.indexOf(span[span.length-1])]??T]; };
  const drills=board.vias.flatMap(v=>{const [a,b]=viaBounds(v), d=backdrillDepth(board,v);return [{v,a,b,r:v.drill/2},...(v.backdrill&&d!==null?[{v,a:v.backdrill.side==='F'?0:T-d,b:v.backdrill.side==='F'?d:T,r:v.backdrill.diameter/2}]:[])];});
  const cuts=[...new Set([0,T,...drills.flatMap(d=>[d.a,d.b])])].sort((a,b)=>a-b);
  const boardMat = new THREE.MeshStandardMaterial({ color: s.mask ? maskHex : 0xb8862b, roughness: 0.6, metalness: 0.1 });
  for(let i=1;i<cuts.length;i++){
    const a=cuts[i-1],b=cuts[i],mid=(a+b)/2,sh=shape.clone();
    for(const v of board.vias){const r=Math.max(0,...drills.filter(d=>d.v.id===v.id&&d.a<mid&&d.b>mid).map(d=>d.r));if(!r)continue;const hole=new THREE.Path();hole.absarc(X(v.x),Y(v.y),r,0,Math.PI*2,true);sh.holes.push(hole);}
    const geo=new THREE.ExtrudeGeometry(sh,{depth:b-a,bevelEnabled:false});const mesh=new THREE.Mesh(geo,boardMat);mesh.position.z=T-b;g.add(mesh);
  }

  // 铺铜与走线（阻焊下为深色铜，铜层透视时露出）
  const a = getAnalysis(project);
  const cuMat = new THREE.MeshStandardMaterial({ color: s.copper || !s.mask ? copperColor : 0x1a5a30, roughness: 0.5, metalness: s.copper ? 0.8 : 0.2 });
  const zAt = (layer: string) => (layer === 'F.Cu' ? T + 0.02 : layer === 'B.Cu' ? -0.02 : T * (1 - copperLayers(board.copperCount).indexOf(layer as CopperLayer) / (board.copperCount - 1)));
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
  for(const v of board.vias){
    let [a,b]=viaBounds(v);const d=backdrillDepth(board,v);if(v.backdrill&&d!==null){if(v.backdrill.side==='F')a=d;else b=T-d;}
    const ring=new THREE.Shape();ring.absarc(0,0,v.size/2,0,Math.PI*2,false);const hole=new THREE.Path();hole.absarc(0,0,v.drill/2,0,Math.PI*2,true);ring.holes.push(hole);
    const mesh=new THREE.Mesh(new THREE.ExtrudeGeometry(ring,{depth:Math.max(.001,b-a),bevelEnabled:false}),padMat);mesh.position.set(X(v.x),Y(v.y),T-b);g.add(mesh);
  }

  // Library models are placed at the footprint origin; fallback boxes stay explicitly marked.
  if (s.components) for (const f of board.footprints) {
    if (!needsModel(f)) continue;
    const def = footprintDef(f), b = footprintBody(f), h = Math.max(.3, def.height);
    const config = modelFor(f, board), loaded = config && models.get(config.source);
    const root = new THREE.Group();
    if (loaded && config) root.add(modelInstance(loaded, config));
    else {
      const m = new THREE.Mesh(new THREE.BoxGeometry(def.body.w, def.body.h, h), new THREE.MeshStandardMaterial({ color: 0x9aa1ad, roughness: .7 }));
      m.position.set(def.body.x ?? 0, -(def.body.y ?? 0), h / 2); root.add(m); // 本体中心偏移（连接器原点常在 1 脚）
    }
    root.position.set(X(f.x), Y(f.y), f.side === 'F' ? T + .015 : -.015);
    root.rotation.z = -f.rotation * Math.PI / 180;
    if (f.side === 'B') root.rotation.y = Math.PI;
    root.traverse(o => { if (o instanceof THREE.Mesh) { pick.set(o, f.id); if (selection.includes(f.id)) for (const mat of Array.isArray(o.material) ? o.material : [o.material]) { if ('emissive' in mat) (mat as THREE.MeshStandardMaterial).emissive.set(0x665000); } } });
    g.add(root);
    if (s.silk) { const sp = labelSprite(f.ref, silkColor === '黑' ? '#111' : '#fff', Math.max(1.2, Math.min(2.5, b.w / 3))); sp.position.set(X(f.x), Y(f.y), f.side === 'F' ? T + h + 1.2 : -h - 1.2); g.add(sp); }
  }
  if (s.silk) for (const t of board.texts) { const sp = labelSprite(t.text, silkColor === '黑' ? '#111' : '#fff', t.size * 1.5); sp.position.set(X(t.x), Y(t.y), t.layer === 'F.Silk' ? T + 0.4 : -0.4); g.add(sp); }
  return { group: g, pick };
}

export function ThreeView() {
  const project = useProject();
  const app = useApp();
  const s3 = use3d();
  const [matching, setMatching] = useState(false);
  const [models, setModels] = useState<Map<string, THREE.Group>>(new Map());
  const [failed, setFailed] = useState<string[]>([]);
  const sources = [...new Set(project.board.footprints.filter(needsModel).map(f => modelFor(f, project.board)?.source).filter((x): x is string => !!x))];
  const sourcesKey = JSON.stringify(sources);
  useEffect(() => {
    let cancelled = false;
    const loaded = new Map<string, THREE.Group>();
    setModels(new Map()); setFailed([]);
    void Promise.all(sources.map(async source => {
      try { const model = await loadModel(source); if (cancelled) disposeObject(model); else { loaded.set(source, model); setModels(new Map(loaded)); } }
      catch { if (!cancelled) setFailed(prev => [...prev, source]); }
    }));
    return () => { cancelled = true; loaded.forEach(disposeObject); };
  }, [sourcesKey]);
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
    const state: NonNullable<typeof three.current> = { renderer, scene, camera, controls, pick: new Map<THREE.Object3D, string>(), raf: 0 };
    three.current = state;
    const save = (name: string, blob: Blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
    const slug = () => useApp.getState().editor?.project.name.replace(/[^\w一-龥-]+/g, '-') || 'board';
    use3d.setState({
      capture: () => { renderer.render(scene, camera); renderer.domElement.toBlob((blob) => { if (blob) { save(`${slug()}-3d.png`, blob); useApp.getState().toast('已保存 3D 截图 PNG', 'success'); } }, 'image/png'); },
      exportGlb: async () => {
        const grp = three.current?.group; if (!grp) return;
        const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
        await new Promise<void>((resolve) => new GLTFExporter().parse(grp, (res) => { save(`${slug()}.glb`, new Blob([res as ArrayBuffer], { type: 'model/gltf-binary' })); useApp.getState().toast('已导出 GLB（可导入 Blender / Fusion / 网页查看器）', 'success'); resolve(); }, (err) => { useApp.getState().toast(`导出失败：${(err as unknown as { message?: string }).message ?? String(err)}`, 'error'); resolve(); }, { binary: true }));
      }
    });
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
    return () => { use3d.setState({ capture: undefined, exportGlb: undefined }); cancelAnimationFrame(state.raf); ro.disconnect(); renderer.domElement.removeEventListener('click', onClick); controls.dispose(); if (state.group) disposeObject(state.group); renderer.dispose(); el.removeChild(renderer.domElement); three.current = null; };
  }, [ok]);

  // 场景内容
  useEffect(() => {
    const st = three.current; if (!st) return;
    if (st.group) { st.scene.remove(st.group); disposeObject(st.group); }
    const { group, pick } = buildScene(project, s3, app.pcbSelection, models);
    st.scene.add(group); st.group = group; st.pick = pick;
  }, [project, s3, app.pcbSelection, models]);

  // 视角
  useEffect(() => {
    const st = three.current; if (!st) return;
    const d = Math.max(bb.w, bb.h) * 1.4;
    const pos = view === 'top' ? [0, 0.001, d] : view === 'back' ? [0, -d * 0.6, -d * 0.9] : view === 'front' ? [0, -d * 0.9, d * 0.5] : [d * 0.6, -d * 0.7, d * 0.7];
    st.camera.position.set(pos[0], pos[1], pos[2]); st.camera.up.set(0, 0, 1); st.controls.target.set(0, 0, 0); st.controls.update();
  }, [view, bb.w, bb.h]);
  useEffect(() => { if (three.current) three.current.controls.autoRotate = s3.autoRotate; }, [s3.autoRotate]);

  const parts = board.footprints.filter(needsModel);
  const loadedCount = parts.filter(f => { const m = modelFor(f, board); return m && models.has(m.source); }).length;
  const missingCount = parts.filter(f => !modelFor(f, board)).length;
  const failedCount = parts.filter(f => { const m = modelFor(f, board); return m && failed.includes(m.source); }).length;
  const pendingCount = parts.length - loadedCount - missingCount - failedCount;
  return (
    <div className="canvas-wrap" style={{ background: 'radial-gradient(ellipse at 50% 40%,#2A2F38,#1A1D23 70%)' }}>
      {ok ? <div ref={host} style={{ position: 'absolute', inset: 0 }} /> : <div className="empty-state"><div className="muted">当前环境不支持 WebGL，无法显示 3D 视图</div></div>}
      <div className="float" style={{ left: '50%', bottom: 14, top: 'auto', transform: 'translateX(-50%)', padding: 3, gap: 2, fontFamily: 'var(--font-ui)', fontSize: 12 }}>
        {([['front', '正面'], ['back', '背面'], ['top', '俯视'], ['iso', '等轴']] as const).map(([id, l]) => <span key={id} style={{ padding: '4px 12px', borderRadius: 4, cursor: 'pointer', background: view === id ? 'var(--bg-raised)' : 'transparent', color: view === id ? 'var(--text)' : 'var(--text-2)' }} onClick={() => app.set('view3d', id)}>{l}</span>)}
        <span style={{ padding: '4px 12px', borderRadius: 4, cursor: 'pointer', background: s3.autoRotate ? 'var(--bg-raised)' : 'transparent', color: s3.autoRotate ? 'var(--text)' : 'var(--text-2)' }} onClick={() => s3.set({ autoRotate: !s3.autoRotate })}>⟲ 自动旋转</span>
      </div>
      <div className="float" style={{ left: 12, top: 12, fontFamily: 'var(--font-ui)', fontSize: 12, padding: '6px 10px' }}>
        <span>{loadedCount} 个元件模型已加载{pendingCount > 0 && ` · ${pendingCount} 个加载中`}{missingCount > 0 && ` · ${missingCount} 个未匹配`}{failedCount > 0 && ` · ${failedCount} 个加载失败`}</span><button className="btn sm" onClick={() => setMatching(true)}>模型匹配</button>
      </div>
      {matching && <ModelMatcher close={() => setMatching(false)} />}
      <div className="float" style={{ right: 12, top: 52 }}><span className="dim">板</span><span>{bb.w.toFixed(1)}×{bb.h.toFixed(1)}×{board.thickness} mm</span><span className="dim">· 拖动旋转 · 滚轮缩放 · 右键平移</span></div>
    </div>
  );
}
