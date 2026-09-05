import { useCallback, useEffect, useRef, useState, type PointerEvent as RPE, type RefObject } from 'react';
import type { Vec, Rect } from '@tracelet/kernel';

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
  panning: boolean;
  spaceDown: boolean;
}

export function useViewport(svgRef: RefObject<SVGSVGElement | null>, opts: { initial: VP; minK: number; maxK: number }): ViewportApi {
  const [vp, setVp] = useState<VP>(opts.initial);
  const vpRef = useRef(vp); vpRef.current = vp;
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
      if (e.shiftKey && !e.ctrlKey && !e.metaKey) { setVp({ ...v, x: v.x - e.deltaY }); return; }
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const factor = Math.exp(-e.deltaY * (e.ctrlKey || e.metaKey ? 0.01 : 0.0015));
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
    const d = drag.current; if (!d) return false;
    setVp({ ...vpRef.current, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) });
    return true;
  }, []);
  const panEnd = useCallback((e: RPE) => {
    if (!drag.current) return false;
    drag.current = null; setPanning(false);
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    return true;
  }, []);

  return { vp, setVp, toWorld, toScreen, fit, centerOn, panStart, panMove, panEnd, panning, spaceDown };
}

/** 自适应栅格步长：保证屏幕上相邻格点至少 minPx。 */
export function gridStep(base: number, k: number, minPx = 8): number {
  let step = base;
  while (step * k < minPx) step *= step * k < minPx / 5 ? 5 : 2;
  return step;
}
