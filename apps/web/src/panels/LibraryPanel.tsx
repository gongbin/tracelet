import { useMemo, useState } from 'react';
import { BUILTIN_PARTS, searchParts, getSymbol, findFootprint, type Part } from '@tracelet/kernel';
import { useApp } from '../store/app.js';
import { Icon } from '../components/Icon.js';
import { I } from '../icons.js';
import { CategoryFilter } from '../components/CategoryFilter.js';

const QUICK = [['R', '电阻', 'sym:R', '10kΩ', 'fp:R_0402'], ['C', '电容', 'sym:C', '100nF', 'fp:C_0402'], ['D', 'LED', 'sym:LED', '红 0603', 'fp:LED_0603']] as const;

export function LibraryPanel() {
  const app = useApp();
  const [cat, setCat] = useState<string | null>(null);
  const results = useMemo(() => searchParts(app.libQuery, BUILTIN_PARTS, cat ?? undefined), [app.libQuery, cat]);
  const sel = BUILTIN_PARTS.find((p) => p.id === app.libSelected) ?? results[0];
  const place = (p: Part) => {
    if (app.screen !== 'sch') app.go('sch');
    app.startPlacing({ symbolId: p.symbolId, value: p.value, footprint: p.footprintId, props: { mpn: p.mpn, lcsc: p.lcsc ?? '' }, rotation: 0, partLabel: p.mpn });
  };
  return (
    <div className="col" style={{ height: '100%', gap: 0, fontSize: 12 }}>
      {app.placing && (
        <div className="row" style={{ margin: '10px 12px 0', padding: '8px 10px', borderRadius: 4, background: 'rgba(61,139,255,.14)', border: '1px solid rgba(61,139,255,.5)' }}>
          <span className="dot" style={{ width: 8, height: 8, background: 'var(--accent)' }} />正在放置 <b className="mono" style={{ fontWeight: 500 }}>{app.placing.partLabel ?? app.placing.value}</b> · 点击画布放置，可连续放置
          <span className="ml-auto muted mono" style={{ cursor: 'pointer' }} onClick={() => app.stopPlacing()}>Esc</span>
        </div>
      )}
      <div className="col" style={{ padding: '12px 12px 0', gap: 10 }}>
        <div className="row field input-focus-ring" style={{ height: 32, padding: '0 10px' }}>
          <Icon d={I.search} size={14} stroke={2} color="var(--text-2)" />
          <input className="mono grow" style={{ background: 'transparent', border: 0, color: 'var(--text)' }} placeholder="型号 · 参数 · 关键字" value={app.libQuery} autoFocus onChange={(e) => app.set('libQuery', e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && sel) place(sel); if (e.key === 'Escape') (e.target as HTMLInputElement).blur(); }} />
          {app.libQuery && <span className="dim" style={{ cursor: 'pointer' }} onClick={() => app.set('libQuery', '')}>✕</span>}
        </div>
        <div className="row" style={{ gap: 6 }}><span className="dim xs">通用件</span>
          {QUICK.map(([k, label, symbolId, value, fp]) => <span key={k} className="chip row" style={{ gap: 6, padding: '3px 8px' }} onClick={() => app.startPlacing({ symbolId, value, footprint: fp, rotation: 0, partLabel: label })}><b className="mono" style={{ fontWeight: 500, color: 'var(--accent)' }}>{k}</b>{label}</span>)}
        </div>
        <div className="lib-tabs"><span className="on">全部</span><span>项目库</span><span>收藏</span><span>官方库</span><span>LCSC</span></div>
        <div style={{ paddingBottom: 4 }}><CategoryFilter value={cat} onChange={setCat} /></div>
      </div>
      <div className="grow" style={{ overflow: 'auto', padding: 6 }}>
        {results.map((p) => (
          <div key={p.id} className={`part-row${sel?.id === p.id ? ' on' : ''}`} onClick={() => app.set('libSelected', p.id)} onDoubleClick={() => place(p)}>
            <div className="part-thumb"><PartThumb part={p} /></div>
            <div className="col grow" style={{ gap: 2 }}>
              <div className="mono nowrap" style={{ fontWeight: 500 }}>{p.mpn}</div>
              <div className="muted">{p.maker} · {p.kind}</div>
              <div className="muted mono xs nowrap">封装 {findFootprint(p.footprintId)?.name ?? p.footprintId}</div>
              <div className="row xs" style={{ marginTop: 2 }}><span style={{ color: 'var(--success)' }}>{p.has3d ? '✓ 3D' : '— 3D'}</span><span style={{ color: 'var(--success)' }}>✓ 数据手册</span><span className="ml-auto">{p.price} {p.stock}</span></div>
            </div>
          </div>
        ))}
        {results.length === 0 && (
          <div className="col" style={{ padding: 12, gap: 8 }}>
            <div className="muted">没有找到「{app.libQuery}」</div>
            <button className="btn" onClick={() => app.toast('KiCad 库导入在下一里程碑')}>从 KiCad / EasyEDA 库文件导入</button>
            <button className="btn" onClick={() => app.toast('参数化封装生成在下一里程碑')}>参数化生成封装</button>
            <button className="btn ai" onClick={() => app.set('rightTab', 'ai')}>✨ 向 AI 描述让它画符号</button>
          </div>
        )}
        <div className="row dim xs" style={{ padding: '10px 8px 4px', gap: 6 }}><span style={{ color: 'var(--ai)' }}>✨</span>试试自然语言："能驱动 2A 电机的 H 桥"</div>
      </div>
      {sel && (
        <div className="col" style={{ flex: 'none', borderTop: '1px solid var(--border)', padding: 12, gap: 10 }}>
          <div className="kicker">预览 · {sel.mpn}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div style={{ height: 84, borderRadius: 4, background: 'var(--bg-canvas-sch)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><PartThumb part={sel} size={60} /></div>
            <div style={{ height: 84, borderRadius: 4, background: 'var(--bg-canvas)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FootprintThumb part={sel} /></div>
          </div>
          <div className="muted" style={{ fontSize: 11.5 }}>参数：{sel.params}</div>
          <div className="row"><button className="btn primary grow" style={{ height: 30, justifyContent: 'center' }} onClick={() => place(sel)}>放置 <span className="mono" style={{ opacity: .7 }}>⏎</span></button><button className="btn" style={{ height: 30 }} onClick={() => app.toast('收藏在下一里程碑')}>☆ 收藏</button></div>
        </div>
      )}
    </div>
  );
}

function PartThumb({ part, size = 30 }: { part: Part; size?: number }) {
  const sym = getSymbol(part.symbolId);
  const s = 30 / Math.max(sym.width + 400, sym.height + 400);
  const w = sym.width * s, h = sym.height * s, ox = 15 - w / 2, oy = 15 - h / 2;
  return (
    <svg width={size} height={size} viewBox="0 0 30 30">
      {sym.graphic === 'capacitor' ? <path d={`M15 ${oy}V${oy + h * .35}M${ox} ${oy + h * .35}H${ox + w}M${ox} ${oy + h * .65}H${ox + w}M15 ${oy + h * .65}V${oy + h}`} stroke="#7A1F1F" strokeWidth={1} fill="none" />
        : sym.graphic === 'led' ? <path d={`M${ox} 15H${ox + w * .2}M${ox + w * .2} ${oy + h * .1}L${ox + w * .75} 15L${ox + w * .2} ${oy + h * .9}ZM${ox + w * .75} ${oy + h * .1}V${oy + h * .9}M${ox + w * .75} 15H${ox + w}`} stroke="#7A1F1F" strokeWidth={1} fill="#fff" />
        : <rect x={ox} y={oy} width={w} height={h} fill="#fff" stroke="#7A1F1F" strokeWidth={1.2} />}
      {sym.pins.map((p, i) => { const L = 3; const x = p.side === 'L' ? ox : p.side === 'R' ? ox + w : ox + p.offset * s; const y = p.side === 'T' ? oy : p.side === 'B' ? oy + h : oy + p.offset * s; const dx = p.side === 'L' ? -L : p.side === 'R' ? L : 0, dy = p.side === 'T' ? -L : p.side === 'B' ? L : 0; return <path key={i} d={`M${x} ${y}l${dx} ${dy}`} stroke="#7A1F1F" strokeWidth={1} />; })}
    </svg>
  );
}

function FootprintThumb({ part }: { part: Part }) {
  const fp = findFootprint(part.footprintId);
  if (!fp) return null;
  const ext = Math.max(fp.body.w, fp.body.h, ...fp.pads.map((p) => Math.abs(p.x) + p.w / 2), ...fp.pads.map((p) => Math.abs(p.y) + p.h / 2)) * 2.4;
  return (
    <svg width={60} height={60} viewBox={`${-ext / 2} ${-ext / 2} ${ext} ${ext}`}>
      <rect x={-fp.body.w / 2} y={-fp.body.h / 2} width={fp.body.w} height={fp.body.h} fill="none" stroke="#F2F2F2" strokeWidth={ext / 120} />
      {fp.pads.map((p, i) => <rect key={i} x={p.x - p.w / 2} y={p.y - p.h / 2} width={p.w} height={p.h} fill="#C83434" />)}
    </svg>
  );
}
