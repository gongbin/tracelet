import { useCallback, useEffect, useRef, useState, type PointerEvent as RPE, type RefObject, type SVGProps } from 'react';
import type { Vec, Rect } from '@tracelet/kernel';
import { usePrefs } from '../i18n/index.js';

/** 视口：screen = world * k + (x, y) */
export interface VP { x: number; y: number; k: number }

export interface ViewportApi {
  vp: VP;
  setVp: (vp: VP) => void;
  toWorld: (clientX: number, clientY: number) => Vec;
  toScreen: (p: Vec) => Vec;
  fit: (rect: Rect, pad?: number) => void;
  centerOn: (p: Vec, k?: number) => void;
  /** 传给 svg 的指针事件；返回 true 表示事件被视口（平移）消费 */
  panStart: (e: RPE) => boolean;
  panMove: (e: RPE) => boolean;
  panEnd: (e: RPE) => boolean;
  touchHandlers: Pick<SVGProps<SVGSVGElement>, 'onPointerDownCapture' | 'onPointerMoveCapture' | 'onPointerUpCapture' | 'onPointerCancelCapture' | 'onLostPointerCapture'>;
  panning: boolean;
  spaceDown: boolean;
}

export function useViewport(svgRef: RefObject<SVGSVGElement | null>, opts: { initial: VP; minK: number; maxK: number; onTouchCancel?: () => void }): ViewportApi {
  const [vp, updateVp] = useState<VP>(opts.initial);
  const vpRef = useRef(vp);
  const setVp = useCallback((next: VP) => { vpRef.current = next; updateVp(next); }, []);
  const touches = useRef(new Map<number, Vec>());
  const multiTouch = useRef(false);
  const touchBase = useRef<{ center: Vec; distance: number; vp: VP } | null>(null);
  const cancelTouch = useRef(opts.onTouchCancel); cancelTouch.current = opts.onTouchCancel;
  const [panning, setPanning] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number; id: number } | null>(null);

  const toWorld = useCallback((clientX: number, clientY: number): Vec => {
    const svg = svgRef.current; const r = svg?.getBoundingClientRect();
    const v = vpRef.current;
    const sx = clientX - (r?.left ?? 0), sy = clientY - (r?.top ?? 0);
    return { x: (sx - v.x) / v.k, y: (sy - v.y) / v.k };
  }, [svgRef]);

  const toScreen = useCallback((p: Vec): Vec => { const v = vpRef.current; return { x: p.x * v.k + v.x, y: p.y * v.k + v.y }; }, []);

  const fit = useCallback((rect: Rect, pad = 40) => {
    const svg = svgRef.current; if (!svg) return;
    const W = svg.clientWidth, H = svg.clientHeight;
    if (!W || !H || rect.w <= 0 || rect.h <= 0) return;
    let k = Math.min((W - 2 * pad) / rect.w, (H - 2 * pad) / rect.h);
    k = Math.max(opts.minK, Math.min(opts.maxK, k));
    setVp({ k, x: W / 2 - (rect.x + rect.w / 2) * k, y: H / 2 - (rect.y + rect.h / 2) * k });
  }, [svgRef, opts.minK, opts.maxK]);

  const centerOn = useCallback((p: Vec, k?: number) => {
    const svg = svgRef.current; if (!svg) return;
    const kk = k ?? vpRef.current.k;
    setVp({ k: kk, x: svg.clientWidth / 2 - p.x * kk, y: svg.clientHeight / 2 - p.y * kk });
  }, [svgRef]);

  useEffect(() => {
    const svg = svgRef.current; if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const v = vpRef.current;
      const mode = usePrefs.getState().wheelMode;
      const pinch = e.ctrlKey || e.metaKey;
      // 触控板模式：双指滚动 = 平移，捏合（ctrlKey）= 缩放；鼠标模式：滚轮 = 缩放，Shift+滚轮 = 水平平移
      if (mode === 'pan' && !pinch) { setVp({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }); return; }
      if (mode === 'zoom' && e.shiftKey && !pinch) { setVp({ ...v, x: v.x - e.deltaY }); return; }
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const factor = Math.exp(-e.deltaY * (pinch ? 0.01 : 0.0015));
      const k = Math.max(opts.minK, Math.min(opts.maxK, v.k * factor));
      const wx = (sx - v.x) / v.k, wy = (sy - v.y) / v.k;
      setVp({ k, x: sx - wx * k, y: sy - wy * k });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [svgRef, opts.minK, opts.maxK]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !/INPUT|TEXTAREA/.test((e.target as HTMLElement).tagName)) { setSpaceDown(true); e.preventDefault(); } };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceDown(false); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const panStart = useCallback((e: RPE) => {
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      drag.current = { sx: e.clientX, sy: e.clientY, ox: vpRef.current.x, oy: vpRef.current.y, id: e.pointerId };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      setPanning(true);
      e.preventDefault();
      return true;
    }
    return false;
  }, [spaceDown]);
  const panMove = useCallback((e: RPE) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return false;
    setVp({ ...vpRef.current, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) });
    return true;
  }, []);
  const panEnd = useCallback((e: RPE) => {
    if (!drag.current || drag.current.id !== e.pointerId) return false;
    drag.current = null; setPanning(false);
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    return true;
  }, []);

  const rebaseTouch = () => {
    const [a, b] = [...touches.current.values()];
    if (!a || !b) { touchBase.current = null; return; }
    touchBase.current = { center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), vp: vpRef.current };
  };
  const consume = (e: RPE) => { e.preventDefault(); e.stopPropagation(); };
  const endTouch = (e: RPE, cancelled = false) => {
    if (e.pointerType !== 'touch' || !touches.current.has(e.pointerId)) return;
    const wasMulti = multiTouch.current;
    touches.current.delete(e.pointerId);
    if (wasMulti || cancelled) consume(e);
    if (cancelled && !wasMulti) cancelTouch.current?.();
    if (!touches.current.size) { multiTouch.current = false; touchBase.current = null; setPanning(false); }
    else rebaseTouch(); // A replacement finger starts from the current view, never the old pair.
    // A lone finger after a pinch stays consumed until every finger has lifted.
    // Normal pointerup releases capture automatically; do not release early and lose its bubbling event.
  };
  const touchHandlers: ViewportApi['touchHandlers'] = {
    onPointerDownCapture: (e) => {
      if (e.pointerType !== 'touch') return;
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      e.currentTarget.setPointerCapture(e.pointerId);
      if (touches.current.size >= 2 || multiTouch.current) {
        consume(e);
        if (!multiTouch.current) { cancelTouch.current?.(); drag.current = null; }
        multiTouch.current = true;
        setPanning(true);
        rebaseTouch();
      }
    },
    onPointerMoveCapture: (e) => {
      if (e.pointerType !== 'touch' || !touches.current.has(e.pointerId)) return;
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!multiTouch.current) return;
      consume(e);
      const base = touchBase.current;
      const [a, b] = [...touches.current.values()];
      if (!base || !a || !b) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const center = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
      const k = Math.max(opts.minK, Math.min(opts.maxK, base.vp.k * Math.hypot(a.x - b.x, a.y - b.y) / base.distance));
      const world = { x: (base.center.x - rect.left - base.vp.x) / base.vp.k, y: (base.center.y - rect.top - base.vp.y) / base.vp.k };
      setVp({ k, x: center.x - world.x * k, y: center.y - world.y * k });
    },
    onPointerUpCapture: (e) => endTouch(e),
    onPointerCancelCapture: (e) => endTouch(e, true),
    onLostPointerCapture: (e) => { if (e.target === e.currentTarget) endTouch(e, true); }
  };

  return { vp, setVp, toWorld, toScreen, fit, centerOn, panStart, panMove, panEnd, touchHandlers, panning, spaceDown };
}

/** 自适应栅格步长：保证屏幕上相邻格点至少 minPx。 */
export function gridStep(base: number, k: number, minPx = 8): number {
  let step = base;
  while (step * k < minPx) step *= step * k < minPx / 5 ? 5 : 2;
  return step;
}
