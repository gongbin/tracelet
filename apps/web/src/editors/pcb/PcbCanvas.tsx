import React, { useEffect, useMemo, useRef, useState, type PointerEvent as RPE } from 'react';
import { pcb, LAYER_COLORS, copperLayers, footprintPads, footprintBody, boardBounds, netClassFor, snapTo, PCB_GRID, dist, segRectDist, segSegDist, pointSegDist, pointInPolygon, rectsOverlap, alignFootprints, autoroute, type Vec, type Rect, type CopperLayer, type Layer, type WorldPad, type AlignMode } from '@tracelet/kernel';
import { useApp, useEditor, useProject } from '../../store/app.js';
import { getAnalysis } from '../../store/analysis.js';
import { useViewport, gridStep } from '../../hooks/useViewport.js';
import { Hint } from '../../components/Hint.js';

/** 45° 约束：把 p 吸附到从 a 出发的 H/V/45° 方向上。 */
function snap45(a: Vec, p: Vec): Vec {
  const dx = p.x - a.x, dy = p.y - a.y;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return p;
  const ang = Math.atan2(dy, dx);
  const q = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.cos(ang - q) * Math.hypot(dx, dy);
  return { x: a.x + Math.cos(q) * len, y: a.y + Math.sin(q) * len };
}
/** 从 a 到 b 的 45° 折线：先走对角线再走直线（KiCad 风格），返回中间点或 null。 */
function bend45(a: Vec, b: Vec): Vec | null {
  const dx = b.x - a.x, dy = b.y - a.y, ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax < 1e-6 || ay < 1e-6 || Math.abs(ax - ay) < 1e-6) return null;
  const d = Math.min(ax, ay);
  return { x: a.x + Math.sign(dx) * d, y: a.y + Math.sign(dy) * d };
}
let PCB_SNAP = PCB_GRID;
const sg = (v: number) => snapTo(v, PCB_SNAP);
const fmt = (v: number) => v.toFixed(2);
const ptsBox = (pts: Vec[], m = 0): Rect => { const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y); const x = Math.min(...xs) - m, y = Math.min(...ys) - m; return { x, y, w: Math.max(...xs) + m - x, h: Math.max(...ys) + m - y }; };
const contains = (a: Rect, b: Rect) => b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;

type Drag =
  | { kind: 'fp'; id: string; dx: number; dy: number }
  | { kind: 'via'; id: string; dx: number; dy: number }
  | { kind: 'text'; id: string; dx: number; dy: number }
  | { kind: 'tracePt'; id: string; index: number }
  | { kind: 'traceSeg'; id: string; index: number; start: Vec; orig: Vec[] }
  | { kind: 'outlinePt'; index: number }
  | { kind: 'outlineMaybe'; raw: Vec; p: Vec; client: { x: number; y: number } }
  | { kind: 'outlineMove'; start: Vec; orig: Vec[]; applied: Vec; withContents: boolean }
  | { kind: 'marquee'; start: Vec; add: boolean };

const ALIGN: [AlignMode, string][] = [['left', '左对齐'], ['hcenter', '水平居中'], ['right', '右对齐'], ['top', '上对齐'], ['vcenter', '垂直居中'], ['bottom', '下对齐'], ['hdist', '水平等距'], ['vdist', '垂直等距']];

export function PcbCanvas() {
  const project = useProject();
  const editor = useEditor();
  const app = useApp();
  const board = project.board;
  const svgRef = useRef<SVGSVGElement>(null);
  const view = useViewport(svgRef, { initial: { x: 40, y: 40, k: 12 }, minK: 2, maxK: 200 });
  const { vp } = view;
  const analysis = getAnalysis(project);
  const drag = useRef<Drag | null>(null);
  const fitted = useRef<string | null>(null);
  const lastClick = useRef<{ t: number; x: number; y: number }>({ t: 0, x: 0, y: 0 });
  const [marquee, setMarquee] = useState<{ a: Vec; b: Vec } | null>(null);
  const [previewBad, setPreviewBad] = useState(false);
  const [moveWithContents, setMoveWithContents] = useState(true);
  PCB_SNAP = app.pcbGrid;

  useEffect(() => {
    if (fitted.current === project.id) return;
    fitted.current = project.id;
    const bb = boardBounds(board);
    setTimeout(() => view.fit({ x: bb.x - 2, y: bb.y - 2, w: bb.w + 4 + 30, h: bb.h + 4 }, 60), 0);
  }, [project.id, board, view]);

  useEffect(() => {
    if (app.flyTo && app.flyTo.space === 'pcb') view.centerOn({ x: app.flyTo.x, y: app.flyTo.y }, Math.max(vp.k, 20));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.flyTo?.seq]);

  const visible = (l: Layer) => !board.hiddenLayers.includes(l);
  const cu = copperLayers(board.copperCount);
  const opOf = (layer: CopperLayer) => (layer === app.activeLayer ? 1 : app.otherLayerOpacity);
  const pads = useMemo(() => board.footprints.map((f) => ({ fp: f, pads: footprintPads(f, board) })), [board]);
  const flatPads = useMemo(() => pads.flatMap((p) => p.pads), [pads]);
  const hl = app.highlightNet;
  const dimIf = (net: string) => (hl && net !== hl ? 0.25 : 1);
  const tool = app.pcbTool;
  const isSelectLike = tool === 'select' || tool === 'align' || tool === 'flip';

  const padAt = (p: Vec): WorldPad | null => {
    for (const pd of flatPads) if (p.x >= pd.rect.x && p.x <= pd.rect.x + pd.rect.w && p.y >= pd.rect.y && p.y <= pd.rect.y + pd.rect.h) return pd;
    return null;
  };

  // ---- 走线中的实时间距检查 ----
  const violates = (a: Vec, b: Vec, layer: CopperLayer, width: number, net: string): boolean => {
    const c = analysis.rules.minClearance;
    for (const pd of flatPads) { if (!pd.layers.includes(layer) || (pd.net && pd.net === net)) continue; if (segRectDist(a, b, pd.rect) - width / 2 < c - 1e-6) return true; }
    for (const t of board.traces) { if (t.layer !== layer || (t.net && t.net === net)) continue; for (let i = 0; i < t.points.length - 1; i++) if (segSegDist(a, b, t.points[i], t.points[i + 1]) - (width + t.width) / 2 < c - 1e-6) return true; }
    for (const v of board.vias) { if (v.net && v.net === net) continue; if (pointSegDist(v, a, b) - width / 2 - v.size / 2 < c - 1e-6) return true; }
    return false;
  };

  const finishRoute = (extra?: Vec) => {
    const r = app.routing; if (!r) return;
    let pts = r.points;
    if (extra) { const last = pts[pts.length - 1]; const mid = bend45(last, extra); pts = mid ? [...pts, mid, extra] : [...pts, extra]; }
    if (pts.length >= 2) editor.dispatch(pcb.addTrace({ layer: r.layer, net: r.net, width: r.width, points: pts }).command);
    app.patch({ routing: null });
  };

  const selectIn = (rect: Rect, add: boolean, strict: boolean) => {
    const ids: string[] = [];
    const test = (b: Rect) => (strict ? contains(rect, b) : rectsOverlap(rect, b));
    for (const f of board.footprints) if (test(footprintBody(f))) ids.push(f.id);
    for (const t of board.traces) if (visible(t.layer) && test(ptsBox(t.points, t.width / 2))) ids.push(t.id);
    for (const v of board.vias) if (test({ x: v.x - v.size / 2, y: v.y - v.size / 2, w: v.size, h: v.size })) ids.push(v.id);
    for (const t of board.texts) if (visible(t.layer) && test({ x: t.x - t.text.length * 0.4 * t.size, y: t.y - t.size, w: t.text.length * 0.8 * t.size, h: t.size * 1.4 })) ids.push(t.id);
    app.patch({ pcbSelection: add ? [...new Set([...app.pcbSelection, ...ids])] : ids, rightTab: ids.length ? 'props' : app.rightTab });
  };

  // ---- 指针事件 ----
  const onBackgroundDown = (e: RPE<SVGSVGElement>) => {
    if (view.panStart(e)) return;
    if (e.button !== 0) return;
    const raw = view.toWorld(e.clientX, e.clientY);
    const p = { x: sg(raw.x), y: sg(raw.y) };
    const now = Date.now(); const dbl = now - lastClick.current.t < 350 && Math.abs(e.clientX - lastClick.current.x) < 4 && Math.abs(e.clientY - lastClick.current.y) < 4; lastClick.current = { t: now, x: e.clientX, y: e.clientY };
    if (app.autoroute.status === 'done') return;
    if (tool === 'route') {
      const pad = padAt(raw);
      if (!app.routing) {
        if (!pad) { app.toast('从一个焊盘开始走线'); return; }
        const nc = netClassFor(board, pad.net);
        const layer = pad.layers.includes(app.activeLayer) ? app.activeLayer : pad.layers[0];
        app.patch({ routing: { points: [pad.center], net: pad.net, layer, width: app.traceWidthOverride ?? nc?.traceWidth ?? 0.25, startPad: { footprintId: pad.footprintId, number: pad.number } }, activeLayer: layer });
        return;
      }
      const last = app.routing.points[app.routing.points.length - 1];
      if (pad && pad.net === app.routing.net && !(pad.footprintId === app.routing.startPad?.footprintId && pad.number === app.routing.startPad?.number)) { finishRoute(pad.center); return; }
      if (dbl) { finishRoute(); return; }
      const np = snap45(last, p);
      if (dist(np, last) > 1e-6) app.patch({ routing: { ...app.routing, points: [...app.routing.points, np] } });
      return;
    }
    if (tool === 'via') {
      const pad = padAt(raw);
      const nc = netClassFor(board, pad?.net ?? '');
      editor.dispatch(pcb.addVia({ x: p.x, y: p.y, size: app.viaOverride?.size ?? nc?.viaSize ?? 0.6, drill: app.viaOverride?.drill ?? nc?.viaDrill ?? 0.3, net: pad?.net ?? '' }));
      return;
    }
    if (tool === 'zone') {
      const d = app.zoneDraft ?? [];
      if (dbl && d.length >= 3) { editor.dispatch(pcb.addZone({ layer: app.activeLayer, net: 'GND', polygon: d })); app.patch({ zoneDraft: null }); return; }
      app.patch({ zoneDraft: [...d, p] });
      return;
    }
    if (tool === 'edge') {
      const d = app.outlineDraft ?? [];
      if (dbl && d.length >= 3) { editor.dispatch(pcb.setOutline(d)); app.patch({ outlineDraft: null }); app.toast('板框已更新', 'success'); return; }
      if (dbl) return;
      // 在板内按下：拖动 = 移动板框（可连同内容），单击 = 开始画新板框
      if (!d.length && board.outline.length >= 3 && pointInPolygon(raw, board.outline)) { drag.current = { kind: 'outlineMaybe', raw, p, client: { x: e.clientX, y: e.clientY } }; (e.currentTarget as Element).setPointerCapture(e.pointerId); return; }
      app.patch({ outlineDraft: [...d, p] });
      return;
    }
    if (tool === 'measure') { const m = app.measure ?? []; app.patch({ measure: m.length >= 2 ? [p] : [...m, p] }); return; }
    if (tool === 'text') { const t = prompt('丝印文字', 'v1.0'); if (t) editor.dispatch(pcb.addBoardText({ layer: 'F.Silk', text: t, x: p.x, y: p.y, size: 1 })); return; }
    if (tool === 'place') {
      if (!app.pcbPlacing) { app.set('rightTab', 'lib'); app.toast('在右侧库中选择一个封装放到板上：仅板级元件（定位孔 / 基准点 / Logo / 测试点）。带符号的元件请在原理图放置后「同步到 PCB」'); return; }
      const r = pcb.addBoardFootprint(editor.project, { footprintId: app.pcbPlacing.footprintId, x: p.x, y: p.y, rotation: app.pcbPlacing.rotation, side: app.activeLayer === 'B.Cu' ? 'B' : 'F' });
      editor.dispatch(r.command); app.toast(`已放置 ${r.ref}（仅板级，不进 BOM）· 继续点击可连续放置，右键 / Esc 结束`);
      return;
    }
    // 选择：焊盘 → 高亮网络；空白 → 框选
    const pad = padAt(raw);
    if (pad && pad.net && !e.shiftKey) { app.patch({ highlightNet: hl === pad.net ? null : pad.net, pcbSelection: [] }); return; }
    drag.current = { kind: 'marquee', start: raw, add: e.shiftKey };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const onMove = (e: RPE<SVGSVGElement>) => {
    if (view.panMove(e)) return;
    const raw = view.toWorld(e.clientX, e.clientY);
    app.set('cursorWorld', raw);
    const d = drag.current;
    if (!d) {
      if (app.routing) {
        const pv = previewPath(raw);
        let prev = app.routing.points[app.routing.points.length - 1], bad = false;
        for (const q of pv) { if (violates(prev, q, app.routing.layer, app.routing.width, app.routing.net)) bad = true; prev = q; }
        setPreviewBad(bad);
      }
      return;
    }
    const p = { x: sg(raw.x), y: sg(raw.y) };
    if (d.kind === 'marquee') { setMarquee({ a: d.start, b: raw }); return; }
    if (d.kind === 'fp') editor.dispatch(pcb.moveFootprint(d.id, { x: sg(raw.x - d.dx), y: sg(raw.y - d.dy) }));
    else if (d.kind === 'via') editor.dispatch(pcb.setViaProps(d.id, { x: sg(raw.x - d.dx), y: sg(raw.y - d.dy) }));
    else if (d.kind === 'text') editor.dispatch(pcb.setTextProps(d.id, { x: sg(raw.x - d.dx), y: sg(raw.y - d.dy) }));
    else if (d.kind === 'tracePt') { const t = editor.project.board.traces.find((x) => x.id === d.id); if (t) { const pts = [...t.points]; pts[d.index] = p; editor.dispatch(pcb.setTracePoints(d.id, pts)); } }
    else if (d.kind === 'traceSeg') {
      const a = d.orig[d.index], b = d.orig[d.index + 1];
      const vx = b.x - a.x, vy = b.y - a.y, len = Math.hypot(vx, vy) || 1;
      const nx = -vy / len, ny = vx / len;
      const off = (raw.x - d.start.x) * nx + (raw.y - d.start.y) * ny;
      const so = snapTo(off, PCB_GRID);
      const pts = [...d.orig];
      pts[d.index] = { x: a.x + nx * so, y: a.y + ny * so };
      pts[d.index + 1] = { x: b.x + nx * so, y: b.y + ny * so };
      editor.dispatch(pcb.setTracePoints(d.id, pts));
    }
    else if (d.kind === 'outlinePt') { const pts = [...editor.project.board.outline]; pts[d.index] = p; editor.dispatch(pcb.setOutline(pts)); }
    else if (d.kind === 'outlineMaybe') {
      if (Math.hypot(e.clientX - d.client.x, e.clientY - d.client.y) < 4) return;
      editor.begin(moveWithContents ? '移动整板' : '移动板框');
      drag.current = { kind: 'outlineMove', start: d.raw, orig: board.outline, applied: { x: 0, y: 0 }, withContents: moveWithContents };
    }
    else if (d.kind === 'outlineMove') {
      const dx = sg(raw.x - d.start.x), dy = sg(raw.y - d.start.y);
      if (dx === d.applied.x && dy === d.applied.y) return;
      if (d.withContents) editor.dispatch(pcb.translateBoard(dx - d.applied.x, dy - d.applied.y));
      else editor.dispatch(pcb.setOutline(d.orig.map((q) => ({ x: q.x + dx, y: q.y + dy }))));
      d.applied = { x: dx, y: dy };
    }
  };

  const onUp = (e: RPE<SVGSVGElement>) => {
    if (view.panEnd(e)) return;
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'marquee') {
      const end = view.toWorld(e.clientX, e.clientY);
      setMarquee(null);
      const w = Math.abs(end.x - d.start.x), h = Math.abs(end.y - d.start.y);
      if (w * vp.k < 4 && h * vp.k < 4) { if (!d.add) app.patch({ pcbSelection: [], highlightNet: null, checkHighlight: null }); return; }
      selectIn({ x: Math.min(d.start.x, end.x), y: Math.min(d.start.y, end.y), w, h }, d.add, end.x >= d.start.x);
      return;
    }
    if (d.kind === 'outlineMaybe') { app.patch({ outlineDraft: [d.p] }); return; } // 没拖动：当作开始画新板框
    if (d.kind === 'outlineMove') { editor.commit(); if (d.withContents) app.toast('已移动整板（板框 + 内容），可 Undo'); return; }
    editor.commit();
  };
  /** 板框尺寸输入（保持左上角不动）。 */
  const resizeBoard = (w: number, h: number) => { if (w >= 5 && h >= 5 && w <= 1000 && h <= 1000 && (Math.abs(w - bb.w) > 1e-6 || Math.abs(h - bb.h) > 1e-6)) editor.dispatch(pcb.setOutlineRect(w, h)); };

  const begin = (label: string, dr: Drag, e: RPE<SVGElement>) => {
    e.stopPropagation();
    drag.current = dr;
    editor.begin(label);
    (svgRef.current as unknown as Element | null)?.setPointerCapture?.(e.pointerId);
  };
  const select = (id: string, e: RPE<SVGElement>) => {
    app.patch({ pcbSelection: e.shiftKey ? (app.pcbSelection.includes(id) ? app.pcbSelection.filter((x) => x !== id) : [...app.pcbSelection, id]) : app.pcbSelection.includes(id) ? app.pcbSelection : [id], rightTab: app.rightTab === 'layers' || app.rightTab === 'props' || app.rightTab === null ? 'props' : app.rightTab, highlightNet: null });
  };

  const onFootprintDown = (id: string) => (e: RPE<SVGElement>) => {
    if (e.button !== 0 || view.spaceDown || !isSelectLike) return;
    if (tool === 'flip') { e.stopPropagation(); editor.dispatch(pcb.flipFootprint(id)); return; }
    const f = board.footprints.find((x) => x.id === id)!;
    const p = view.toWorld(e.clientX, e.clientY);
    select(id, e);
    begin('移动封装', { kind: 'fp', id, dx: p.x - f.x, dy: p.y - f.y }, e);
  };
  const onViaDown = (id: string) => (e: RPE<SVGElement>) => {
    if (e.button !== 0 || view.spaceDown || !isSelectLike) return;
    const v = board.vias.find((x) => x.id === id)!; const p = view.toWorld(e.clientX, e.clientY);
    select(id, e); begin('移动过孔', { kind: 'via', id, dx: p.x - v.x, dy: p.y - v.y }, e);
  };
  const onTextDown = (id: string) => (e: RPE<SVGElement>) => {
    if (e.button !== 0 || view.spaceDown || !isSelectLike) return;
    const t = board.texts.find((x) => x.id === id)!; const p = view.toWorld(e.clientX, e.clientY);
    select(id, e); begin('移动文字', { kind: 'text', id, dx: p.x - t.x, dy: p.y - t.y }, e);
  };
  const onTraceDown = (id: string) => (e: RPE<SVGElement>) => {
    if (e.button !== 0 || view.spaceDown || !isSelectLike) return;
    const t = board.traces.find((x) => x.id === id)!; const p = view.toWorld(e.clientX, e.clientY);
    let best = 0, bd = Infinity;
    for (let i = 0; i < t.points.length - 1; i++) { const dd = pointSegDist(p, t.points[i], t.points[i + 1]); if (dd < bd) { bd = dd; best = i; } }
    const wasSelected = app.pcbSelection.length === 1 && app.pcbSelection[0] === id;
    select(id, e);
    if (wasSelected) begin('移动线段', { kind: 'traceSeg', id, index: best, start: p, orig: t.points }, e); else e.stopPropagation();
  };
  const onTracePtDown = (id: string, index: number) => (e: RPE<SVGElement>) => { if (e.button !== 0) return; begin('移动顶点', { kind: 'tracePt', id, index }, e); };
  const onOutlinePtDown = (index: number) => (e: RPE<SVGElement>) => { if (e.button !== 0) return; begin('编辑板框', { kind: 'outlinePt', index }, e); };
  const onZoneDown = (id: string) => (e: RPE<SVGElement>) => { if (e.button !== 0 || !isSelectLike) return; e.stopPropagation(); select(id, e); };

  const previewPath = (raw: Vec): Vec[] => {
    const r = app.routing!;
    const last = r.points[r.points.length - 1];
    const pad = padAt(raw);
    if (pad && pad.net === r.net) { const mid = bend45(last, pad.center); return mid ? [mid, pad.center] : [pad.center]; }
    return [snap45(last, { x: sg(raw.x), y: sg(raw.y) })];
  };

  /** 右键 / 双指轻触：结束当前走线 / 草稿 / 工具。 */
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (app.routing) { if (app.routing.points.length >= 2) finishRoute(); else app.patch({ routing: null }); }
    else if (app.zoneDraft || app.outlineDraft || app.measure) app.patch({ zoneDraft: null, outlineDraft: null, measure: null });
    else if (app.autoroute.status === 'done') app.patch({ autoroute: { status: 'idle', result: null } });
    else if (tool !== 'select') app.setPcbTool('select');
    else app.patch({ pcbSelection: [], highlightNet: null });
  };

  // ---- 自动布线 ----
  const workerRef = useRef<Worker | null>(null);
  const fallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runIdRef = useRef(0);
  const sourceBoardRef = useRef<typeof board | null>(null);
  const stopAutoroute = () => {
    runIdRef.current++;
    workerRef.current?.terminate(); workerRef.current = null;
    if (fallbackRef.current !== null) clearTimeout(fallbackRef.current);
    fallbackRef.current = null;
  };
  const cancelAutoroute = () => {
    stopAutoroute(); sourceBoardRef.current = null;
    useApp.getState().patch({ autoroute: { status: 'idle', result: null } });
  };
  // Board edits (including layer changes and Undo) invalidate the proposed geometry.
  useEffect(() => {
    if (sourceBoardRef.current && sourceBoardRef.current !== board) cancelAutoroute();
  }, [board]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (app.autoroute.status === 'idle') stopAutoroute();
  }, [app.autoroute.status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    stopAutoroute(); sourceBoardRef.current = null;
    useApp.getState().patch({ autoroute: { status: 'idle', result: null } });
  }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

  const runAutoroute = () => {
    stopAutoroute();
    const runId = runIdRef.current;
    const snapshot = editor.project;
    sourceBoardRef.current = snapshot.board;
    const currentAnalysis = getAnalysis(snapshot);
    const copperCount = snapshot.board.copperCount;
    const current = () => runId === runIdRef.current && useApp.getState().editor === editor && editor.project.board === snapshot.board && useApp.getState().autoroute.status === 'running';
    app.patch({ autoroute: { status: 'running', result: null, copperCount, progress: { done: 0, total: currentAnalysis.ratsnest.unrouted, net: '' } }, routing: null });
    const finish = (r: ReturnType<typeof autoroute>) => { if (current()) app.patch({ autoroute: { status: 'done', result: r, copperCount } }); };
    const fail = (msg: string) => { if (!current()) return; app.patch({ autoroute: { status: 'idle', result: null } }); app.toast(`自动布线失败：${msg}`, 'error'); };
    const fallback = () => {
      if (!current()) return;
      fallbackRef.current = setTimeout(() => {
        fallbackRef.current = null;
        if (!current()) return;
        try { finish(autoroute(snapshot.board, currentAnalysis.rules, { allowComponentMoves: true })); } catch (err) { fail((err as Error).message); }
      }, 30);
    };
    try {
      const w = new Worker(new URL('./autoroute.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = w;
      w.onmessage = (e: MessageEvent<{ type: string; done?: number; total?: number; net?: string; result?: ReturnType<typeof autoroute>; message?: string }>) => {
        if (!current()) return;
        const m = e.data;
        if (m.type === 'progress') app.patch({ autoroute: { status: 'running', result: null, copperCount, progress: { done: m.done!, total: m.total!, net: m.net! } } });
        else {
          if (m.type === 'done') finish(m.result!); else fail(m.message ?? '未知错误');
          w.terminate(); workerRef.current = null;
        }
      };
      w.onerror = () => {
        w.terminate();
        if (!current()) return;
        workerRef.current = null;
        fallback();
      };
      w.postMessage({ board: snapshot.board, rules: currentAnalysis.rules, library: snapshot.library, opts: { allowComponentMoves: true } });
    } catch { workerRef.current?.terminate(); workerRef.current = null; fallback(); }
  };
  const acceptAutoroute = () => {
    const r = app.autoroute.result; if (!r) return;
    if (sourceBoardRef.current !== editor.project.board) { cancelAutoroute(); app.toast('板子已修改，请重新自动布线'); return; }
    editor.dispatch(pcb.applyRoutes(r.traces, r.vias, r.moves));
    app.patch({ autoroute: { status: 'idle', result: null } });
    app.toast(`已接受自动布线：${r.traces.length} 段走线 · ${r.vias.length} 个过孔${r.moves?.length ? ` · 微调 ${r.moves.length} 个器件` : ''}（可 Undo）`, 'success');
  };
  useEffect(() => { if (tool === 'autoroute' && app.autoroute.status === 'idle') { runAutoroute(); app.set('pcbTool', 'select'); } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  const alignSel = board.footprints.filter((f) => app.pcbSelection.includes(f.id)).map((f) => f.id);
  const doAlign = (mode: AlignMode) => { const moves = alignFootprints(board, alignSel, mode); if (moves.length) editor.dispatch(pcb.moveFootprints(moves)); };

  const step = gridStep(PCB_GRID * 4, vp.k, 10);
  const gs = step * vp.k;
  const bb = boardBounds(board);
  const cursorSnap = { x: sg(app.cursorWorld.x), y: sg(app.cursorWorld.y) };
  const routePreview = app.routing ? previewPath(app.cursorWorld) : null;
  const drcMarks = analysis.drc.items.filter((i) => i.location && i.rule !== 'outside-board');
  const cursor = tool === 'route' || tool === 'zone' || tool === 'measure' || tool === 'via' || tool === 'edge' ? 'crosshair' : view.panning ? 'grabbing' : view.spaceDown ? 'grab' : 'default';
  const hlItem = app.checkHighlight ? analysis.drc.items.find((i) => i.id === app.checkHighlight) : null;
  const selTrace = app.pcbSelection.length === 1 ? board.traces.find((t) => t.id === app.pcbSelection[0]) : undefined;
  const showOutlineHandles = tool === 'edge' && !app.outlineDraft;
  const hs = 6 / vp.k; // 手柄尺寸（屏幕 6px）
  const ar = app.autoroute;

  return (
    <div className="canvas-wrap pcb">
      <svg ref={svgRef} className="stage" style={{ cursor }} onPointerDown={onBackgroundDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} onContextMenu={onContextMenu} fontFamily="'JetBrains Mono',monospace">
        <defs>
          <pattern id="pcb-grid" width={gs} height={gs} patternUnits="userSpaceOnUse" x={vp.x % gs} y={vp.y % gs}><circle cx={0.5} cy={0.5} r={1} fill="#2A2F38" /></pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#pcb-grid)" />
        <g transform={`translate(${vp.x} ${vp.y}) scale(${vp.k})`}>
          {/* 板框 */}
          <polygon points={board.outline.map((p) => `${p.x},${p.y}`).join(' ')} fill="#1F2229" stroke={visible('Edge.Cuts') ? LAYER_COLORS['Edge.Cuts'] : 'transparent'} strokeWidth={0.15} />
          {/* 铺铜：轮廓虚线 + 实际填充 */}
          {board.zones.filter((z) => visible(z.layer)).map((z) => (
            <polygon key={z.id + ':o'} points={z.polygon.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" pointerEvents="stroke" stroke={app.pcbSelection.includes(z.id) ? '#FFD84D' : LAYER_COLORS[z.layer]} strokeWidth={app.pcbSelection.includes(z.id) ? 0.2 : 0.1} strokeDasharray="0.5 0.4" opacity={opOf(z.layer)} onPointerDown={onZoneDown(z.id)} style={{ cursor: 'pointer' }} />
          ))}
          {analysis.zones.filter((f) => visible(f.zone.layer)).map((f) => (
            <path key={f.zone.id + ':f'} fillRule="evenodd" d={f.polygons.map((poly) => poly.map((ring) => ring.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join('') + 'Z').join('')).join('')} fill={LAYER_COLORS[f.zone.layer]} fillOpacity={0.35 * opOf(f.zone.layer) * dimIf(f.zone.net)} stroke="none" pointerEvents="none" />
          ))}
          {/* 走线 */}
          {[...board.traces].sort((a, b) => (a.layer === app.activeLayer ? 1 : 0) - (b.layer === app.activeLayer ? 1 : 0)).filter((t) => visible(t.layer)).map((t) => {
            const d = t.points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join('');
            const sel = app.pcbSelection.includes(t.id), hlt = hl && t.net === hl;
            return <g key={t.id} onPointerDown={onTraceDown(t.id)} style={{ cursor: isSelectLike ? 'pointer' : undefined }}>
              {(sel || hlt) && <path d={d} stroke="#FFD84D" strokeWidth={t.width + 0.3} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.5} />}
              <path d={d} stroke={LAYER_COLORS[t.layer]} strokeWidth={t.width} opacity={opOf(t.layer) * dimIf(t.net)} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              <path d={d} stroke="transparent" strokeWidth={Math.max(t.width, 0.6)} fill="none" />
            </g>;
          })}
          {/* 封装 */}
          {pads.map(({ fp, pads: ps }) => {
            const body = footprintBody(fp);
            const silk: Layer = fp.side === 'F' ? 'F.Silk' : 'B.Silk';
            const sel = app.pcbSelection.includes(fp.id);
            return (
              <g key={fp.id} onPointerDown={onFootprintDown(fp.id)} style={{ cursor: isSelectLike ? 'move' : undefined }}>
                {sel && <rect x={body.x - 0.6} y={body.y - 0.6} width={body.w + 1.2} height={body.h + 1.2} rx={0.3} fill="rgba(255,216,77,.08)" stroke="#FFD84D" strokeWidth={0.15} />}
                {visible(silk) && <rect x={body.x} y={body.y} width={body.w} height={body.h} fill="transparent" stroke={LAYER_COLORS[silk]} strokeWidth={0.12} opacity={fp.side === 'F' ? 1 : 0.6} />}
                {ps.map((pd, i) => {
                  const color = pd.through ? LAYER_COLORS[app.activeLayer] : LAYER_COLORS[pd.layers[0]];
                  const hlp = hl && pd.net === hl;
                  return <g key={i} opacity={(pd.through || pd.layers.includes(app.activeLayer) ? 1 : app.otherLayerOpacity) * dimIf(pd.net)}>
                    {hlp && <rect x={pd.rect.x - 0.2} y={pd.rect.y - 0.2} width={pd.rect.w + 0.4} height={pd.rect.h + 0.4} rx={0.2} fill="rgba(255,216,77,.5)" />}
                    {pd.def.shape === 'circle' || pd.def.shape === 'oval'
                      ? <ellipse cx={pd.center.x} cy={pd.center.y} rx={pd.rect.w / 2} ry={pd.rect.h / 2} fill={pd.def.npth ? 'none' : color} stroke={pd.def.npth ? LAYER_COLORS['Edge.Cuts'] : 'none'} strokeWidth={0.1} />
                      : <rect x={pd.rect.x} y={pd.rect.y} width={pd.rect.w} height={pd.rect.h} rx={pd.def.shape === 'roundrect' ? Math.min(pd.rect.w, pd.rect.h) * 0.25 : 0} fill={color} />}
                    {pd.through && <circle cx={pd.center.x} cy={pd.center.y} r={pd.def.drill / 2} fill="#1A1D23" />}
                    <title>{`${fp.ref}.${pd.number}${pd.net ? ' · ' + pd.net : ''}`}</title>
                  </g>;
                })}
                {visible(silk) && (body.h >= 4
                  ? <text x={fp.x} y={fp.y + 0.5} fontSize={1.4} fill={LAYER_COLORS[silk]} textAnchor="middle" pointerEvents="none">{fp.ref}</text>
                  : <text x={fp.x} y={body.y - 0.35} fontSize={0.8} fill={LAYER_COLORS[silk]} textAnchor="middle" pointerEvents="none">{fp.ref}</text>)}
              </g>
            );
          })}
          {/* 过孔 */}
          {board.vias.map((v) => (
            <g key={v.id} onPointerDown={onViaDown(v.id)} style={{ cursor: isSelectLike ? 'move' : undefined }} opacity={dimIf(v.net)}>
              <circle cx={v.x} cy={v.y} r={v.size / 2} fill={app.pcbSelection.includes(v.id) ? '#FFD84D' : LAYER_COLORS[app.activeLayer]} />
              <circle cx={v.x} cy={v.y} r={v.drill / 2} fill="#1A1D23" />
            </g>
          ))}
          {/* 丝印文字 */}
          {board.texts.filter((t) => visible(t.layer)).map((t) => <text key={t.id} x={t.x} y={t.y} fontSize={t.size * 1.2} fill={app.pcbSelection.includes(t.id) ? '#FFD84D' : LAYER_COLORS[t.layer]} textAnchor="middle" letterSpacing={0.1} onPointerDown={onTextDown(t.id)} style={{ cursor: isSelectLike ? 'move' : undefined }}>{t.text}</text>)}
          {/* 飞线 */}
          <g stroke="#FFFFFF" strokeOpacity={0.45} strokeWidth={0.08} strokeDasharray="0.3 0.3">
            {analysis.ratsnest.lines.map((l, i) => <line key={i} x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} opacity={dimIf(l.net)} stroke={hl === l.net ? '#FFD84D' : undefined} />)}
          </g>
          {/* 选中走线的顶点手柄 */}
          {selTrace && isSelectLike && selTrace.points.map((p, i) => <rect key={i} x={p.x - hs / 2} y={p.y - hs / 2} width={hs} height={hs} fill="#16181D" stroke="#FFD84D" strokeWidth={hs / 5} style={{ cursor: 'crosshair' }} onPointerDown={onTracePtDown(selTrace.id, i)} />)}
          {/* 板框顶点手柄（板框工具） */}
          {showOutlineHandles && board.outline.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={hs * 0.7} fill="#16181D" stroke={LAYER_COLORS['Edge.Cuts']} strokeWidth={hs / 5} style={{ cursor: 'move' }} onPointerDown={onOutlinePtDown(i)} />)}
          {/* 走线预览 */}
          {app.routing && routePreview && (
            <g pointerEvents="none">
              <path d={app.routing.points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join('')} stroke={LAYER_COLORS[app.routing.layer]} strokeWidth={app.routing.width} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
              <path d={`M${app.routing.points[app.routing.points.length - 1].x} ${app.routing.points[app.routing.points.length - 1].y}` + routePreview.map((q) => `L${q.x} ${q.y}`).join('')} stroke={previewBad ? '#FF3B30' : LAYER_COLORS[app.routing.layer]} strokeWidth={app.routing.width} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
              <circle cx={routePreview[routePreview.length - 1].x} cy={routePreview[routePreview.length - 1].y} r={app.routing.width} fill="none" stroke={previewBad ? '#FF3B30' : '#fff'} strokeWidth={0.06} />
            </g>
          )}
          {/* 板级封装放置预览 */}
          {tool === 'place' && app.pcbPlacing && (() => { const ghost = { id: 'ghost', ref: '?', footprintId: app.pcbPlacing.footprintId, value: '', x: cursorSnap.x, y: cursorSnap.y, rotation: app.pcbPlacing.rotation, side: (app.activeLayer === 'B.Cu' ? 'B' : 'F') as 'F' | 'B', padNets: {} }; const b = footprintBody(ghost); return (
            <g pointerEvents="none" opacity={0.75}>
              <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="rgba(61,139,255,.12)" stroke="#3D8BFF" strokeWidth={0.12} strokeDasharray="0.4 0.3" />
              {footprintPads(ghost, board).map((pd, i) => pd.def.shape === 'circle' || pd.def.shape === 'oval' ? <ellipse key={i} cx={pd.center.x} cy={pd.center.y} rx={pd.rect.w / 2} ry={pd.rect.h / 2} fill={pd.def.npth ? 'none' : '#3D8BFF'} stroke="#3D8BFF" strokeWidth={0.1} /> : <rect key={i} x={pd.rect.x} y={pd.rect.y} width={pd.rect.w} height={pd.rect.h} fill="#3D8BFF" />)}
            </g>); })()}
          {/* 铺铜 / 板框草稿 */}
          {app.zoneDraft && app.zoneDraft.length > 0 && (
            <g pointerEvents="none">
              <polyline points={[...app.zoneDraft, cursorSnap].map((p) => `${p.x},${p.y}`).join(' ')} fill={LAYER_COLORS[app.activeLayer]} fillOpacity={0.12} stroke={LAYER_COLORS[app.activeLayer]} strokeWidth={0.1} strokeDasharray="0.4 0.3" />
              {app.zoneDraft.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={0.25} fill="#fff" />)}
            </g>
          )}
          {app.outlineDraft && app.outlineDraft.length > 0 && (
            <g pointerEvents="none">
              <polyline points={[...app.outlineDraft, cursorSnap].map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(208,210,214,.06)" stroke={LAYER_COLORS['Edge.Cuts']} strokeWidth={0.12} strokeDasharray="0.6 0.4" />
              {app.outlineDraft.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={0.25} fill={LAYER_COLORS['Edge.Cuts']} />)}
            </g>
          )}
          {app.measure && app.measure.length > 0 && (() => { const a = app.measure![0], b = app.measure![1] ?? cursorSnap; const d = dist(a, b); return (
            <g pointerEvents="none">
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#FFD84D" strokeWidth={0.08} />
              <circle cx={a.x} cy={a.y} r={0.2} fill="#FFD84D" /><circle cx={b.x} cy={b.y} r={0.2} fill="#FFD84D" />
              <g transform={`translate(${(a.x + b.x) / 2 + 0.5} ${(a.y + b.y) / 2 - 0.5})`}><rect x={0} y={-1.4} width={11} height={1.8} rx={0.2} fill="#16181D" opacity={0.9} /><text x={0.4} y={0} fontSize={1.1} fill="#FFD84D">{`${fmt(d)}mm ΔX ${fmt(Math.abs(b.x - a.x))} ΔY ${fmt(Math.abs(b.y - a.y))}`}</text></g>
            </g>); })()}
          {/* 自动布线建议 */}
          {ar.status === 'done' && ar.result && (
            <g pointerEvents="none" opacity={0.95}>
              {ar.result.moves?.map(m => {
                const original = board.footprints.find(fp => fp.id === m.id); if (!original) return null;
                const proposed = { ...original, x: m.x, y: m.y }, body = footprintBody(proposed);
                return <g key={m.id} stroke="#A78BFA" fill="none" pointerEvents="none">
                  <path d={`M${m.from.x} ${m.from.y}L${m.x} ${m.y}`} strokeWidth={.12} strokeDasharray=".3 .2" />
                  <rect x={body.x} y={body.y} width={body.w} height={body.h} strokeWidth={.15} strokeDasharray=".4 .2" />
                  {footprintPads(proposed, board).map((p, i) => <rect key={i} {...{ x: p.rect.x, y: p.rect.y, width: p.rect.w, height: p.rect.h }} strokeWidth={.12} />)}
                  <text x={m.x} y={body.y - .4} fill="#A78BFA" stroke="none" textAnchor="middle" fontSize={.8}>{m.ref}</text>
                </g>;
              })}
              {ar.result.traces.map((t, i) => <path key={i} d={t.points.map((p, j) => `${j ? 'L' : 'M'}${p.x} ${p.y}`).join('')} stroke="#A78BFA" strokeWidth={t.width} strokeDasharray={`${t.width * 2.5} ${t.width * 1.5}`} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={t.layer === app.activeLayer ? 1 : 0.55} />)}
              {ar.result.vias.map((v, i) => <circle key={i} cx={v.x} cy={v.y} r={v.size / 2} fill="none" stroke="#A78BFA" strokeWidth={0.12} />)}
            </g>
          )}
          {/* DRC 标记 */}
          {drcMarks.map((m) => {
            const on = app.checkHighlight === m.id;
            return <g key={m.id} transform={`translate(${m.location!.x} ${m.location!.y})`} pointerEvents="none" opacity={app.checkHighlight && !on ? 0.35 : 1}>
              {on && <circle r={2.2} fill={m.severity === 'error' ? '#FF3B30' : '#FFB020'} className="drc-pulse" opacity={0.15} />}
              <circle r={1.1} fill="none" stroke={m.severity === 'error' ? '#FF3B30' : '#FFB020'} strokeWidth={0.18} />
            </g>;
          })}
          {hlItem?.location && (
            <g transform={`translate(${hlItem.location.x + 1.6} ${hlItem.location.y - 3})`} pointerEvents="none">
              <rect x={0} y={0} width={Math.max(10, hlItem.message.length * 0.75 + 1.5)} height={2.2} rx={0.4} fill={hlItem.severity === 'error' ? '#FF3B30' : '#FFB020'} />
              <text x={0.8} y={1.5} fontSize={1.05} fill="#fff" fontFamily="Inter,'Noto Sans SC',sans-serif">● {hlItem.message}</text>
            </g>
          )}
        </g>
        {/* 框选矩形（屏幕坐标） */}
        {marquee && (() => { const a = view.toScreen(marquee.a), b = view.toScreen(marquee.b); const ltr = marquee.b.x >= marquee.a.x; return <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} fill={ltr ? 'rgba(61,139,255,.12)' : 'rgba(52,199,89,.12)'} stroke={ltr ? '#3D8BFF' : '#34C759'} strokeWidth={1} strokeDasharray={ltr ? undefined : '4 3'} pointerEvents="none" />; })()}
      </svg>
      <div className="float" style={{ left: 12, top: 12 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: LAYER_COLORS[app.activeLayer] }} /><span>{app.activeLayer}</span><span className="dim">· 当前层 · 数字键 1–{cu.length} 切换</span>
      </div>
      {app.routing && (
        <div className="banner" style={{ borderColor: previewBad ? 'var(--error)' : undefined }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: LAYER_COLORS[app.routing.layer] }} />
          走线中 <span className="mono">{app.routing.net || '无网络'}</span> · {app.routing.layer} · <span className="mono">{fmt(app.routing.width)}mm</span>
          {previewBad ? <span style={{ color: 'var(--error)' }}>间距不足（&lt; {analysis.rules.minClearance}mm）</span> : <span className="dim">点击加点 · 双击或点同网络焊盘结束 · V 过孔换层 · Esc 取消</span>}
        </div>
      )}
      {tool === 'edge' && !app.routing && (
        <div className="banner" style={{ gap: 10, flexWrap: 'wrap', width: 'max-content', maxWidth: 'calc(100% - 24px)' }} onPointerDown={(e) => e.stopPropagation()}>
          <span className="dim">板框</span>
          <span className="row mono" style={{ gap: 4 }}>
            <input className="input mono" key={`w${bb.w}`} style={{ width: 64, height: 22 }} defaultValue={fmt(bb.w)} title="板宽 mm（左上角不动）" onBlur={(e) => resizeBoard(Number(e.target.value), bb.h)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />×
            <input className="input mono" key={`h${bb.h}`} style={{ width: 64, height: 22 }} defaultValue={fmt(bb.h)} title="板高 mm（左上角不动）" onBlur={(e) => resizeBoard(bb.w, Number(e.target.value))} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /> mm
          </span>
          <button className="btn sm" title="板框自动包住所有元件 / 走线（四周留 2mm）" onClick={() => { editor.dispatch(pcb.fitOutlineToContent(2)); app.toast('板框已包住全部内容（留 2mm），可 Undo', 'success'); }}>适配内容</button>
          <button className="btn sm" title="把整板（含内容）移到原点 (0,0)" onClick={() => editor.dispatch(pcb.normalizeBoardOrigin())}>归零</button>
          <span className={`chip${moveWithContents ? ' on' : ''}`} title="拖动板框时元件、走线、铺铜一起移动" onClick={() => setMoveWithContents(!moveWithContents)}>{moveWithContents ? '✓ 连同内容移动' : '仅移动板框'}</span>
          <span className="dim">{app.outlineDraft?.length ? `新板框已 ${app.outlineDraft.length} 点 · 双击闭合 · Esc 取消` : '拖板内 = 移动 · 拖顶点 = 调整 · 点板外 = 画新板框'}</span>
        </div>
      )}
      {ar.status === 'running' && (
        <div className="banner" style={{ width: 'max-content', maxWidth: 'calc(100% - 24px)', flexWrap: 'nowrap', gap: 8 }}><span className="spinner" /><span>自动布线中 · {ar.copperCount ?? board.copperCount} 层板</span><span className="mono" style={{ flex: '0 0 auto', width: '9ch', fontVariantNumeric: 'tabular-nums' }}>{ar.progress?.done ?? 0}/{ar.progress?.total ?? analysis.ratsnest.unrouted}</span><span className="dim" title={ar.progress?.net || '准备中'} style={{ flex: '0 1 auto', width: '12ch', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ar.progress?.net || '准备中'}</span>
          <span style={{ flex: '0 1 auto', width: 120, minWidth: 40, height: 3, borderRadius: 2, background: 'var(--border)', overflow: 'hidden', display: 'inline-block' }}><span style={{ display: 'block', width: `${ar.progress && ar.progress.total ? (100 * ar.progress.done) / ar.progress.total : 0}%`, height: '100%', background: 'var(--accent)' }} /></span>
          <button className="btn sm" style={{ flexShrink: 0 }} onClick={cancelAutoroute}>取消</button>
        </div>
      )}
      {ar.status === 'done' && ar.result && (
        <div className="banner ai" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6, whiteSpace: 'normal', width: 'min(640px, calc(100% - 24px))' }}>
          <div className="row" style={{ gap: 10 }}>
            <span style={{ flex: 1, minWidth: 0, lineHeight: 1.6 }}>自动布线完成 · {ar.copperCount ?? board.copperCount} 层板 · <span className="mono">{ar.result.routed}/{ar.result.total}</span> 连接 · {(ar.result.ms / 1000).toFixed(1)}s{ar.result.failed.length ? <span style={{ color: 'var(--warning)' }}>，{ar.result.failed.length} 条失败</span> : ''}</span>
            <button className="btn sm ai-solid" style={{ flexShrink: 0 }} onClick={acceptAutoroute} disabled={!ar.result.traces.length && !ar.result.moves?.length}>接受</button>
            <button className="btn sm" style={{ flexShrink: 0 }} onClick={cancelAutoroute}>放弃</button>
          </div>
          <div className="dim">紫色虚线为建议，接受后可 Undo{ar.result.moves?.length ? ` · 建议微调 ${ar.result.moves.length} 个器件（${ar.result.moves.map(m => m.ref).join('、')}）` : ''}</div>
          {ar.result.failed.length > 0 && (
            <div className="col" style={{ gap: 2, fontSize: 11.5 }}>
              {[...new Map(ar.result.failed.map((f) => [f.net + f.reason, f])).values()].slice(0, 6).map((f, i) => <div key={i} className="row" style={{ gap: 6 }}><span style={{ color: 'var(--warning)' }}>⚠</span><span className="mono">{f.net || '无网络'}</span><span className="muted">{f.reason}</span></div>)}
              {ar.result.failed.length > 6 && <div className="dim">…还有 {ar.result.failed.length - 6} 条</div>}
            </div>
          )}
        </div>
      )}
      {(tool === 'align' || (isSelectLike && alignSel.length >= 2)) && ar.status === 'idle' && !app.routing && (
        <div className="banner" style={{ top: 'auto', bottom: 56, gap: 4, padding: '6px 8px' }}>
          <span className="dim" style={{ marginRight: 4 }}>{alignSel.length >= 2 ? `对齐 ${alignSel.length} 个元件` : '框选 2 个以上元件'}</span>
          {ALIGN.map(([m, label]) => <button key={m} className="btn sm" disabled={alignSel.length < 2} onClick={() => doAlign(m)}>{label}</button>)}
        </div>
      )}
      <Hint space="pcb" />
      <div className="float" style={{ right: 12, top: 12, cursor: 'pointer' }} title="点击编辑板框尺寸 / 位置" onClick={() => app.setPcbTool('edge')}><span className="dim">板</span><span>{fmt(bb.w)}×{fmt(bb.h)} mm</span><span className="dim">✎</span></div>
    </div>
  );
}
