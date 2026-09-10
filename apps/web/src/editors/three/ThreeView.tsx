import { ProductRender } from './ProductRender.js';
import { buildBoardSurfaces, DEFAULT_SURFACES, MASK_COLORS, type SurfaceOptions } from './surfaces.js';
import { studioLighting } from './studio.js';
import { placeOnBoard, referenceText, surfaceText } from './labels.js';
import { useT } from '../../i18n/index.js';
export { MASK_COLORS };
import { useCallback, useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { footprintDef, boardBounds, type Board, type Project } from '@tracelet/kernel';
import { useApp, useProject } from '../../store/app.js';
import { getAnalysis } from '../../store/analysis.js';
import { disposeObject, loadModel, modelFor, modelInstance, needsModel } from './models.js';
import { ModelMatcher } from './ModelMatcher.js';

interface View3dState extends SurfaceOptions { components: boolean; silk: boolean; labels: boolean; autoRotate: boolean; capture?: () => void; exportGlb?: () => Promise<void>; set: (p: Partial<View3dState>) => void }
export const use3d = create<View3dState>((set) => ({ ...DEFAULT_SURFACES, components: true, silk: true, labels: true, autoRotate: false, set: (p) => set(p) }));

const hasWebGL = () => {
  if (typeof window === 'undefined' || !('WebGLRenderingContext' in window)) return false;
  try { const c = document.createElement('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl'); gl?.getExtension('WEBGL_lose_context')?.loseContext(); return !!gl; } catch { return false; }
};

/** 由内核数据构建场景：板体（含孔）、焊盘、走线、铺铜、元件占位、丝印文字。板坐标 (x, y) → three (x, -y)，z 向上。 */
function buildScene(project: Project, s: View3dState, selection: string[], models: Map<string, THREE.Group>, includeBoard = true): { group: THREE.Group; pick: Map<THREE.Object3D, string> } {
  const board: Board = project.board;
  const g = includeBoard ? buildBoardSurfaces(board, getAnalysis(project).zones, s) : new THREE.Group();
  const silkColor = board.stackup?.silkColor ?? '白';
  const ink = silkColor === '黑' ? '#111111' : silkColor === '黄' ? '#ffe080' : '#ffffff';
  const pick = new Map<THREE.Object3D, string>();

  // Library models are placed at the footprint origin; fallback boxes stay explicitly marked.
  if (s.components) for (const f of board.footprints) {
    if (!needsModel(f)) continue;
    const def = footprintDef(f), h = Math.max(.3, def.height);
    const config = modelFor(f, board), loaded = config && models.get(config.source);
    const root = new THREE.Group();
    if (loaded && config) root.add(modelInstance(loaded, config));
    else {
      const m = new THREE.Mesh(new THREE.BoxGeometry((def.physicalBody??def.body).w, (def.physicalBody??def.body).h, h), new THREE.MeshStandardMaterial({ color: 0x9aa1ad, roughness: .7 }));
      m.position.set((def.physicalBody??def.body).x ?? 0, -((def.physicalBody??def.body).y ?? 0), h / 2); root.add(m); // 本体中心偏移（连接器原点常在 1 脚）
    }
    placeOnBoard(root, board, f, f.side, f.rotation, .015);
    root.traverse(o => { if (o instanceof THREE.Mesh) { pick.set(o, f.id); if (selection.includes(f.id)) for (const mat of Array.isArray(o.material) ? o.material : [o.material]) { if ('emissive' in mat) (mat as THREE.MeshStandardMaterial).emissive.set(0x665000); } } });
    g.add(root);
  }
  if (s.labels) for (const f of board.footprints) g.add(referenceText(board, f, ink));
  if (s.silk) for (const t of board.texts) {
    const text = surfaceText(t.text, ink, t.size);
    placeOnBoard(text, board, t, t.layer === 'F.Silk' ? 'F' : 'B'); g.add(text);
  }
  return { group: g, pick };
}

export function ThreeView() {
  const project = useProject();
  const t = useT();
  const app = useApp();
  const s3 = use3d();
  const [productRender,setProductRender]=useState(false);
  const [matching, setMatching] = useState(false);
  const [models, setModels] = useState<Map<string, THREE.Group>>(new Map());
  const [failed, setFailed] = useState<string[]>([]);
  const [modelRetry, setModelRetry] = useState(0);
  const sources = [...new Set(project.board.footprints.filter(needsModel).map(f => modelFor(f, project.board)?.source).filter((x): x is string => !!x))];
  const sourcesKey = JSON.stringify(sources);
  useEffect(() => {
    let cancelled = false;
    const loaded = new Map<string, THREE.Group>();
    setModels(new Map()); setFailed([]);
    void Promise.all(sources.map(async source => {
      try { const model = await loadModel(source, undefined, modelRetry>0); if (cancelled) disposeObject(model); else { loaded.set(source, model); setModels(new Map(loaded)); } }
      catch { if (!cancelled) setFailed(prev => [...prev, source]); }
    }));
    return () => { cancelled = true; loaded.forEach(disposeObject); };
  }, [sourcesKey, modelRetry]);
  const host = useRef<HTMLDivElement>(null);
  const three = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; group: THREE.Group; pick: Map<THREE.Object3D, string>; raf: number } | null>(null);
  const [ok] = useState(() => typeof document !== 'undefined' && hasWebGL());
  const [fitRevision, setFitRevision] = useState(0);
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
    const disposeStudio = studioLighting(renderer, scene);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08; controls.autoRotateSpeed = 1.2;
    const group = new THREE.Group(); scene.add(group);
    const state: NonNullable<typeof three.current> = { renderer, scene, camera, controls, group, pick: new Map<THREE.Object3D, string>(), raf: 0 };
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
    let pointerStart: { x: number; y: number } | undefined;
    let dragged = false;
    const onPointerDown = (e: PointerEvent) => { pointerStart = { x: e.clientX, y: e.clientY }; dragged = false; };
    const onPointerMove = (e: PointerEvent) => { if (pointerStart && Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y) > 5) dragged = true; };
    const onClick = (e: MouseEvent) => {
      pointerStart = undefined;
      if (dragged) return;
      const st = three.current; if (!st) return;
      const r = renderer.domElement.getBoundingClientRect();
      const nd = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      const rc = new THREE.Raycaster(); rc.setFromCamera(nd, camera);
      const hits = rc.intersectObjects([...st.pick.keys()], false);
      useApp.getState().patch({ pcbSelection: hits.length ? [st.pick.get(hits[0].object)!] : [] });
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('click', onClick);
    return () => { use3d.setState({ capture: undefined, exportGlb: undefined }); cancelAnimationFrame(state.raf); ro.disconnect(); disposeStudio(); renderer.domElement.removeEventListener('pointerdown', onPointerDown); renderer.domElement.removeEventListener('pointermove', onPointerMove); renderer.domElement.removeEventListener('click', onClick); controls.dispose(); renderer.dispose(); el.removeChild(renderer.domElement); three.current = null; };
  }, [ok]);

  // Board geometry stays in place while models load, selections change or rotation toggles.
  useEffect(() => {
    const st = three.current; if (!st) return;
    const surfaces = buildBoardSurfaces(project.board, getAnalysis(project).zones, s3);
    st.group.add(surfaces);
    return () => { st.group.remove(surfaces); disposeObject(surfaces); };
  }, [project, s3.mode, s3.mask, s3.copper, s3.traces, s3.zones, s3.traceColor, s3.zoneColor]);
  useEffect(() => {
    const st = three.current; if (!st) return;
    const { group, pick } = buildScene(project, s3, app.pcbSelection, models, false);
    st.group.add(group); st.pick = pick;
    return () => { st.group.remove(group); disposeObject(group); };
  }, [project, s3.components, s3.silk, s3.labels, app.pcbSelection, models]);

  // 视角
  useEffect(() => {
    const st = three.current; if (!st) return;
    const radius = Math.max(1, Math.hypot(bb.w, bb.h, board.thickness) / 2);
    const halfFov = Math.atan(Math.tan(st.camera.fov * Math.PI / 360) * Math.min(1, st.camera.aspect));
    const d = radius / Math.sin(halfFov) * 1.12;
    const direction = view === 'top' ? new THREE.Vector3(0, 0, 1) : view === 'back' ? new THREE.Vector3(0, 0, -1) : view === 'front' ? new THREE.Vector3(0, -1, .65).normalize() : new THREE.Vector3(.65, -.8, .9).normalize();
    const center = new THREE.Vector3(0, 0, board.thickness / 2);
    st.camera.up.set(0, 1, 0);
    st.camera.position.copy(center).addScaledVector(direction, d);
    st.camera.far = Math.max(2000, d * 10); st.camera.updateProjectionMatrix();
    st.controls.target.copy(center); st.controls.minDistance = Math.max(1, radius * .05); st.controls.maxDistance = d * 5;
    st.controls.update();
  }, [view, bb.w, bb.h, board.thickness, fitRevision]);
  useEffect(() => { if (three.current) three.current.controls.autoRotate = s3.autoRotate; }, [s3.autoRotate]);

  const parts = board.footprints.filter(needsModel);
  const loadedCount = parts.filter(f => { const m = modelFor(f, board); return m && models.has(m.source); }).length;
  const missingCount = parts.filter(f => !modelFor(f, board)).length;
  const failedCount = parts.filter(f => { const m = modelFor(f, board); return m && failed.includes(m.source); }).length;
  const pendingCount = parts.length - loadedCount - missingCount - failedCount;
  const buildProduct=useCallback(()=>buildScene(project,{...s3,mode:'realistic',components:true,mask:true,copper:false,silk:true,labels:false,traces:true,zones:true},[],models).group,[project,s3,models]);
  return (
    <div className="canvas-wrap" style={{ background: 'radial-gradient(ellipse at 50% 40%,#2A2F38,#1A1D23 70%)' }}>
      {ok ? <div ref={host} style={{ position: 'absolute', inset: 0 }} /> : <div className="empty-state"><div className="muted">当前环境不支持 WebGL，无法显示 3D 视图</div></div>}
      <div className="float" style={{ left: '50%', bottom: 14, top: 'auto', transform: 'translateX(-50%)', padding: 3, gap: 2, fontFamily: 'var(--font-ui)', fontSize: 12, maxWidth: 'calc(100% - 24px)', flexWrap: 'wrap', justifyContent: 'center' }}>
        {([['front', '正面'], ['back', '背面'], ['top', '俯视'], ['iso', '等轴']] as const).map(([id, label]) => <button className="btn ghost sm" key={id} aria-pressed={view === id} style={{ background: view === id ? 'var(--bg-raised)' : 'transparent' }} onClick={() => { app.set('view3d', id); setFitRevision(n => n + 1); }}>{label}</button>)}
        <button className="btn ghost sm" onClick={() => setFitRevision(n => n + 1)}>{t('three.fit')}</button>
        <button className="btn ghost sm" aria-pressed={s3.autoRotate} onClick={() => s3.set({ autoRotate: !s3.autoRotate })}>⟲ 自动旋转</button>
      </div>
      <div className="float" style={{ left: 12, top: 12, fontFamily: 'var(--font-ui)', fontSize: 12, padding: '6px 10px', maxWidth: 'calc(100% - 24px)', flexWrap: 'wrap' }}>
        <span>{loadedCount} 个元件模型已加载{pendingCount > 0 && ` · ${pendingCount} 个加载中`}{missingCount > 0 && ` · ${missingCount} 个未匹配`}{failedCount > 0 && ` · ${failedCount} 个加载失败`}</span><button className="btn sm" onClick={() => setMatching(true)}>{t('models.title')}</button>{failedCount > 0 && <button className="btn sm" onClick={() => setModelRetry(n => n + 1)}>{t('models.retry')}</button>}
      </div>
      <button className="btn float" style={{right:12,top:90}} onClick={()=>setProductRender(true)}>产品渲染 / Product render</button>
      {productRender && <ProductRender build={buildProduct} name={project.name} missing={missingCount+failedCount+pendingCount} onClose={()=>setProductRender(false)}/>}
      {matching && <ModelMatcher close={() => setMatching(false)} />}
      <div className="float" style={{ right: 12, top: 52 }}><span className="dim">板</span><span>{bb.w.toFixed(1)}×{bb.h.toFixed(1)}×{board.thickness} mm</span><span className="dim">· 拖动旋转 · 滚轮缩放 · 右键平移</span></div>
    </div>
  );
}
