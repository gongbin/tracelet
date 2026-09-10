import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { footprintDef, type BoardFootprint, type Model3d } from '@tracelet/kernel';
import { disposeObject, modelInstance } from './models.js';
import { surfaceText } from './labels.js';
import { studioLighting } from './studio.js';
import { useT } from '../../i18n/index.js';

export function modelBounds(model: THREE.Group, config: Model3d): THREE.Box3 {
  const instance = modelInstance(model, config);
  const box = new THREE.Box3().setFromObject(instance); disposeObject(instance); return box;
}

/** Footprint-local preview. Board-side mirroring/rotation is applied later by ThreeView. */
export function ModelPreview({ footprint, model, config }: { footprint: BoardFootprint; model?: THREE.Group; config?: Model3d }) {
  const t = useT(), host = useRef<HTMLDivElement>(null), [transparent, setTransparent] = useState(true), [unavailable, setUnavailable] = useState(false);
  const state = useRef<{ scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; geometry: THREE.Group; fit: (top?: boolean) => void } | undefined>(undefined);
  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); } catch { setUnavailable(true); return; }
    setUnavailable(false); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none'; el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#171e28');
    const camera = new THREE.PerspectiveCamera(40, 1, .01, 10000); camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
    const lighting = studioLighting(renderer, scene), geometry = new THREE.Group(), overlay = new THREE.Group(); scene.add(geometry, overlay);
    const def = footprintDef(footprint), body = def.physicalBody ?? def.body, x = body.x ?? 0, y = -(body.y ?? 0);
    const points = [[x-body.w/2,y-body.h/2], [x+body.w/2,y-body.h/2], [x+body.w/2,y+body.h/2], [x-body.w/2,y+body.h/2]].map(([x,y]) => new THREE.Vector3(x,y,.03));
    overlay.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#e8f0f8', depthTest: false })));
    for (const p of def.pads) {
      const shape = p.shape === 'circle' || p.shape === 'oval' ? new THREE.CircleGeometry(1, 32) : new THREE.PlaneGeometry(2, 2);
      const pad = new THREE.Mesh(shape, new THREE.MeshBasicMaterial({ color: p.npth ? '#10151c' : '#eabe58', side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: .8 }));
      pad.scale.set(p.w/2,p.h/2,1); pad.position.set(p.x,-p.y,.04); pad.renderOrder = 2; overlay.add(pad);
      if (p.number === '1' || p.number === 'A1') {
        const label = surfaceText(p.number, '#ffea87', Math.min(1, Math.max(.4,p.w))); label.position.set(p.x,-p.y,.06); label.material.depthTest = false; label.renderOrder=3; overlay.add(label);
      }
    }
    const radius = Math.max(body.w, body.h, 3), gridSize = Math.ceil(radius * 2);
    const grid = new THREE.GridHelper(gridSize, Math.min(100,gridSize), '#456a83','#283441'); grid.rotation.x=Math.PI/2; grid.position.z=-.03; overlay.add(grid);
    const axes = new THREE.AxesHelper(Math.max(2, radius*.3)); overlay.add(axes);
    if (def.connector?.mounting === 'horizontal' && def.connector.direction !== undefined) {
      const a = -def.connector.direction * Math.PI / 180;
      overlay.add(new THREE.ArrowHelper(new THREE.Vector3(Math.cos(a),Math.sin(a),0), new THREE.Vector3(x,y,.1), radius*.7, '#65dbbd', 1, .5));
    }
    const fit = (top = false) => {
      const box = new THREE.Box3().setFromObject(geometry);
      for (const p of points) box.expandByPoint(p);
      const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
      const r = Math.max(size.length()/2, 2), distance = r / Math.sin(camera.fov*Math.PI/360) / Math.min(1,camera.aspect) * 1.2;
      controls.target.copy(c); camera.up.set(0,top ? 1 : 0,top ? 0 : 1);
      camera.position.copy(c).addScaledVector(top ? new THREE.Vector3(0,0,1) : new THREE.Vector3(1,-1,1.3).normalize(),distance);
      camera.near=Math.max(.001,distance/10000);camera.far=Math.max(1000,distance*10);camera.updateProjectionMatrix();controls.update();
    };
    state.current = { scene, camera, controls, geometry, fit };
    const resize = () => { const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return; renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize);observer.observe(el);resize();fit();
    let raf = 0; const frame = () => { raf=requestAnimationFrame(frame);controls.update();renderer.render(scene,camera); };frame();
    return () => { cancelAnimationFrame(raf); observer.disconnect();state.current=undefined;controls.dispose();lighting();disposeObject(geometry);disposeObject(overlay);renderer.dispose();renderer.domElement.remove(); };
  }, [footprint.footprintId]);
  useEffect(() => {
    const s = state.current; if (!s) return;
    disposeObject(s.geometry);s.geometry.clear();
    if (model && config) {
      const instance = modelInstance(model,config);
      if (transparent) instance.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.material) for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) { mat.transparent=true;mat.opacity=.55;mat.depthWrite=false; } });
      s.geometry.add(instance);
    }
  }, [model,config,transparent,footprint.footprintId]);
  useEffect(() => { state.current?.fit(); }, [model,footprint.footprintId]);
  return <div className="model-preview">
    <div ref={host} role="img" aria-label={t('models.preview')} className="model-preview-canvas" />
    {unavailable && <p role="status">{t('models.webgl')}</p>}
    <div className="model-actions"><button className="btn sm" onClick={() => state.current?.fit()}>{t('three.fit')}</button><button className="btn sm" onClick={() => state.current?.fit(true)}>{t('models.top')}</button><label><input type="checkbox" checked={transparent} onChange={e=>setTransparent(e.target.checked)}/>{t('models.transparent')}</label></div>
    <p className="dim xs">{t('models.axes')}</p>
  </div>;
}
