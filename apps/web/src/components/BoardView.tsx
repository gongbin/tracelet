import { useEffect, useMemo, useRef, useState } from 'react';
import { LAYER_COLORS, boardBounds, footprintBody, footprintPads, type Board, type Layer, type Vec, type WorldPad, type ZoneFill } from '@tracelet/kernel';
import { useViewport } from '../hooks/useViewport.js';
import { useT } from '../i18n/index.js';

export type BoardRotation = 0 | 90 | 180 | 270;

/** 探针 / 焊点标记（世界坐标，mm）。 */
export interface BoardMarker {
  x: number;
  y: number;
  /** pos = 红表笔(+)，neg = 黑表笔(COM/−)，badge = 数字序号 */
  kind: 'pos' | 'neg' | 'badge';
  label?: string;
}

export interface BoardViewProps {
  board: Board;
  zones: ZoneFill[];
  /** 观察面：F = 正面，B = 背面（镜像显示，与实际翻转板子一致） */
  side: 'F' | 'B';
  rotation: BoardRotation;
  onSideChange?: (s: 'F' | 'B') => void;
  onRotationChange?: (r: BoardRotation) => void;
  /** 探针 / 序号标记 */
  markers?: BoardMarker[];
  /** 高亮的封装 id（外框 + 焊盘加亮，其余压暗） */
  highlightFootprints?: string[];
  /** 高亮的网络（走线 / 焊盘加亮，其余压暗） */
  highlightNets?: string[];
  /** 递增则视图自动适配到标记 / 高亮内容 */
  focusSeq?: number;
}

const ROTS: BoardRotation[] = [0, 90, 270, 180];
/** 焊盘内描边线宽（mm）：描边中心落在焊盘内侧半个线宽处，与铜皮边沿对齐。 */
const INSET_SW = 0.1;

/** 步骤侧栏位置偏好（质检 / 装配页共用，持久化到 localStorage）。 */
export function usePanelSide(): ['left' | 'right', (s: 'left' | 'right') => void] {
  const [side, setSide] = useState<'left' | 'right'>(() => { try { return localStorage.getItem('tracelet:panelSide') === 'left' ? 'left' : 'right'; } catch { return 'right'; } });
  return [side, (s) => { try { localStorage.setItem('tracelet:panelSide', s); } catch { /* ignore */ } setSide(s); }];
}

/** 每个项目的勾选进度（质检 / 装配共用，持久化到 localStorage）。 */
export function useCheckedSet(storageKey: string): [Set<string>, (id: string) => void, () => void] {
  const [done, setDone] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem(storageKey) ?? '[]') as string[]); } catch { return new Set(); } });
  useEffect(() => { try { setDone(new Set(JSON.parse(localStorage.getItem(storageKey) ?? '[]') as string[])); } catch { setDone(new Set()); } }, [storageKey]);
  const toggle = (id: string) => setDone((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); try { localStorage.setItem(storageKey, JSON.stringify([...next])); } catch { /* ignore */ } return next; });
  const clear = () => { setDone(new Set()); try { localStorage.setItem(storageKey, '[]'); } catch { /* ignore */ } };
  return [done, toggle, clear];
}

/** 焊盘内侧虚线描边：几何与焊盘铜皮边沿对齐（内描边）。 */
function PadInsetDash({ pd }: { pd: WorldPad }) {
  const half = INSET_SW / 2;
  if (pd.def.shape === 'circle' || pd.def.shape === 'oval') {
    return <ellipse className="pad-inset-dash" cx={pd.center.x} cy={pd.center.y} rx={Math.max(0.05, pd.rect.w / 2 - half)} ry={Math.max(0.05, pd.rect.h / 2 - half)} fill="none" stroke="#FFD84D" strokeWidth={INSET_SW} strokeDasharray="0.28 0.18" strokeLinecap="butt" pointerEvents="none" />;
  }
  const rx = pd.def.shape === 'roundrect' ? Math.max(0, Math.min(pd.rect.w, pd.rect.h) * 0.25 - half) : 0;
  return <rect className="pad-inset-dash" x={pd.rect.x + half} y={pd.rect.y + half} width={Math.max(0.05, pd.rect.w - INSET_SW)} height={Math.max(0.05, pd.rect.h - INSET_SW)} rx={rx} fill="none" stroke="#FFD84D" strokeWidth={INSET_SW} strokeDasharray="0.28 0.18" strokeLinecap="butt" pointerEvents="none" />;
}

/** 只读 PCB 视图：滚轮 / 双指缩放，空格或中键平移，支持正反面与旋转，用于质检 / 装配页。 */
export function BoardView(p: BoardViewProps) {
  const t = useT();
  const { board, zones, side, rotation } = p;
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number; id: number } | null>(null);
  const view = useViewport(svgRef, { initial: { x: 40, y: 40, k: 10 }, minK: 1, maxK: 300 });
  const { vp } = view;
  const bb = boardBounds(board);
  const c = { x: bb.x + bb.w / 2, y: bb.y + bb.h / 2 };
  const sx = side === 'B' ? -1 : 1;
  const swap = rotation === 90 || rotation === 270;
  /** 简洁模式：隐藏数字 / 边框 / 标签，只保留焊盘内描边闪烁虚线 */
  const [quiet, setQuiet] = useState(false);

  /** 世界坐标 → 旋转 / 镜像后的显示坐标（仍是 mm）。 */
  const mapPoint = (q: Vec): Vec => {
    let x = (q.x - c.x) * sx, y = q.y - c.y;
    const rad = (rotation * Math.PI) / 180;
    const cs = Math.cos(rad), sn = Math.sin(rad);
    [x, y] = [x * cs - y * sn, x * sn + y * cs];
    return { x: x + c.x, y: y + c.y };
  };

  const fitAll = () => {
    const w = swap ? bb.h : bb.w, h = swap ? bb.w : bb.h;
    view.fit({ x: c.x - w / 2 - 2, y: c.y - h / 2 - 2, w: w + 4, h: h + 4 }, 40);
  };

  // 项目 / 旋转 / 翻面变化时重新适配
  const fitKey = `${bb.x},${bb.y},${bb.w},${bb.h}:${rotation}:${side}`;
  useEffect(() => { const t0 = setTimeout(fitAll, 0); return () => clearTimeout(t0); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [fitKey]);

  // 标记变化时把视图中心移到标记范围；换步骤时恢复完整标记
  useEffect(() => {
    setQuiet(false);
    if (!p.focusSeq) return;
    const pts = (p.markers ?? []).map(mapPoint);
    if (!pts.length) { fitAll(); return; }
    const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    view.centerOn({ x: cx, y: cy });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.focusSeq]);

  const pads = useMemo(() => board.footprints.map((f) => ({ fp: f, pads: footprintPads(f, board) })), [board]);
  const flatPads = useMemo(() => pads.flatMap((x) => x.pads), [pads]);
  const hlFp = useMemo(() => new Set(p.highlightFootprints ?? []), [p.highlightFootprints]);
  const hlNet = useMemo(() => new Set(p.highlightNets ?? []), [p.highlightNets]);
  const dimming = !quiet && (hlFp.size > 0 || hlNet.size > 0);
  const fpOp = (id: string) => (!dimming || hlFp.has(id) ? 1 : 0.28);
  const netOp = (net: string) => (!dimming || hlNet.has(net) ? 1 : 0.28);

  const canQuiet = (p.markers?.some((m) => m.kind === 'badge' || m.kind === 'pos' || m.kind === 'neg') ?? false) || hlFp.size > 0 || hlNet.size > 0;

  /** 简洁模式下要描边的焊盘：高亮封装的全部焊盘，或探针落点所在焊盘 / 高亮网络焊盘。 */
  const quietPads = useMemo(() => {
    if (!quiet) return [] as WorldPad[];
    if (hlFp.size) return flatPads.filter((pd) => hlFp.has(pd.footprintId));
    const fromMarkers = new Set<WorldPad>();
    for (const m of p.markers ?? []) {
      if (m.kind !== 'pos' && m.kind !== 'neg') continue;
      const hit = flatPads.find((pd) => m.x >= pd.rect.x - 0.05 && m.x <= pd.rect.x + pd.rect.w + 0.05 && m.y >= pd.rect.y - 0.05 && m.y <= pd.rect.y + pd.rect.h + 0.05)
        ?? flatPads.reduce<{ pd: WorldPad | null; d: number }>((best, pd) => {
          const d = (pd.center.x - m.x) ** 2 + (pd.center.y - m.y) ** 2;
          return d < best.d ? { pd, d } : best;
        }, { pd: null, d: Infinity }).pd;
      if (hit) fromMarkers.add(hit);
    }
    if (fromMarkers.size) return [...fromMarkers];
    if (hlNet.size) return flatPads.filter((pd) => pd.net && hlNet.has(pd.net));
    return [];
  }, [quiet, hlFp, hlNet, flatPads, p.markers]);

  const zoom = (f: number) => {
    const svg = svgRef.current; if (!svg) return;
    const k = Math.max(1, Math.min(300, vp.k * f));
    const cxs = svg.clientWidth / 2, cys = svg.clientHeight / 2;
    const wx = (cxs - vp.x) / vp.k, wy = (cys - vp.y) / vp.k;
    view.setVp({ k, x: cxs - wx * k, y: cys - wy * k });
  };

  const visible = (l: Layer) => !board.hiddenLayers.includes(l);
  const boardTf = `translate(${c.x} ${c.y}) rotate(${rotation}) scale(${sx} 1) translate(${-c.x} ${-c.y})`;
  const textTf = (x: number, y: number) => `translate(${x} ${y}) scale(${sx} 1) rotate(${-rotation})`;
  const topCu = side === 'F' ? 'F.Cu' : 'B.Cu';

  const toggleQuiet = (e?: { stopPropagation(): void; preventDefault(): void }) => {
    e?.stopPropagation(); e?.preventDefault();
    setQuiet((q) => !q);
  };

  return (
    <div className="canvas-wrap pcb">
      <svg ref={svgRef} {...view.touchHandlers} className="stage" style={{ cursor: dragRef.current ? 'grabbing' : 'grab' }}
        onPointerDown={(e) => { if (view.panStart(e)) return; if (e.button === 0 && e.pointerType !== 'touch') { dragRef.current = { sx: e.clientX, sy: e.clientY, ox: vp.x, oy: vp.y, id: e.pointerId }; (e.currentTarget as Element).setPointerCapture(e.pointerId); } }}
        onPointerMove={(e) => { if (view.panMove(e)) return; const d = dragRef.current; if (d && d.id === e.pointerId) view.setVp({ ...vp, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }); }}
        onPointerUp={(e) => { if (view.panEnd(e)) return; if (dragRef.current?.id === e.pointerId) dragRef.current = null; }}
        onPointerLeave={(e) => { if (e.pointerType !== 'touch') { view.panEnd(e); dragRef.current = null; } }}
        fontFamily="'JetBrains Mono',monospace">
        <g transform={`translate(${vp.x} ${vp.y}) scale(${vp.k})`}>
          <g transform={boardTf}>
            <polygon points={board.outline.map((q) => `${q.x},${q.y}`).join(' ')} fill="#1F2229" stroke={LAYER_COLORS['Edge.Cuts']} strokeWidth={0.15} />
            {[...zones].sort((a, b) => (a.zone.layer === topCu ? 1 : 0) - (b.zone.layer === topCu ? 1 : 0)).filter((f) => visible(f.zone.layer)).map((f) => (
              <path key={f.zone.id} fillRule="evenodd" d={f.polygons.map((poly) => poly.map((ring) => ring.map((q, i) => `${i ? 'L' : 'M'}${q.x} ${q.y}`).join('') + 'Z').join('')).join('')}
                fill={LAYER_COLORS[f.zone.layer]} fillOpacity={0.3 * (f.zone.layer === topCu ? 1 : 0.45) * netOp(f.zone.net)} pointerEvents="none" />
            ))}
            {[...board.traces].sort((a, b) => (a.layer === topCu ? 1 : 0) - (b.layer === topCu ? 1 : 0)).filter((tr) => visible(tr.layer)).map((tr) => (
              <path key={tr.id} d={tr.points.map((q, i) => `${i ? 'L' : 'M'}${q.x} ${q.y}`).join('')} stroke={LAYER_COLORS[tr.layer]} strokeWidth={tr.width}
                opacity={(tr.layer === topCu ? 1 : 0.35) * netOp(tr.net)} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            ))}
            {pads.map(({ fp, pads: ps }) => {
              const body = footprintBody(fp);
              const silk: Layer = fp.side === 'F' ? 'F.Silk' : 'B.Silk';
              const onSide = fp.side === side;
              const hl = !quiet && hlFp.has(fp.id);
              return (
                <g key={fp.id} opacity={fpOp(fp.id) * (onSide ? 1 : 0.35)}>
                  {hl && <rect x={body.x - 0.6} y={body.y - 0.6} width={body.w + 1.2} height={body.h + 1.2} rx={0.3} fill="rgba(255,216,77,.12)" stroke="#FFD84D" strokeWidth={0.2} />}
                  <rect x={body.x} y={body.y} width={body.w} height={body.h} fill="transparent" stroke={LAYER_COLORS[silk]} strokeWidth={0.12} opacity={onSide ? 1 : 0.5} />
                  {ps.map((pd, i) => {
                    const color = pd.through ? LAYER_COLORS[topCu] : LAYER_COLORS[pd.layers[0]];
                    const hlp = !quiet && hlNet.size > 0 && pd.net && hlNet.has(pd.net);
                    return <g key={i} opacity={(pd.through || pd.layers.includes(topCu) ? 1 : 0.35) * (hlNet.size && !quiet ? (hlp ? 1 : 0.35) : 1)}>
                      {(hlp || hl) && <rect x={pd.rect.x - 0.2} y={pd.rect.y - 0.2} width={pd.rect.w + 0.4} height={pd.rect.h + 0.4} rx={0.2} fill="rgba(255,216,77,.5)" />}
                      {pd.def.shape === 'circle' || pd.def.shape === 'oval'
                        ? <ellipse cx={pd.center.x} cy={pd.center.y} rx={pd.rect.w / 2} ry={pd.rect.h / 2} fill={pd.def.npth ? 'none' : color} stroke={pd.def.npth ? LAYER_COLORS['Edge.Cuts'] : 'none'} strokeWidth={0.1} />
                        : <rect x={pd.rect.x} y={pd.rect.y} width={pd.rect.w} height={pd.rect.h} rx={pd.def.shape === 'roundrect' ? Math.min(pd.rect.w, pd.rect.h) * 0.25 : 0} fill={color} />}
                      {pd.through && <circle cx={pd.center.x} cy={pd.center.y} r={pd.def.drill / 2} fill="#1A1D23" />}
                      <title>{`${fp.ref}.${pd.number}${pd.net ? ' · ' + pd.net : ''}`}</title>
                    </g>;
                  })}
                  <text transform={textTf(fp.x, body.h >= 4 ? fp.y + 0.5 : body.y - 0.35)} fontSize={body.h >= 4 ? 1.4 : 0.8} fill={hl ? '#FFD84D' : LAYER_COLORS[silk]} textAnchor="middle" pointerEvents="none" fontWeight={hl ? 700 : 400}>{fp.ref}</text>
                </g>
              );
            })}
            {board.vias.map((v) => (
              <g key={v.id} opacity={netOp(v.net)}>
                <circle cx={v.x} cy={v.y} r={v.size / 2} fill={LAYER_COLORS[topCu]} />
                <circle cx={v.x} cy={v.y} r={v.drill / 2} fill="#1A1D23" />
              </g>
            ))}
            {board.texts.filter((tx) => visible(tx.layer)).map((tx) => (
              <text key={tx.id} transform={textTf(tx.x, tx.y)} fontSize={tx.size * 1.2} fill={LAYER_COLORS[tx.layer]} textAnchor="middle" letterSpacing={0.1} opacity={(tx.layer === 'F.Silk') === (side === 'F') ? 1 : 0.4}>{tx.text}</text>
            ))}
            {/* 简洁模式：焊盘内描边虚线（与铜皮边沿对齐） */}
            {quietPads.map((pd, i) => <PadInsetDash key={`q${pd.footprintId}:${pd.number}:${i}`} pd={pd} />)}
          </g>
        </g>
        {/* 完整标记（简洁模式隐藏）；数字可点击切换简洁模式 */}
        {!quiet && (p.markers ?? []).map((m, i) => {
          const q = mapPoint({ x: m.x, y: m.y });
          const s = view.toScreen(q);
          if (m.kind === 'badge') {
            return (
              <g key={i} transform={`translate(${s.x} ${s.y})`} style={{ cursor: 'pointer' }}
                onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); dragRef.current = null; toggleQuiet(e); }}
                onClick={(e) => { e.stopPropagation(); }}>
                <title>{t('bv.quiet.toggleHint')}</title>
                <circle r={12} fill="transparent" />
                <circle r={9} fill="#FFD84D" stroke="#16181D" strokeWidth={1.5} />
                <text y={3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="#16181D" pointerEvents="none">{m.label}</text>
              </g>
            );
          }
          const pos = m.kind === 'pos';
          const color = pos ? '#FF3B30' : '#1A1D23';
          return (
            <g key={i} transform={`translate(${s.x} ${s.y})`} style={{ cursor: 'pointer' }}
              onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); dragRef.current = null; toggleQuiet(e); }}>
              <title>{t('bv.quiet.toggleHint')}</title>
              <circle r={16} fill="none" stroke={color} strokeWidth={2} opacity={0.9} className="drc-pulse" />
              <circle r={5} fill={color} stroke="#fff" strokeWidth={1.5} />
              <g transform="translate(0 -26)" pointerEvents="none">
                <rect x={-34} y={-11} width={68} height={17} rx={4} fill={color} stroke={pos ? 'none' : '#fff'} strokeWidth={pos ? 0 : 1} />
                <text y={2} textAnchor="middle" fontSize={10.5} fontWeight={600} fill="#fff">{pos ? t('bv.probe.pos') : t('bv.probe.neg')}</text>
              </g>
              {m.label && <text y={22} textAnchor="middle" fontSize={10} fill={pos ? '#FF6B60' : '#C7CBD4'} fontWeight={600} pointerEvents="none" style={{ paintOrder: 'stroke', stroke: '#16181D', strokeWidth: 3 }}>{m.label}</text>}
            </g>
          );
        })}
      </svg>
      <div className="float boardview-ctl" style={{ right: 12, top: 12, gap: 6, padding: 4 }}>
        {p.onSideChange && (
          <span className="seg sm" style={{ height: 24 }}>
            {(['F', 'B'] as const).map((s) => <span key={s} className={`seg-opt${side === s ? ' on' : ''}`} style={{ padding: '0 10px' }} onClick={() => p.onSideChange!(s)}>{s === 'F' ? t('bv.side.front') : t('bv.side.back')}</span>)}
          </span>
        )}
        {p.onRotationChange && (
          <button className="btn sm" title={t('bv.rotate', { deg: rotation })} onClick={() => p.onRotationChange!(ROTS[(ROTS.indexOf(rotation) + 1) % 4])}>⟳ {rotation}°</button>
        )}
        {canQuiet && (
          <button className={`btn sm${quiet ? ' primary' : ''}`} title={t('bv.quiet.toggleHint')} onClick={() => setQuiet((q) => !q)}>
            {quiet ? t('bv.quiet.off') : t('bv.quiet.on')}
          </button>
        )}
        <button className="btn sm" title={t('bv.zoomIn')} onClick={() => zoom(1.35)}>＋</button>
        <button className="btn sm" title={t('bv.zoomOut')} onClick={() => zoom(1 / 1.35)}>－</button>
        <button className="btn sm" title={t('bv.fit')} onClick={fitAll}>⤢</button>
      </div>
      <div className="float" style={{ left: 12, bottom: 12 }}>
        <span>{side === 'F' ? t('bv.side.frontHint') : t('bv.side.backHint')}</span>
        <span className="dim">· {t('bv.navHint')}</span>
        {quiet && <span className="dim">· {t('bv.quiet.activeHint')}</span>}
      </div>
    </div>
  );
}
