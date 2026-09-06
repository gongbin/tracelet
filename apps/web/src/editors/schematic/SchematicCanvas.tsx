import React, { useEffect, useMemo, useRef, useState, type PointerEvent as RPE } from 'react';
import { sch, getSymbol, findPin, previewRoute, snapComponentOrigin, componentBounds, SCH_GRID, snapTo, pointOnSeg, pointSegDist, rectsOverlap, milToMm, paperSize, titleBlockSize, type SheetFrame as SheetFrameDef, type Vec, type Rect, type Wire, frameLabels, sheetDisplayName } from '@tracelet/kernel';
import { useApp, useEditor, useProject, useSheet } from '../../store/app.js';
import { getAnalysis } from '../../store/analysis.js';
import { useViewport, gridStep } from '../../hooks/useViewport.js';
import { SymbolGlyph } from './SymbolGlyph.js';
import { SCH_COLORS, crossSheetLabelNames, netLabelLayout } from '@tracelet/kernel';
import { Hint } from '../../components/Hint.js';
import { usePrefs } from '../../i18n/index.js';

let SCH_SNAP = SCH_GRID;
const G = (v: number) => snapTo(v, SCH_SNAP);
const gp = (p: Vec): Vec => ({ x: G(p.x), y: G(p.y) });
const pathD = (pts: Vec[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join('');
const ptsBox = (pts: Vec[], m = 0): Rect => { const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y); const x = Math.min(...xs) - m, y = Math.min(...ys) - m; return { x, y, w: Math.max(...xs) + m - x, h: Math.max(...ys) + m - y }; };
const contains = (a: Rect, b: Rect) => b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;
/** 正交折线预览：从 a 到 b 先走主方向。 */
const ortho = (a: Vec, b: Vec): Vec[] => (a.x === b.x || a.y === b.y ? [a, b] : Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? [a, { x: b.x, y: a.y }, b] : [a, { x: a.x, y: b.y }, b]);
const dedupe = (pts: Vec[]) => pts.filter((p, i) => i === 0 || p.x !== pts[i - 1].x || p.y !== pts[i - 1].y);

function unionRect(rs: Rect[]): Rect | null {
  if (rs.length === 0) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const r of rs) { x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y); x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h); }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

type Drag =
  | { kind: 'comp'; id: string; dx: number; dy: number }
  | { kind: 'wirePt'; id: string; index: number }
  | { kind: 'wireSeg'; id: string; index: number; start: Vec; orig: Vec[] }
  | { kind: 'label'; id: string; dx: number; dy: number }
  | { kind: 'poly'; id: string; type: 'bus' | 'graphic'; start: Vec; orig: Vec[] }
  | { kind: 'rectG'; id: string; start: Vec; a: Vec; b: Vec }
  | { kind: 'point'; id: string; type: 'junction' | 'text'; dx: number; dy: number }
  | { kind: 'marquee'; start: Vec; add: boolean };

/** 图纸边框 + 标题栏（A4/A3/A2）。 */
function SheetFrame({ project, sheetName, index, total, frame: frame0 }: { project: { name: string; updatedAt: string }; sheetName: string; index: number; total: number; frame: SheetFrameDef }) {
  const userName = usePrefs((s) => s.userName);
  const frame = frame0.author ? frame0 : { ...frame0, author: userName }; // 未填作者时用头像里的姓名
  const paper = paperSize(frame);
  if (!paper) return null;
  const W = paper.w, H = paper.h;
  const m = 200, ink = '#8E8B84', text = '#6B6862';
  const cols = Math.max(1, Math.round(W / 2000)), rows = Math.max(1, Math.round(H / 2000));
  const { w: tbW, h: tbH } = titleBlockSize(frame, W); const tx = W - m - tbW, ty = H - m - tbH;
  const sx = tbW / 4400, sy = tbH / 900; // 列 / 行按标题栏尺寸等比缩放
  const X = (v: number) => tx + v * sx, Y = (v: number) => ty + v * sy;
  const date = frame.date || project.updatedAt.slice(0, 10);
  const locale = usePrefs((p) => p.locale);
  const L = frameLabels(frame, locale);
  const sizeText = frame.size === 'custom' ? `${Math.round(W * 0.0254)}×${Math.round(H * 0.0254)} mm` : `${frame.size}${frame.landscape ? '' : (locale === 'en' ? ' portrait' : ' 纵向')}`;
  return (
    <g pointerEvents="none" fontFamily="Inter,'Noto Sans SC',sans-serif">
      <rect x={0} y={0} width={W} height={H} fill="none" stroke={ink} strokeWidth={10} />
      <rect x={m} y={m} width={W - 2 * m} height={H - 2 * m} fill="none" stroke={ink} strokeWidth={16} />
      {Array.from({ length: cols }, (_, i) => { const x0 = m + ((W - 2 * m) / cols) * i, x1 = m + ((W - 2 * m) / cols) * (i + 1); return <g key={'c' + i}>
        {i > 0 && <><line x1={x0} y1={0} x2={x0} y2={m} stroke={ink} strokeWidth={8} /><line x1={x0} y1={H - m} x2={x0} y2={H} stroke={ink} strokeWidth={8} /></>}
        <text x={(x0 + x1) / 2} y={m * 0.68} fontSize={110} fill={text} textAnchor="middle">{i + 1}</text><text x={(x0 + x1) / 2} y={H - m * 0.32} fontSize={110} fill={text} textAnchor="middle">{i + 1}</text></g>; })}
      {Array.from({ length: rows }, (_, i) => { const y0 = m + ((H - 2 * m) / rows) * i, y1 = m + ((H - 2 * m) / rows) * (i + 1); const ch = String.fromCharCode(65 + i); return <g key={'r' + i}>
        {i > 0 && <><line x1={0} y1={y0} x2={m} y2={y0} stroke={ink} strokeWidth={8} /><line x1={W - m} y1={y0} x2={W} y2={y0} stroke={ink} strokeWidth={8} /></>}
        <text x={m / 2} y={(y0 + y1) / 2 + 40} fontSize={110} fill={text} textAnchor="middle">{ch}</text><text x={W - m / 2} y={(y0 + y1) / 2 + 40} fontSize={110} fill={text} textAnchor="middle">{ch}</text></g>; })}
      <g stroke={ink} strokeWidth={12} fill="#FBFAF7">
        <rect x={tx} y={ty} width={tbW} height={tbH} />
        <line x1={tx} y1={Y(300)} x2={tx + tbW} y2={Y(300)} /><line x1={tx} y1={Y(600)} x2={tx + tbW} y2={Y(600)} />
        <line x1={X(2600)} y1={Y(600)} x2={X(2600)} y2={ty + tbH} /><line x1={X(3500)} y1={Y(600)} x2={X(3500)} y2={ty + tbH} />
      </g>
      <g fill={text} fontSize={100}>
        <text x={X(80)} y={Y(110)}>{frame.company || 'Tracelet'}</text>
        <text x={X(80)} y={Y(240)} fontSize={Math.min(170, 170 * sy)} fontWeight={600} fill="#3A3835">{frame.title || project.name}</text>
        <text x={X(80)} y={Y(410)}>{L.sheet}</text><text x={X(80)} y={Y(540)} fontSize={140} fill="#3A3835">{sheetDisplayName(sheetName, locale)}</text>
        <text x={X(80)} y={Y(700)}>{L.date}</text><text x={X(80)} y={Y(840)} fontSize={130} fill="#3A3835">{date}</text>
        <text x={X(2680)} y={Y(700)}>{L.revision}</text><text x={X(2680)} y={Y(840)} fontSize={130} fill="#3A3835">{frame.revision}</text>
        <text x={X(3580)} y={Y(700)}>{L.page}</text><text x={X(3580)} y={Y(840)} fontSize={130} fill="#3A3835">{index + 1} / {total}</text>
        <text x={X(2680)} y={Y(240)} fontSize={100}>{sizeText}{frame.author ? `  ${L.author}: ${frame.author}` : ''}</text>
        <text x={X(2680)} y={Y(540)} fontSize={100}>{frame.comment}</text>
      </g>
    </g>
  );
}

export function SchematicCanvas() {
  const project = useProject();
  const editor = useEditor();
  const app = useApp();
  const sheet = useSheet();
  const sheetIndex = project.schematic.sheets.findIndex((s) => s.id === sheet.id);
  const svgRef = useRef<SVGSVGElement>(null);
  const view = useViewport(svgRef, { initial: { x: 40, y: 40, k: 0.1 }, minK: 0.02, maxK: 1.2 });
  const { vp } = view;
  const analysis = getAnalysis(project);
  const drag = useRef<Drag | null>(null);
  const [labelText, setLabelText] = useState('');
  const crossSheet = useMemo(() => crossSheetLabelNames(project.schematic), [project.schematic]);
  const [textPrompt, setTextPrompt] = useState<{ at: Vec; value: string } | null>(null);
  const [marquee, setMarquee] = useState<{ a: Vec; b: Vec } | null>(null);
  const fitted = useRef<string | null>(null);
  const lastClick = useRef<{ t: number; x: number; y: number }>({ t: 0, x: 0, y: 0 });

  useEffect(() => {
    const key = project.id + ':' + sheet.id;
    if (fitted.current === key) return;
    fitted.current = key;
    const rects = sheet.components.map((c) => componentBounds(c));
    const u = unionRect(rects);
    setTimeout(() => { if (u) view.fit(u, 80); else if (paperSize(sheet.frame)) { const p = paperSize(sheet.frame)!; view.fit({ x: 0, y: 0, w: p.w, h: p.h }, 40); } else view.centerOn({ x: 4000, y: 2500 }, 0.1); }, 0);
  }, [project.id, sheet.id, sheet.components, sheet.frame, view]);

  useEffect(() => {
    if (!app.fitSeq) return;
    const bs = sheet.components.map((c) => componentBounds(c));
    const pts = [...sheet.wires.flatMap((w) => w.points), ...sheet.labels.map((l) => ({ x: l.x, y: l.y }))];
    if (!bs.length && !pts.length) { const p = paperSize(sheet.frame); if (p) view.fit({ x: 0, y: 0, w: p.w, h: p.h }, 40); return; }
    const xs = [...bs.map((b) => b.x), ...bs.map((b) => b.x + b.w), ...pts.map((p) => p.x)], ys = [...bs.map((b) => b.y), ...bs.map((b) => b.y + b.h), ...pts.map((p) => p.y)];
    view.fit({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }, 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.fitSeq]);
  useEffect(() => {
    if (app.flyTo && app.flyTo.space === 'sch') view.centerOn({ x: app.flyTo.x, y: app.flyTo.y }, Math.max(vp.k, 0.15));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.flyTo?.seq]);

  const openPins = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const p of analysis.netlist.unconnectedPins) { if (!m.has(p.componentId)) m.set(p.componentId, new Set()); m.get(p.componentId)!.add(p.pinNumber); }
    return m;
  }, [analysis]);
  const pinNets = useMemo(() => {
    const m = new Map<string, Map<string, string>>();
    for (const [k, v] of analysis.netlist.pinNet) { const [cid, pin] = k.split(':'); if (!m.has(cid)) m.set(cid, new Map()); m.get(cid)!.set(pin, v); }
    return m;
  }, [analysis]);

  // 自动结点：3 条以上端点重合，或端点落在其他导线中段
  const autoJunctions = useMemo(() => {
    const pts: Vec[] = [];
    const ends = new Map<string, number>();
    const keyOf = (p: Vec) => `${p.x},${p.y}`;
    for (const w of sheet.wires) for (const p of [w.points[0], w.points[w.points.length - 1]]) ends.set(keyOf(p), (ends.get(keyOf(p)) ?? 0) + 1);
    for (const [k, n] of ends) if (n >= 3) { const [x, y] = k.split(',').map(Number); pts.push({ x, y }); }
    for (const w of sheet.wires) for (const p of [w.points[0], w.points[w.points.length - 1]]) {
      for (const w2 of sheet.wires) { if (w2 === w) continue; for (let i = 0; i < w2.points.length - 1; i++) { const a = w2.points[i], b = w2.points[i + 1]; if (pointOnSeg(p, a, b, 0.5) && !(p.x === a.x && p.y === a.y) && !(p.x === b.x && p.y === b.y)) pts.push(p); } }
    }
    return pts;
  }, [sheet.wires]);

  const tool = app.schTool;
  const wireMode = tool === 'wire' || !!app.pendingPin;
  SCH_SNAP = app.schGrid;
  const placingSym = app.placing ? getSymbol(app.placing.symbolId) : null;
  const ghostOrigin = placingSym ? snapComponentOrigin(placingSym, app.cursorWorld) : null;
  const cursorSnap = gp(app.cursorWorld);

  const finishWireDraft = (end?: Vec) => {
    const d = app.wireDraft; if (!d) return;
    const pts = dedupe(end ? [...d, ...ortho(d[d.length - 1], end).slice(1)] : d);
    if (pts.length >= 2) editor.dispatch(sch.addWire(sheet.id, pts));
    app.patch({ wireDraft: null });
  };
  const finishBusDraft = () => { const d = app.busDraft; if (d && d.length >= 2) editor.dispatch(sch.addBus(sheet.id, d)); app.patch({ busDraft: null }); };

  const onBackgroundDown = (e: RPE<SVGSVGElement>) => {
    if (view.panStart(e)) return;
    if (e.button !== 0) return;
    const raw = view.toWorld(e.clientX, e.clientY);
    const p = gp(raw);
    const now = Date.now(); const dbl = now - lastClick.current.t < 350 && Math.abs(e.clientX - lastClick.current.x) < 4 && Math.abs(e.clientY - lastClick.current.y) < 4; lastClick.current = { t: now, x: e.clientX, y: e.clientY };
    if (app.pasting) {
      const r = sch.pasteClipboard(editor.project, sheet.id, app.pasting.clip, p);
      editor.dispatch(r.command);
      app.patch({ pasting: null, selection: r.ids });
      return;
    }
    if (app.placing && placingSym) {
      const r = sch.placeComponent(editor.project, { sheetId: sheet.id, symbolId: app.placing.symbolId, center: raw, value: app.placing.value, footprint: app.placing.footprint, rotation: app.placing.rotation, props: app.placing.props });
      editor.dispatch(r.command);
      app.patch({ selection: [r.id] });
      if (placingSym.power) app.stopPlacing();
      return;
    }
    if (tool === 'label') { app.patch({ labelPrompt: p }); setLabelText(''); return; }
    if (tool === 'junction') { editor.dispatch(sch.addJunction(sheet.id, p)); return; }
    if (tool === 'measure') { const m = app.measure ?? []; app.patch({ measure: m.length >= 2 ? [p] : [...m, p] }); return; }
    if (tool === 'bus') {
      const d = app.busDraft;
      if (!d) { app.patch({ busDraft: [p] }); return; }
      if (dbl) { finishBusDraft(); return; }
      app.patch({ busDraft: dedupe([...d, ...ortho(d[d.length - 1], p).slice(1)]) });
      return;
    }
    if (tool === 'draw') {
      if (app.drawMode === 'text') { setTextPrompt({ at: p, value: '' }); return; }
      const d = app.drawDraft;
      if (!d) { app.patch({ drawDraft: [p] }); return; }
      if (app.drawMode === 'rect') { editor.dispatch(sch.addGraphic(sheet.id, { kind: 'rect', a: d[0], b: p })); app.patch({ drawDraft: null }); return; }
      if (dbl) { if (d.length >= 2) editor.dispatch(sch.addGraphic(sheet.id, { kind: 'line', points: d })); app.patch({ drawDraft: null }); return; }
      app.patch({ drawDraft: [...d, p] });
      return;
    }
    if (tool === 'wire' || app.pendingPin) {
      if (app.pendingPin) {
        const c = sheet.components.find((x) => x.id === app.pendingPin!.componentId); const g = c && findPin(c, app.pendingPin!.pin);
        if (g) app.patch({ wireDraft: dedupe(ortho(g.end, p)), pendingPin: null });
        return;
      }
      const d = app.wireDraft;
      if (!d) { app.patch({ wireDraft: [p] }); return; }
      if (dbl) { finishWireDraft(); return; }
      const next = dedupe([...d, ...ortho(d[d.length - 1], p).slice(1)]);
      // 落在其他导线上 → 结束
      const onWire = sheet.wires.some((w) => w.points.some((_, i) => i < w.points.length - 1 && pointOnSeg(p, w.points[i], w.points[i + 1], 0.5)));
      if (onWire && next.length >= 2) { editor.dispatch(sch.addWire(sheet.id, next)); app.patch({ wireDraft: null }); return; }
      app.patch({ wireDraft: next });
      return;
    }
    if (app.pwrMenuOpen || app.drawMenuOpen) { app.patch({ pwrMenuOpen: false, drawMenuOpen: false }); return; }
    if (app.labelPrompt) { app.patch({ labelPrompt: null }); return; }
    drag.current = { kind: 'marquee', start: raw, add: e.shiftKey };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const onMove = (e: RPE<SVGSVGElement>) => {
    if (view.panMove(e)) return;
    const raw = view.toWorld(e.clientX, e.clientY);
    app.set('cursorWorld', raw);
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'marquee') { setMarquee({ a: d.start, b: raw }); return; }
    const cur = editor.project.schematic.sheets.find((s) => s.id === sheet.id)!;
    if (d.kind === 'comp') {
      const c = cur.components.find((x) => x.id === d.id); if (!c) return;
      const sym = getSymbol(c.symbolId);
      const origin = snapComponentOrigin(sym, { x: raw.x - d.dx + sym.width / 2, y: raw.y - d.dy + sym.height / 2 });
      if (origin.x !== c.x || origin.y !== c.y) {
        const ddx = origin.x - c.x, ddy = origin.y - c.y;
        const group = app.selection.includes(d.id) ? app.selection : [d.id];
        for (const gid of group) {
          const gc = cur.components.find((x) => x.id === gid);
          if (gc) editor.dispatch(sch.moveComponent(sheet.id, gid, { x: gc.x + ddx, y: gc.y + ddy }));
        }
      }
    } else if (d.kind === 'wirePt') {
      const w = cur.wires.find((x) => x.id === d.id); if (!w) return;
      const pts = [...w.points]; pts[d.index] = gp(raw);
      editor.dispatch(sch.setWirePoints(sheet.id, d.id, pts));
    } else if (d.kind === 'wireSeg') {
      const a = d.orig[d.index], b = d.orig[d.index + 1];
      const horiz = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
      const off = horiz ? G(raw.y - d.start.y) : G(raw.x - d.start.x);
      const pts = [...d.orig];
      pts[d.index] = horiz ? { x: a.x, y: a.y + off } : { x: a.x + off, y: a.y };
      pts[d.index + 1] = horiz ? { x: b.x, y: b.y + off } : { x: b.x + off, y: b.y };
      editor.dispatch(sch.setWirePoints(sheet.id, d.id, pts));
    } else if (d.kind === 'label') {
      const l = cur.labels.find((x) => x.id === d.id); if (!l) return;
      const nx = G(raw.x - d.dx), ny = G(raw.y - d.dy);
      if (nx !== l.x || ny !== l.y) { editor.dispatch(sch.deleteLabels(sheet.id, [l.id])); editor.dispatch(sch.addLabel(sheet.id, l.text, { x: nx, y: ny })); }
    } else if (d.kind === 'poly') {
      // 总线 / 线条整体平移（栅格对齐）
      const ox = G(raw.x - d.start.x), oy = G(raw.y - d.start.y);
      const pts = d.orig.map((q) => ({ x: q.x + ox, y: q.y + oy }));
      if (d.type === 'bus') editor.dispatch(sch.setBusPoints(sheet.id, d.id, pts)); else editor.dispatch(sch.updateGraphic(sheet.id, d.id, { points: pts }));
    } else if (d.kind === 'rectG') {
      const ox = G(raw.x - d.start.x), oy = G(raw.y - d.start.y);
      editor.dispatch(sch.updateGraphic(sheet.id, d.id, { a: { x: d.a.x + ox, y: d.a.y + oy }, b: { x: d.b.x + ox, y: d.b.y + oy } }));
    } else if (d.kind === 'point') {
      const nx = G(raw.x - d.dx), ny = G(raw.y - d.dy);
      if (d.type === 'junction') { const j = cur.junctions.find((x) => x.id === d.id); if (j && (j.x !== nx || j.y !== ny)) editor.dispatch(sch.moveJunction(sheet.id, d.id, { x: nx, y: ny })); }
      else { const g = (cur.graphics ?? []).find((x) => x.id === d.id); if (g && g.kind === 'text' && (g.x !== nx || g.y !== ny)) editor.dispatch(sch.updateGraphic(sheet.id, d.id, { x: nx, y: ny })); }
    }
  };

  const onUp = (e: RPE<SVGSVGElement>) => {
    if (view.panEnd(e)) return;
    const d = drag.current; drag.current = null;
    if (!d) return;
    if (d.kind === 'marquee') {
      setMarquee(null);
      const end = view.toWorld(e.clientX, e.clientY);
      const w = Math.abs(end.x - d.start.x), h = Math.abs(end.y - d.start.y);
      if (w * vp.k < 4 && h * vp.k < 4) { if (!d.add) app.patch({ selection: [], highlightNet: null, checkHighlight: null }); return; }
      const rect: Rect = { x: Math.min(d.start.x, end.x), y: Math.min(d.start.y, end.y), w, h };
      const inside = (b: Rect) => (end.x >= d.start.x ? contains(rect, b) : rectsOverlap(rect, b));
      const ids = [
        ...sheet.components.filter((c) => inside(componentBounds(c))).map((c) => c.id),
        ...sheet.wires.filter((wr) => inside(ptsBox(wr.points, 10))).map((wr) => wr.id),
        ...sheet.labels.filter((l) => inside({ x: l.x, y: l.y - 180, w: 120 + l.text.length * 70, h: 180 })).map((l) => l.id),
        ...(sheet.buses ?? []).filter((b) => inside(ptsBox(b.points, 20))).map((b) => b.id),
        ...(sheet.graphics ?? []).filter((g) => inside(g.kind === 'line' ? ptsBox(g.points) : g.kind === 'rect' ? ptsBox([g.a, g.b]) : { x: g.x, y: g.y - g.size, w: g.text.length * g.size * 0.6, h: g.size })).map((g) => g.id),
        ...sheet.junctions.filter((j) => inside({ x: j.x - 35, y: j.y - 35, w: 70, h: 70 })).map((j) => j.id)
      ];
      app.patch({ selection: d.add ? [...new Set([...app.selection, ...ids])] : ids, rightTab: ids.length ? (app.rightTab === 'lib' || app.rightTab === 'ai' ? app.rightTab : 'props') : app.rightTab });
      return;
    }
    editor.commit();
  };

  const selectId = (id: string, e: RPE<SVGElement>) => {
    const sel = e.shiftKey ? (app.selection.includes(id) ? app.selection.filter((x) => x !== id) : [...app.selection, id]) : app.selection.includes(id) ? app.selection : [id];
    app.patch({ selection: sel, rightTab: app.rightTab === 'lib' || app.rightTab === 'ai' ? app.rightTab : 'props', pendingPin: null, highlightNet: null });
  };
  const beginDrag = (label: string, dr: Drag, e: RPE<SVGElement>) => { e.stopPropagation(); drag.current = dr; editor.begin(label); };
  const editable = tool === 'select';

  const dblRef = useRef<{ t: number; id: string }>({ t: 0, id: '' });
  const isDbl = (id: string) => { const now = Date.now(); const d = now - dblRef.current.t < 350 && dblRef.current.id === id; dblRef.current = { t: now, id }; return d; };
  const onBodyDown = (id: string) => (e: RPE<SVGElement>) => {
    if (e.button !== 0 || view.spaceDown || !editable) return;
    const c = sheet.components.find((x) => x.id === id)!;
    const p = view.toWorld(e.clientX, e.clientY);
    if (isDbl(id)) { // 双击：就地改值（电源符号改网络名）
      e.stopPropagation();
      const sym = getSymbol(c.symbolId);
      const v = prompt(sym.power ? `${c.ref} 网络名` : `${c.ref} 的值`, c.value);
      if (v !== null && v.trim() && v !== c.value) editor.dispatch(sch.setComponentValue(sheet.id, c.id, v.trim()));
      return;
    }
    if (e.altKey) {
      // Option + 拖动：复制选中元件并拖动副本（macOS 习惯）
      e.stopPropagation();
      const ids = app.selection.includes(id) ? app.selection : [id];
      const clip = sch.copySelection(sheet, ids);
      editor.begin('复制并移动');
      const r = sch.pasteClipboard(editor.project, sheet.id, clip, clip.anchor);
      editor.dispatch(r.command);
      const idx = clip.components.findIndex((x) => x.id === id);
      const newId = r.ids[idx >= 0 ? idx : 0];
      const nc = editor.project.schematic.sheets.find((x) => x.id === sheet.id)!.components.find((x) => x.id === newId)!;
      app.patch({ selection: r.ids.filter((x) => editor.project.schematic.sheets.find((sh) => sh.id === sheet.id)!.components.some((cc) => cc.id === x)), rightTab: app.rightTab === 'lib' || app.rightTab === 'ai' ? app.rightTab : 'props' });
      drag.current = { kind: 'comp', id: newId, dx: p.x - nc.x, dy: p.y - nc.y };
      return;
    }
    selectId(id, e);
    beginDrag('移动元件', { kind: 'comp', id, dx: p.x - c.x, dy: p.y - c.y }, e);
  };
  /** 右键 / 触控板双指轻触：结束当前放置 / 粘贴 / 画线等，单手可完成。 */
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (app.pasting) app.patch({ pasting: null });
    else if (app.placing) app.stopPlacing();
    else if (app.wireDraft || app.busDraft || app.drawDraft || app.measure) app.patch({ wireDraft: null, busDraft: null, drawDraft: null, measure: null });
    else if (app.pendingPin) app.patch({ pendingPin: null });
    else if (app.labelPrompt) app.patch({ labelPrompt: null });
    else if (tool !== 'select') app.setSchTool('select');
    else app.patch({ selection: [], highlightNet: null });
  };
  const onWireDown = (w: Wire) => (e: RPE<SVGElement>) => {
    if (e.button !== 0 || view.spaceDown) return;
    if (tool === 'wire' || app.wireDraft) { // 从导线中段开始画新线
      e.stopPropagation();
      const p = gp(view.toWorld(e.clientX, e.clientY));
      if (app.wireDraft) finishWireDraft(p); else app.patch({ wireDraft: [p] });
      return;
    }
    if (!editable) return;
    const p = view.toWorld(e.clientX, e.clientY);
    const wasSole = app.selection.length === 1 && app.selection[0] === w.id;
    // 单击导线：高亮它所在的整个网络（状态栏显示网络名）
    const netOfWire = analysis.netlist.nets.find((n) => n.pins.some((pin) => w.points.some((pt) => Math.abs(pt.x - pin.pos.x) < 0.5 && Math.abs(pt.y - pin.pos.y) < 0.5))) ?? analysis.netlist.nets.find((n) => sheet.labels.some((l) => l.text === n.name && w.points.some((pt) => Math.abs(pt.x - l.x) < 0.5 && Math.abs(pt.y - l.y) < 0.5)));
    if (netOfWire && !wasSole) setTimeout(() => app.set('highlightNet', netOfWire.name), 0);
    selectId(w.id, e);
    if (wasSole) {
      let best = 0, bd = Infinity;
      for (let i = 0; i < w.points.length - 1; i++) { const dd = pointSegDist(p, w.points[i], w.points[i + 1]); if (dd < bd) { bd = dd; best = i; } }
      beginDrag('移动线段', { kind: 'wireSeg', id: w.id, index: best, start: p, orig: w.points }, e);
    } else e.stopPropagation();
  };
  const onWirePtDown = (id: string, index: number) => (e: RPE<SVGElement>) => { if (e.button !== 0) return; beginDrag('移动顶点', { kind: 'wirePt', id, index }, e); };
  const onLabelDown = (id: string) => (e: RPE<SVGElement>) => {
    if (e.button !== 0 || !editable) { if (e.button === 0) e.stopPropagation(); return; }
    const l = sheet.labels.find((x) => x.id === id)!; const p = view.toWorld(e.clientX, e.clientY);
    if (isDbl(id)) { e.stopPropagation(); const v = prompt('网络标签', l.text); if (v !== null && v.trim() && v.trim() !== l.text) { editor.begin('重命名标签'); editor.dispatch(sch.deleteLabels(sheet.id, [l.id])); editor.dispatch(sch.addLabel(sheet.id, v.trim(), { x: l.x, y: l.y })); editor.commit(); } return; }
    selectId(id, e); beginDrag('移动标签', { kind: 'label', id, dx: p.x - l.x, dy: p.y - l.y }, e);
  };
  const onSimpleDown = (id: string) => (e: RPE<SVGElement>) => { if (e.button !== 0 || !editable) return; e.stopPropagation(); selectId(id, e); };
  /** 总线 / 结点 / 图形：选中并开始拖动（整体平移）。 */
  const onMovableDown = (id: string) => (e: RPE<SVGElement>) => {
    if (e.button !== 0 || !editable) { if (e.button === 0) e.stopPropagation(); return; }
    const p = view.toWorld(e.clientX, e.clientY);
    selectId(id, e);
    const bus = (sheet.buses ?? []).find((b) => b.id === id);
    if (bus) { beginDrag('移动总线', { kind: 'poly', id, type: 'bus', start: p, orig: bus.points }, e); return; }
    const j = sheet.junctions.find((x) => x.id === id);
    if (j) { beginDrag('移动结点', { kind: 'point', id, type: 'junction', dx: p.x - j.x, dy: p.y - j.y }, e); return; }
    const g = (sheet.graphics ?? []).find((x) => x.id === id);
    if (!g) { e.stopPropagation(); return; }
    if (g.kind === 'line') beginDrag('移动线条', { kind: 'poly', id, type: 'graphic', start: p, orig: g.points }, e);
    else if (g.kind === 'rect') beginDrag('移动矩形', { kind: 'rectG', id, start: p, a: g.a, b: g.b }, e);
    else beginDrag('移动文字', { kind: 'point', id, type: 'text', dx: p.x - g.x, dy: p.y - g.y }, e);
  };

  const onPinDown = (componentId: string) => (pin: string, e: RPE<SVGElement>) => {
    if (e.button !== 0 || view.spaceDown) return;
    e.stopPropagation();
    if (app.placing || app.pasting) return;
    const c = sheet.components.find((x) => x.id === componentId); const g = c && findPin(c, pin);
    if (app.wireDraft && g) { finishWireDraft(g.end); return; }
    if (app.busDraft) return;
    if (app.pendingPin) {
      if (app.pendingPin.componentId === componentId && app.pendingPin.pin === pin) return;
      editor.dispatch(sch.connectPins(sheet.id, app.pendingPin, { componentId, pin }));
      app.patch({ pendingPin: null });
    } else {
      app.patch({ pendingPin: { componentId, pin }, pwrMenuOpen: false, cursorWorld: view.toWorld(e.clientX, e.clientY) });
    }
  };

  const pending = app.pendingPin ? (() => { const c = sheet.components.find((x) => x.id === app.pendingPin!.componentId); const g = c && findPin(c, app.pendingPin!.pin); return g ? previewRoute(g, cursorSnap) : null; })() : null;
  const step = gridStep(SCH_GRID, vp.k, 8);
  const gs = step * vp.k;
  const ercMarks = analysis.erc.items.filter((i) => i.location && (!i.sheetId || i.sheetId === sheet.id));
  const highlightPins = app.highlightNet ? analysis.netlist.nets.find((n) => n.name === app.highlightNet)?.pins ?? [] : [];
  const cursor = app.placing || app.pasting ? 'copy' : wireMode || tool === 'label' || tool === 'bus' || tool === 'junction' || tool === 'draw' || tool === 'measure' ? 'crosshair' : view.panning ? 'grabbing' : view.spaceDown ? 'grab' : 'default';
  const labelScreen = app.labelPrompt ? view.toScreen(app.labelPrompt) : null;
  const textScreen = textPrompt ? view.toScreen(textPrompt.at) : null;
  const submitLabel = () => { if (app.labelPrompt && labelText.trim()) editor.dispatch(sch.addLabel(sheet.id, labelText.trim(), app.labelPrompt)); app.patch({ labelPrompt: null }); };
  const submitText = () => { if (textPrompt && textPrompt.value.trim()) editor.dispatch(sch.addGraphic(sheet.id, { kind: 'text', x: textPrompt.at.x, y: textPrompt.at.y, text: textPrompt.value.trim(), size: 120 })); setTextPrompt(null); };
  const selWire = app.selection.length === 1 ? sheet.wires.find((w) => w.id === app.selection[0]) : undefined;
  const hs = 8 / vp.k;
  const pasteOffset = app.pasting ? { x: G(app.cursorWorld.x - app.pasting.clip.anchor.x), y: G(app.cursorWorld.y - app.pasting.clip.anchor.y) } : null;
  const mm = (v: number) => milToMm(v).toFixed(2);

  return (
    <div className="canvas-wrap sch">
      <svg ref={svgRef} className="stage" style={{ cursor }} onPointerDown={onBackgroundDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} onContextMenu={onContextMenu} fontFamily="Inter,'Noto Sans SC',sans-serif">
        <defs>
          <pattern id="sch-grid" width={gs} height={gs} patternUnits="userSpaceOnUse" x={vp.x % gs} y={vp.y % gs}>
            <circle cx={0.5} cy={0.5} r={step >= SCH_GRID * 5 ? 1.2 : 0.9} fill="#C9C6BE" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#sch-grid)" />
        <g transform={`translate(${vp.x} ${vp.y}) scale(${vp.k})`}>
          <SheetFrame project={project} sheetName={sheet.name} index={sheetIndex} total={project.schematic.sheets.length} frame={sheet.frame} />
          {/* 图形 */}
          {(sheet.graphics ?? []).map((g) => {
            const sel = app.selection.includes(g.id); const stroke = sel ? '#E5B800' : '#5B6472';
            if (g.kind === 'line') return <path key={g.id} d={pathD(g.points)} stroke={stroke} strokeWidth={14} fill="none" strokeLinecap="round" onPointerDown={onMovableDown(g.id)} style={{ cursor: editable ? 'move' : 'pointer' }} />;
            if (g.kind === 'rect') { const b = ptsBox([g.a, g.b]); return <rect key={g.id} x={b.x} y={b.y} width={b.w} height={b.h} stroke={stroke} strokeWidth={14} fill="rgba(91,100,114,.04)" strokeDasharray="60 30" onPointerDown={onMovableDown(g.id)} style={{ cursor: editable ? 'move' : 'pointer' }} />; }
            return <text key={g.id} x={g.x} y={g.y} fontSize={g.size} fill={sel ? '#B58900' : '#3A3835'} onPointerDown={onMovableDown(g.id)} style={{ cursor: editable ? 'move' : 'pointer' }}>{g.text}</text>;
          })}
          {/* 总线 */}
          {(sheet.buses ?? []).map((b) => <path key={b.id} d={pathD(b.points)} stroke={app.selection.includes(b.id) ? '#E5B800' : '#2C5AA0'} strokeWidth={44} fill="none" strokeLinejoin="round" strokeLinecap="round" onPointerDown={onMovableDown(b.id)} style={{ cursor: editable ? 'move' : 'pointer' }} />)}
          {/* 导线 */}
          {sheet.wires.map((w) => {
                        const inHl = app.highlightNet && highlightPins.some((p) => w.points.some((pt) => pt.x === p.pos.x && pt.y === p.pos.y));
            const sel = app.selection.includes(w.id);
            return <g key={w.id} onPointerDown={onWireDown(w)} style={{ cursor: editable ? 'pointer' : undefined }}>
              {sel && <path d={pathD(w.points)} stroke="rgba(255,216,77,.55)" strokeWidth={70} fill="none" strokeLinejoin="round" strokeLinecap="round" />}
              <path d={pathD(w.points)} stroke={inHl ? '#E5B800' : SCH_COLORS.wire} strokeWidth={inHl ? 30 : 16} fill="none" strokeLinejoin="round" strokeLinecap="round" />
              <path d={pathD(w.points)} stroke="transparent" strokeWidth={90} fill="none" />
            </g>;
          })}
          {autoJunctions.map((p, i) => <circle key={'aj' + i} cx={p.x} cy={p.y} r={35} fill={SCH_COLORS.junction} pointerEvents="none" />)}
          {sheet.junctions.map((j) => <circle key={j.id} cx={j.x} cy={j.y} r={app.selection.includes(j.id) ? 48 : 40} fill={app.selection.includes(j.id) ? '#E5B800' : SCH_COLORS.junction} onPointerDown={onMovableDown(j.id)} style={{ cursor: editable ? 'move' : 'pointer' }} />)}
          {/* 预览：引脚连线 / 自由画线 / 总线 / 图形 */}
          {pending && <path d={pathD(pending)} stroke="#3D8BFF" strokeWidth={16} strokeDasharray="50 40" fill="none" pointerEvents="none" />}
          {app.wireDraft && <path d={pathD([...app.wireDraft, ...ortho(app.wireDraft[app.wireDraft.length - 1], cursorSnap).slice(1)])} stroke="#3D8BFF" strokeWidth={16} strokeDasharray="50 40" fill="none" pointerEvents="none" />}
          {app.busDraft && <path d={pathD([...app.busDraft, ...ortho(app.busDraft[app.busDraft.length - 1], cursorSnap).slice(1)])} stroke="#2C5AA0" strokeWidth={44} strokeDasharray="80 60" fill="none" opacity={0.7} pointerEvents="none" />}
          {app.drawDraft && (app.drawMode === 'rect'
            ? (() => { const b = ptsBox([app.drawDraft[0], cursorSnap]); return <rect x={b.x} y={b.y} width={b.w} height={b.h} stroke="#5B6472" strokeWidth={14} strokeDasharray="60 30" fill="none" pointerEvents="none" />; })()
            : <path d={pathD([...app.drawDraft, cursorSnap])} stroke="#5B6472" strokeWidth={14} strokeDasharray="60 30" fill="none" pointerEvents="none" />)}
          {/* 标签 */}
          {sheet.labels.map((l) => (
            <g key={l.id} onPointerDown={onLabelDown(l.id)} style={{ cursor: editable ? 'move' : 'pointer' }}>
              {/* 网络标签：普通网络红色纯文字；GND 类画地符号；电源类画端口圆 */}
              {(() => { const lay = netLabelLayout(sheet, l, crossSheet); const sel = app.selection.includes(l.id); const tw = l.text.length * 62;
                const hx = lay.text.anchor === 'middle' ? lay.text.x - tw / 2 - 20 : lay.text.anchor === 'end' ? lay.text.x - tw - 20 : lay.text.x - 20;
                return <>
                  <rect x={Math.min(hx, l.x - 160)} y={Math.min(lay.text.y - 110, l.y - 60, ...lay.lines.flat().map((q) => q.y - 30))} width={Math.max(hx + tw + 40, l.x + 160) - Math.min(hx, l.x - 160)} height={Math.max(lay.text.y + 40, l.y + 60, ...lay.lines.flat().map((q) => q.y + 30)) - Math.min(lay.text.y - 110, l.y - 60, ...lay.lines.flat().map((q) => q.y - 30))} rx={20} fill={sel ? 'rgba(255,216,77,.35)' : 'transparent'} stroke={sel ? '#E5B800' : 'none'} strokeWidth={12} />
                  {lay.lines.map((ln, k) => <path key={k} d={ln.map((q, j) => `${j ? 'L' : 'M'}${q.x} ${q.y}`).join('')} stroke={SCH_COLORS.wire} strokeWidth={16} fill="none" strokeLinecap="round" />)}
                  {lay.circles.map((ci, k) => <circle key={'c' + k} cx={ci.c.x} cy={ci.c.y} r={ci.r} stroke={SCH_COLORS.wire} strokeWidth={16} fill={SCH_COLORS.fill} />)}
                  <text x={lay.text.x} y={lay.text.y} fontSize={100} fontFamily={lay.glyph === 'text' ? "'JetBrains Mono',monospace" : undefined} fill={lay.glyph === 'text' ? SCH_COLORS.netLabel : SCH_COLORS.text} textAnchor={lay.text.anchor}>{l.text}</text>
                </>; })()}
            </g>
          ))}
          {sheet.components.map((c) => (
            <SymbolGlyph key={c.id} comp={c} sym={getSymbol(c.symbolId)} selected={app.selection.includes(c.id)} wireMode={wireMode} openPins={openPins.get(c.id)} pinNets={pinNets.get(c.id)} highlightNet={app.highlightNet} onBodyDown={onBodyDown(c.id)} onPinDown={onPinDown(c.id)} />
          ))}
          {/* 选中导线的顶点手柄 */}
          {selWire && editable && selWire.points.map((p, i) => <rect key={i} x={p.x - hs / 2} y={p.y - hs / 2} width={hs} height={hs} fill="#fff" stroke="#E5B800" strokeWidth={hs / 5} style={{ cursor: 'crosshair' }} onPointerDown={onWirePtDown(selWire.id, i)} />)}
          {/* 测量 */}
          {app.measure && app.measure.length > 0 && (() => { const a = app.measure![0], b = app.measure![1] ?? cursorSnap; const d = Math.hypot(b.x - a.x, b.y - a.y); return (
            <g pointerEvents="none">
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#B58900" strokeWidth={14} strokeDasharray="40 30" />
              <circle cx={a.x} cy={a.y} r={30} fill="#B58900" /><circle cx={b.x} cy={b.y} r={30} fill="#B58900" />
              <g transform={`translate(${(a.x + b.x) / 2 + 80} ${(a.y + b.y) / 2 - 80})`}><rect x={0} y={-150} width={1900} height={200} rx={30} fill="#16181D" opacity={0.9} /><text x={40} y={0} fontSize={120} fill="#FFD84D" fontFamily="'JetBrains Mono',monospace">{`${mm(d)}mm ΔX ${mm(Math.abs(b.x - a.x))} ΔY ${mm(Math.abs(b.y - a.y))}`}</text></g>
            </g>); })()}
          {/* ERC 标记 */}
          {ercMarks.map((m) => (
            <g key={m.id} transform={`translate(${m.location!.x} ${m.location!.y})`} pointerEvents="none" opacity={app.checkHighlight && app.checkHighlight !== m.id ? 0.35 : 1}>
              {app.checkHighlight === m.id && <circle r={220} fill={m.severity === 'error' ? 'rgba(255,59,48,.18)' : 'rgba(255,176,32,.18)'} className="drc-pulse" />}
              <circle r={90} fill={m.severity === 'error' ? '#FF3B30' : '#FFB020'} opacity={0.9} />
              <text y={40} fontSize={120} fontWeight={700} fill="#fff" textAnchor="middle">{m.severity === 'error' ? '!' : '?'}</text>
            </g>
          ))}
          {/* 放置 / 粘贴 幽灵 */}
          {app.placing && placingSym && ghostOrigin && (
            <SymbolGlyph comp={{ id: 'ghost', ref: `${placingSym.prefix.replace('#', '')}${project.schematic.counters[placingSym.prefix] ?? 1}`, symbolId: placingSym.id, value: app.placing.value, footprint: '', x: ghostOrigin.x, y: ghostOrigin.y, rotation: app.placing.rotation, mirror: false, props: {} }} sym={placingSym} ghost />
          )}
          {app.pasting && pasteOffset && (
            <g transform={`translate(${pasteOffset.x} ${pasteOffset.y})`} pointerEvents="none">
              {app.pasting.clip.wires.map((w, i) => <path key={i} d={pathD(w.points)} stroke="#3D8BFF" strokeWidth={16} strokeDasharray="50 40" fill="none" />)}
              {app.pasting.clip.components.map((c) => <SymbolGlyph key={c.id} comp={c} sym={getSymbol(c.symbolId)} ghost />)}
              {app.pasting.clip.labels.map((l) => <text key={l.id} x={l.x + 20} y={l.y - 40} fontSize={100} fill="#3D8BFF" fontFamily="'JetBrains Mono',monospace">{l.text}</text>)}
            </g>
          )}
        </g>
        {marquee && (() => { const a = view.toScreen(marquee.a), b = view.toScreen(marquee.b); const ltr = marquee.b.x >= marquee.a.x; return <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} fill={ltr ? 'rgba(61,139,255,.12)' : 'rgba(52,199,89,.12)'} stroke={ltr ? '#3D8BFF' : '#34C759'} strokeWidth={1} strokeDasharray={ltr ? undefined : '4 3'} pointerEvents="none" />; })()}
      </svg>
      {labelScreen && app.labelPrompt && (
        <div className="label-prompt" style={{ left: labelScreen.x + 8, top: labelScreen.y - 40 }} onPointerDown={(e) => e.stopPropagation()}>
          <input autoFocus value={labelText} placeholder="网络名，如 SDA" onChange={(e) => setLabelText(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') submitLabel(); if (e.key === 'Escape') app.patch({ labelPrompt: null }); }} />
          <button className="btn sm primary" onClick={submitLabel}>放置</button>
        </div>
      )}
      {textScreen && textPrompt && (
        <div className="label-prompt" style={{ left: textScreen.x + 8, top: textScreen.y - 40 }} onPointerDown={(e) => e.stopPropagation()}>
          <input autoFocus value={textPrompt.value} placeholder="注释文字" onChange={(e) => setTextPrompt({ ...textPrompt, value: e.target.value })} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') submitText(); if (e.key === 'Escape') setTextPrompt(null); }} />
          <button className="btn sm primary" onClick={submitText}>放置</button>
        </div>
      )}
      {app.pasting && <div className="banner"><span className="dim">粘贴：</span>{app.pasting.clip.components.length} 个元件 · {app.pasting.clip.wires.length} 根导线 · 点击放置 · Esc 取消</div>}
      {app.busDraft && <div className="banner"><span style={{ color: '#4D7FC4' }}>■</span>总线 · 点击加点 · 双击结束 · 连到总线的导线用标签命名（如 D0、D1）</div>}
      {editable && app.selection.filter((id) => sheet.components.some((c) => c.id === id)).length >= 2 && (
        <div className="banner" style={{ gap: 6, width: 'max-content' }} onPointerDown={(e) => e.stopPropagation()}>
          <span className="dim">对齐 {app.selection.filter((id) => sheet.components.some((c) => c.id === id)).length} 个元件</span>
          {([['left', '左'], ['hcenter', '水平居中'], ['right', '右'], ['top', '上'], ['vcenter', '垂直居中'], ['bottom', '下'], ['hdist', '水平等距'], ['vdist', '垂直等距']] as const).map(([m, label]) => <button key={m} className="btn sm" onClick={() => editor.dispatch(sch.alignComponents(sheet.id, app.selection.filter((id) => sheet.components.some((c) => c.id === id)), m))}>{label}</button>)}
        </div>
      )}
      <Hint space="sch" />
      {sheet.components.length === 0 && !app.placing && !app.pasting && (
        <div className="empty-state">
          <div style={{ color: '#6B6B6B' }}>空白图纸 · 从这里开始</div>
          <div className="row" style={{ gap: 12 }}>
            <button className="btn xl primary" style={{ boxShadow: '0 4px 14px rgba(61,139,255,.35)' }} onClick={() => app.setSchTool('place')}>放置第一个元件 <span className="mono" style={{ opacity: .8 }}>A</span></button>
            <button className="btn xl light" onClick={() => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.kicad_sch,.kicad_pcb,.kicad_pro,.SchDoc,.PcbDoc,.zip,.json'; i.multiple = true; i.onchange = () => { if (i.files?.length) void import('../../store/backup.js').then((m) => m.importProjectFiles(Array.from(i.files!))); }; i.click(); }}>导入 KiCad / Altium</button>
            <button className="btn xl light" onClick={() => app.set('rightTab', 'ai')}><span style={{ color: 'var(--ai)' }}>✨</span>用 AI 生成起点</button>
          </div>
          <div style={{ color: '#8A8A8A', fontSize: 12 }}>小技巧：按 <b className="mono">R</b> / <b className="mono">C</b> / <b className="mono">D</b> 直接放电阻 / 电容 / LED</div>
        </div>
      )}
    </div>
  );
}
