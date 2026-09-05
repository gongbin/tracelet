import { useEffect, useMemo, useRef, type PointerEvent as RPE } from 'react';
import { pcb, LAYER_COLORS, copperLayers, footprintPads, footprintBody, boardBounds, netClassFor, snapTo, PCB_GRID, dist, type Vec, type CopperLayer, type Layer, type WorldPad } from '@tracelet/kernel';
import { useApp, useEditor, useProject } from '../../store/app.js';
import { getAnalysis } from '../../store/analysis.js';
import { useViewport, gridStep } from '../../hooks/useViewport.js';
import { Hint } from '../../components/Hint.js';

/** 45° 约束：把 p 吸附到从 a 出发的 H/V/45° 方向上。 */
function snap45(a: Vec, p: Vec): Vec {
  const dx = p.x - a.x, dy = p.y - a.y;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax < 1e-9 && ay < 1e-9) return p;
  const ang = Math.atan2(dy, dx);
  const q = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.cos(ang - q) * Math.hypot(dx, dy);
  return { x: a.x + Math.cos(q) * len, y: a.y + Math.sin(q) * len };
}
const sg = (v: number) => snapTo(v, PCB_GRID);
const fmt = (v: number) => v.toFixed(2);

export function PcbCanvas() {
  const project = useProject();
  const editor = useEditor();
  const app = useApp();
  const board = project.board;
  const svgRef = useRef<SVGSVGElement>(null);
  const view = useViewport(svgRef, { initial: { x: 40, y: 40, k: 12 }, minK: 2, maxK: 200 });
  const { vp } = view;
  const analysis = getAnalysis(project);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const fitted = useRef<string | null>(null);
  const lastClick = useRef(0);

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
  const hl = app.highlightNet;
  const dimIf = (net: string) => (hl && net !== hl ? 0.25 : 1);

  const padAt = (p: Vec): WorldPad | null => {
    for (const { pads: ps } of pads) for (const pd of ps) if (p.x >= pd.rect.x && p.x <= pd.rect.x + pd.rect.w && p.y >= pd.rect.y && p.y <= pd.rect.y + pd.rect.h) return pd;
    return null;
  };

  const finishRoute = (extra?: Vec) => {
    const r = app.routing; if (!r) return;
    const pts = extra ? [...r.points, extra] : r.points;
    if (pts.length >= 2) editor.dispatch(pcb.addTrace({ layer: r.layer, net: r.net, width: r.width, points: pts }).command);
    app.patch({ routing: null });
  };

  const onBackgroundDown = (e: RPE<SVGSVGElement>) => {
    if (view.panStart(e)) return;
    if (e.button !== 0) return;
    const raw = view.toWorld(e.clientX, e.clientY);
    const p = { x: sg(raw.x), y: sg(raw.y) };
    const now = Date.now(); const dbl = now - lastClick.current < 350; lastClick.current = now;
    const tool = app.pcbTool;
    if (tool === 'route') {
      const pad = padAt(raw);
      if (!app.routing) {
        if (!pad) { app.toast('从一个焊盘开始走线'); return; }
        const nc = netClassFor(board, pad.net);
        const layer = pad.layers.includes(app.activeLayer) ? app.activeLayer : pad.layers[0];
        app.patch({ routing: { points: [pad.center], net: pad.net, layer, width: nc?.traceWidth ?? 0.25, startPad: { footprintId: pad.footprintId, number: pad.number } }, activeLayer: layer });
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
      editor.dispatch(pcb.addVia({ x: p.x, y: p.y, size: nc?.viaSize ?? 0.6, drill: nc?.viaDrill ?? 0.3, net: pad?.net ?? '' }));
      return;
    }
    if (tool === 'zone') {
      const d = app.zoneDraft ?? [];
      if (dbl && d.length >= 3) { editor.dispatch(pcb.addZone({ layer: app.activeLayer, net: 'GND', polygon: d })); app.patch({ zoneDraft: null }); return; }
      app.patch({ zoneDraft: [...d, p] });
      return;
    }
    if (tool === 'measure') {
      const m = app.measure ?? [];
      app.patch({ measure: m.length >= 2 ? [p] : [...m, p] });
      return;
    }
    if (tool === 'text') {
      const t = prompt('丝印文字', 'v1.0');
      if (t) editor.dispatch(pcb.addBoardText({ layer: 'F.Silk', text: t, x: p.x, y: p.y, size: 1 }));
      return;
    }
    if (tool === 'edge') { app.toast('板框尺寸请在「制造」页设置；异形板框在下一里程碑'); return; }
    if (tool === 'place') { app.toast('PCB 上直接放元件需要同步回原理图，下一里程碑；请在原理图放置后「同步到 PCB」'); return; }
    // select
    const pad = padAt(raw);
    if (pad && pad.net) { app.patch({ highlightNet: hl === pad.net ? null : pad.net, pcbSelection: [] }); return; }
    app.patch({ pcbSelection: [], highlightNet: null, checkHighlight: null });
  };

  const onMove = (e: RPE<SVGSVGElement>) => {
    if (view.panMove(e)) return;
    const p = view.toWorld(e.clientX, e.clientY);
    app.set('cursorWorld', p);
    const d = drag.current;
    if (d) editor.dispatch(pcb.moveFootprint(d.id, { x: sg(p.x - d.dx), y: sg(p.y - d.dy) }));
  };
  const onUp = (e: RPE<SVGSVGElement>) => {
    if (view.panEnd(e)) return;
    if (drag.current) { drag.current = null; editor.commit(); }
  };

  const onFootprintDown = (id: string) => (e: RPE<SVGElement>) => {
    if (e.button !== 0 || view.spaceDown) return;
    if (app.pcbTool === 'route' || app.pcbTool === 'via' || app.pcbTool === 'zone' || app.pcbTool === 'measure') return;
    e.stopPropagation();
    const f = board.footprints.find((x) => x.id === id)!;
    if (app.pcbTool === 'flip') { editor.dispatch(pcb.flipFootprint(id)); return; }
    const p = view.toWorld(e.clientX, e.clientY);
    drag.current = { id, dx: p.x - f.x, dy: p.y - f.y };
    editor.begin('移动封装');
    app.patch({ pcbSelection: [id], rightTab: app.rightTab === 'layers' || app.rightTab === 'props' || app.rightTab === null ? 'props' : app.rightTab, highlightNet: null });
  };
  const selectObj = (id: string) => (e: RPE<SVGElement>) => {
    if (app.pcbTool !== 'select' || e.button !== 0) return;
    e.stopPropagation();
    app.patch({ pcbSelection: [id], rightTab: 'props' });
  };

  const step = gridStep(PCB_GRID * 4, vp.k, 10);
  const gs = step * vp.k;
  const bb = boardBounds(board);
  const cursorSnap = { x: sg(app.cursorWorld.x), y: sg(app.cursorWorld.y) };
  const routePreview = app.routing ? snap45(app.routing.points[app.routing.points.length - 1], cursorSnap) : null;
  const drcMarks = analysis.drc.items.filter((i) => i.location && i.rule !== 'outside-board');
  const cursor = app.pcbTool === 'route' || app.pcbTool === 'zone' || app.pcbTool === 'measure' || app.pcbTool === 'via' ? 'crosshair' : view.panning ? 'grabbing' : view.spaceDown ? 'grab' : 'default';
  const hlItem = app.checkHighlight ? analysis.drc.items.find((i) => i.id === app.checkHighlight) : null;

  return (
    <div className="canvas-wrap pcb">
      <svg ref={svgRef} className="stage" style={{ cursor }} onPointerDown={onBackgroundDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} onContextMenu={(e) => e.preventDefault()} fontFamily="'JetBrains Mono',monospace">
        <defs>
          <pattern id="pcb-grid" width={gs} height={gs} patternUnits="userSpaceOnUse" x={vp.x % gs} y={vp.y % gs}><circle cx={0.5} cy={0.5} r={1} fill="#2A2F38" /></pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#pcb-grid)" />
        <g transform={`translate(${vp.x} ${vp.y}) scale(${vp.k})`}>
          {/* 板框 */}
          <polygon points={board.outline.map((p) => `${p.x},${p.y}`).join(' ')} fill="#1F2229" stroke={visible('Edge.Cuts') ? LAYER_COLORS['Edge.Cuts'] : 'transparent'} strokeWidth={0.15} />
          {/* 铺铜：轮廓虚线 + 实际填充（已避让异网络铜并移除孤岛） */}
          {board.zones.filter((z) => visible(z.layer)).map((z) => (
            <polygon key={z.id + ':o'} points={z.polygon.map((p) => `${p.x},${p.y}`).join(' ')} fill="transparent" stroke={app.pcbSelection.includes(z.id) ? '#FFD84D' : LAYER_COLORS[z.layer]} strokeWidth={0.1} strokeDasharray="0.5 0.4" opacity={opOf(z.layer)} onPointerDown={selectObj(z.id)} style={{ cursor: 'pointer' }} />
          ))}
          {analysis.zones.filter((f) => visible(f.zone.layer)).map((f) => (
            <path key={f.zone.id + ':f'} fillRule="evenodd" d={f.polygons.map((poly) => poly.map((ring) => ring.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join('') + 'Z').join('')).join('')} fill={LAYER_COLORS[f.zone.layer]} fillOpacity={0.35 * opOf(f.zone.layer) * dimIf(f.zone.net)} stroke="none" pointerEvents="none" />
          ))}
          {/* 走线（非当前层先画） */}
          {[...board.traces].sort((a, b) => (a.layer === app.activeLayer ? 1 : 0) - (b.layer === app.activeLayer ? 1 : 0)).filter((t) => visible(t.layer)).map((t) => {
            const d = t.points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join('');
            const sel = app.pcbSelection.includes(t.id), hlt = hl && t.net === hl;
            return <g key={t.id} onPointerDown={selectObj(t.id)} style={{ cursor: 'pointer' }}>
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
              <g key={fp.id} onPointerDown={onFootprintDown(fp.id)} style={{ cursor: 'move' }}>
                {sel && <rect x={body.x - 0.6} y={body.y - 0.6} width={body.w + 1.2} height={body.h + 1.2} rx={0.3} fill="rgba(255,216,77,.08)" stroke="#FFD84D" strokeWidth={0.15} />}
                {visible(silk) && <rect x={body.x} y={body.y} width={body.w} height={body.h} fill="transparent" stroke={LAYER_COLORS[silk]} strokeWidth={0.12} opacity={fp.side === 'F' ? 1 : 0.6} />}
                {ps.map((pd, i) => {
                  const color = pd.through ? LAYER_COLORS[app.activeLayer] : LAYER_COLORS[pd.layers[0]];
                  const hlp = hl && pd.net === hl;
                  return <g key={i} opacity={(pd.through || pd.layers.includes(app.activeLayer) ? 1 : app.otherLayerOpacity) * dimIf(pd.net)}>
                    {hlp && <rect x={pd.rect.x - 0.2} y={pd.rect.y - 0.2} width={pd.rect.w + 0.4} height={pd.rect.h + 0.4} rx={0.2} fill="rgba(255,216,77,.5)" />}
                    {pd.def.shape === 'circle' || pd.def.shape === 'oval'
                      ? <ellipse cx={pd.center.x} cy={pd.center.y} rx={pd.rect.w / 2} ry={pd.rect.h / 2} fill={color} />
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
            <g key={v.id} onPointerDown={selectObj(v.id)} style={{ cursor: 'pointer' }} opacity={dimIf(v.net)}>
              <circle cx={v.x} cy={v.y} r={v.size / 2} fill={app.pcbSelection.includes(v.id) ? '#FFD84D' : LAYER_COLORS[app.activeLayer]} />
              <circle cx={v.x} cy={v.y} r={v.drill / 2} fill="#1A1D23" />
            </g>
          ))}
          {/* 丝印文字 */}
          {board.texts.filter((t) => visible(t.layer)).map((t) => <text key={t.id} x={t.x} y={t.y} fontSize={t.size * 1.2} fill={LAYER_COLORS[t.layer]} textAnchor="middle" letterSpacing={0.1} onPointerDown={selectObj(t.id)}>{t.text}</text>)}
          {/* 飞线 */}
          <g stroke="#FFFFFF" strokeOpacity={0.45} strokeWidth={0.08} strokeDasharray="0.3 0.3">
            {analysis.ratsnest.lines.map((l, i) => <line key={i} x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} opacity={dimIf(l.net)} stroke={hl === l.net ? '#FFD84D' : undefined} />)}
          </g>
          {/* 走线预览 */}
          {app.routing && routePreview && (
            <g pointerEvents="none">
              <path d={app.routing.points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join('') + `L${routePreview.x} ${routePreview.y}`} stroke={LAYER_COLORS[app.routing.layer]} strokeWidth={app.routing.width} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
              <circle cx={routePreview.x} cy={routePreview.y} r={app.routing.width} fill="none" stroke="#fff" strokeWidth={0.06} />
            </g>
          )}
          {app.zoneDraft && app.zoneDraft.length > 0 && (
            <g pointerEvents="none">
              <polyline points={[...app.zoneDraft, cursorSnap].map((p) => `${p.x},${p.y}`).join(' ')} fill={LAYER_COLORS[app.activeLayer]} fillOpacity={0.12} stroke={LAYER_COLORS[app.activeLayer]} strokeWidth={0.1} strokeDasharray="0.4 0.3" />
              {app.zoneDraft.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={0.25} fill="#fff" />)}
            </g>
          )}
          {app.measure && app.measure.length > 0 && (() => { const a = app.measure![0], b = app.measure![1] ?? cursorSnap; const d = dist(a, b); return (
            <g pointerEvents="none">
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#FFD84D" strokeWidth={0.08} />
              <circle cx={a.x} cy={a.y} r={0.2} fill="#FFD84D" /><circle cx={b.x} cy={b.y} r={0.2} fill="#FFD84D" />
              <g transform={`translate(${(a.x + b.x) / 2 + 0.5} ${(a.y + b.y) / 2 - 0.5})`}><rect x={0} y={-1.4} width={11} height={1.8} rx={0.2} fill="#16181D" opacity={0.9} /><text x={0.4} y={0} fontSize={1.1} fill="#FFD84D">{`${fmt(d)}mm ΔX ${fmt(Math.abs(b.x - a.x))} ΔY ${fmt(Math.abs(b.y - a.y))}`}</text></g>
            </g>); })()}
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
      </svg>
      <div className="float" style={{ left: 12, top: 12 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: LAYER_COLORS[app.activeLayer] }} /><span>{app.activeLayer}</span><span className="dim">· 当前层 · 数字键 1–{cu.length} 切换</span>
      </div>
      {app.routing && (
        <div className="banner">
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: LAYER_COLORS[app.routing.layer] }} />
          走线中 <span className="mono">{app.routing.net || '无网络'}</span> · {app.routing.layer} · <span className="mono">{fmt(app.routing.width)}mm</span>
          <span className="dim">点击加点 · 双击或点同网络焊盘结束 · V 过孔换层 · Esc 取消</span>
        </div>
      )}
      <Hint space="pcb" />
      <div className="float" style={{ right: 12, top: 12 }}><span className="dim">板</span><span>{fmt(bb.w)}×{fmt(bb.h)} mm</span></div>
    </div>
  );
}
