import { useEffect, useMemo, useRef, useState, type PointerEvent as RPE } from 'react';
import { sch, getSymbol, findPin, previewRoute, snapComponentOrigin, componentBounds, SCH_GRID, snapTo, pointOnSeg, type Vec, type Rect } from '@tracelet/kernel';
import { useApp, useEditor, useProject } from '../../store/app.js';
import { getAnalysis } from '../../store/analysis.js';
import { useViewport, gridStep } from '../../hooks/useViewport.js';
import { Hint } from '../../components/Hint.js';
import { SymbolGlyph } from './SymbolGlyph.js';

function unionRect(rs: Rect[]): Rect | null {
  if (rs.length === 0) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const r of rs) { x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y); x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h); }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function SchematicCanvas() {
  const project = useProject();
  const editor = useEditor();
  const app = useApp();
  const sheet = project.schematic.sheets[0];
  const svgRef = useRef<SVGSVGElement>(null);
  const view = useViewport(svgRef, { initial: { x: 40, y: 40, k: 0.1 }, minK: 0.02, maxK: 1.2 });
  const { vp } = view;
  const analysis = getAnalysis(project);
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
  const [labelText, setLabelText] = useState('');
  const fitted = useRef<string | null>(null);

  // 首次打开：适配全部内容
  useEffect(() => {
    if (fitted.current === project.id) return;
    fitted.current = project.id;
    const rects = sheet.components.map((c) => componentBounds(c));
    const u = unionRect(rects);
    setTimeout(() => u ? view.fit(u, 80) : view.centerOn({ x: 4000, y: 2500 }, 0.1), 0);
  }, [project.id, sheet.components, view]);

  // 定位请求
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

  // 结点：导线端点落在其他导线中段，或 3 条以上端点重合
  const junctions = useMemo(() => {
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

  const wireMode = app.schTool === 'wire' || !!app.pendingPin;
  const placingSym = app.placing ? getSymbol(app.placing.symbolId) : null;
  const ghostOrigin = placingSym ? snapComponentOrigin(placingSym, app.cursorWorld) : null;

  const onBackgroundDown = (e: RPE<SVGSVGElement>) => {
    if (view.panStart(e)) return;
    if (e.button !== 0) return;
    const p = view.toWorld(e.clientX, e.clientY);
    if (app.placing && placingSym) {
      const r = sch.placeComponent(editor.project, { sheetId: sheet.id, symbolId: app.placing.symbolId, center: p, value: app.placing.value, footprint: app.placing.footprint, rotation: app.placing.rotation, props: app.placing.props });
      editor.dispatch(r.command);
      app.patch({ selection: [r.id] });
      if (placingSym.power) app.stopPlacing();
      return;
    }
    if (app.schTool === 'label') { app.patch({ labelPrompt: { x: snapTo(p.x, SCH_GRID), y: snapTo(p.y, SCH_GRID) } }); setLabelText(''); return; }
    if (app.pendingPin) { app.patch({ pendingPin: null }); return; }
    if (app.pwrMenuOpen) { app.patch({ pwrMenuOpen: false }); return; }
    if (app.labelPrompt) { app.patch({ labelPrompt: null }); return; }
    app.patch({ selection: [], highlightNet: null, checkHighlight: null });
  };

  const onMove = (e: RPE<SVGSVGElement>) => {
    if (view.panMove(e)) return;
    const p = view.toWorld(e.clientX, e.clientY);
    app.set('cursorWorld', p);
    const d = drag.current;
    if (d) {
      const c = editor.project.schematic.sheets[0].components.find((x) => x.id === d.id);
      if (!c) return;
      const sym = getSymbol(c.symbolId);
      const origin = snapComponentOrigin(sym, { x: p.x - d.dx + sym.width / 2, y: p.y - d.dy + sym.height / 2 });
      if (origin.x !== c.x || origin.y !== c.y) { d.moved = true; editor.dispatch(sch.moveComponent(sheet.id, d.id, origin)); }
    }
  };

  const onUp = (e: RPE<SVGSVGElement>) => {
    if (view.panEnd(e)) return;
    if (drag.current) { drag.current = null; editor.commit(); }
  };

  const onBodyDown = (id: string) => (e: RPE<SVGElement>) => {
    if (e.button !== 0 || view.spaceDown) return;
    e.stopPropagation();
    if (app.placing || app.schTool === 'wire' || app.schTool === 'label') return;
    const p = view.toWorld(e.clientX, e.clientY);
    const c = sheet.components.find((x) => x.id === id)!;
    drag.current = { id, dx: p.x - c.x, dy: p.y - c.y, moved: false };
    editor.begin('移动元件');
    app.patch({ selection: e.shiftKey ? [...new Set([...app.selection, id])] : [id], rightTab: app.rightTab === 'lib' || app.rightTab === 'ai' ? app.rightTab : 'props', pendingPin: null, highlightNet: null });
  };

  const onPinDown = (componentId: string) => (pin: string, e: RPE<SVGElement>) => {
    if (e.button !== 0 || view.spaceDown) return;
    e.stopPropagation();
    if (app.placing) return;
    if (app.pendingPin) {
      if (app.pendingPin.componentId === componentId && app.pendingPin.pin === pin) return;
      editor.dispatch(sch.connectPins(sheet.id, app.pendingPin, { componentId, pin }));
      app.patch({ pendingPin: null });
    } else {
      app.patch({ pendingPin: { componentId, pin }, pwrMenuOpen: false, cursorWorld: view.toWorld(e.clientX, e.clientY) });
    }
  };

  const pending = app.pendingPin ? (() => { const c = sheet.components.find((x) => x.id === app.pendingPin!.componentId); const g = c && findPin(c, app.pendingPin!.pin); return g ? previewRoute(g, { x: snapTo(app.cursorWorld.x, SCH_GRID), y: snapTo(app.cursorWorld.y, SCH_GRID) }) : null; })() : null;

  const step = gridStep(SCH_GRID, vp.k, 8);
  const gs = step * vp.k;
  const ercMarks = analysis.erc.items.filter((i) => i.location);
  const highlightPins = app.highlightNet ? analysis.netlist.nets.find((n) => n.name === app.highlightNet)?.pins ?? [] : [];
  const cursor = app.placing ? 'copy' : wireMode || app.schTool === 'label' ? 'crosshair' : view.panning ? 'grabbing' : view.spaceDown ? 'grab' : 'default';
  const labelScreen = app.labelPrompt ? view.toScreen(app.labelPrompt) : null;

  const submitLabel = () => {
    if (app.labelPrompt && labelText.trim()) editor.dispatch(sch.addLabel(sheet.id, labelText.trim(), app.labelPrompt));
    app.patch({ labelPrompt: null });
  };

  return (
    <div className="canvas-wrap sch">
      <svg ref={svgRef} className="stage" style={{ cursor }} onPointerDown={onBackgroundDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} onContextMenu={(e) => e.preventDefault()} fontFamily="Inter,'Noto Sans SC',sans-serif">
        <defs>
          <pattern id="sch-grid" width={gs} height={gs} patternUnits="userSpaceOnUse" x={vp.x % gs} y={vp.y % gs}>
            <circle cx={0.5} cy={0.5} r={step >= SCH_GRID * 5 ? 1.2 : 0.9} fill="#C9C6BE" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#sch-grid)" />
        <g transform={`translate(${vp.x} ${vp.y}) scale(${vp.k})`}>
          {sheet.wires.map((w) => {
            const isPwr = w.auto && w.auto.some((k) => { const c = sheet.components.find((x) => x.id === k.split(':')[0]); return c && c.symbolId === 'sym:PWR'; });
            const inHl = app.highlightNet && highlightPins.some((p) => w.points.some((pt) => pt.x === p.pos.x && pt.y === p.pos.y));
            return <path key={w.id} d={w.points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join('')} stroke={inHl ? '#E5B800' : isPwr ? '#C0392B' : '#1F5F2B'} strokeWidth={inHl ? 30 : 16} fill="none" strokeLinejoin="round" strokeLinecap="round" />;
          })}
          {junctions.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={35} fill="#1F5F2B" />)}
          {pending && <path d={pending.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join('')} stroke="#3D8BFF" strokeWidth={16} strokeDasharray="50 40" fill="none" />}
          {sheet.labels.map((l) => (
            <g key={l.id} onPointerDown={(e) => { e.stopPropagation(); app.patch({ selection: [l.id] }); }} style={{ cursor: 'pointer' }}>
              <path d={`M${l.x} ${l.y}L${l.x + 60} ${l.y - 60}H${l.x + 120 + l.text.length * 70}V${l.y - 180}H${l.x + 60}Z`} fill={app.selection.includes(l.id) ? 'rgba(255,216,77,.3)' : '#FFFFFF'} stroke="#2C5AA0" strokeWidth={12} />
              <text x={l.x + 90} y={l.y - 95} fontSize={100} fontFamily="'JetBrains Mono',monospace" fill="#2C5AA0">{l.text}</text>
            </g>
          ))}
          {sheet.components.map((c) => (
            <SymbolGlyph key={c.id} comp={c} sym={getSymbol(c.symbolId)} selected={app.selection.includes(c.id)} wireMode={wireMode} openPins={openPins.get(c.id)} pinNets={pinNets.get(c.id)} highlightNet={app.highlightNet} onBodyDown={onBodyDown(c.id)} onPinDown={onPinDown(c.id)} />
          ))}
          {ercMarks.map((m) => (
            <g key={m.id} transform={`translate(${m.location!.x} ${m.location!.y})`} pointerEvents="none" opacity={app.checkHighlight && app.checkHighlight !== m.id ? 0.35 : 1}>
              {app.checkHighlight === m.id && <circle r={220} fill={m.severity === 'error' ? 'rgba(255,59,48,.18)' : 'rgba(255,176,32,.18)'} className="drc-pulse" />}
              <circle r={90} fill={m.severity === 'error' ? '#FF3B30' : '#FFB020'} opacity={0.9} />
              <text y={40} fontSize={120} fontWeight={700} fill="#fff" textAnchor="middle">{m.severity === 'error' ? '!' : '?'}</text>
            </g>
          ))}
          {app.placing && placingSym && ghostOrigin && (
            <SymbolGlyph comp={{ id: 'ghost', ref: `${placingSym.prefix.replace('#', '')}${project.schematic.counters[placingSym.prefix] ?? 1}`, symbolId: placingSym.id, value: app.placing.value, footprint: '', x: ghostOrigin.x, y: ghostOrigin.y, rotation: app.placing.rotation, mirror: false, props: {} }} sym={placingSym} ghost />
          )}
        </g>
      </svg>
      {labelScreen && app.labelPrompt && (
        <div className="label-prompt" style={{ left: labelScreen.x + 8, top: labelScreen.y - 40 }} onPointerDown={(e) => e.stopPropagation()}>
          <input autoFocus value={labelText} placeholder="网络名，如 SDA" onChange={(e) => setLabelText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submitLabel(); if (e.key === 'Escape') app.patch({ labelPrompt: null }); }} />
          <button className="btn sm primary" onClick={submitLabel}>放置</button>
        </div>
      )}
      <Hint space="sch" />
      {sheet.components.length === 0 && !app.placing && (
        <div className="empty-state">
          <div style={{ color: '#6B6B6B' }}>空白图纸 · 从这里开始</div>
          <div className="row" style={{ gap: 12 }}>
            <button className="btn xl primary" style={{ boxShadow: '0 4px 14px rgba(61,139,255,.35)' }} onClick={() => app.setSchTool('place')}>放置第一个元件 <span className="mono" style={{ opacity: .8 }}>A</span></button>
            <button className="btn xl light" onClick={() => app.toast('KiCad 导入在下一里程碑接入')}>导入 KiCad</button>
            <button className="btn xl light" onClick={() => app.set('rightTab', 'ai')}><span style={{ color: 'var(--ai)' }}>✨</span>用 AI 生成起点</button>
          </div>
          <div style={{ color: '#8A8A8A', fontSize: 12 }}>小技巧：按 <b className="mono">R</b> / <b className="mono">C</b> / <b className="mono">D</b> 直接放电阻 / 电容 / LED</div>
        </div>
      )}
    </div>
  );
}
