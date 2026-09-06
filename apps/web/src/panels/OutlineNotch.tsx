import React, { useEffect, useMemo, useState } from 'react';
import { notchOutline, dist, pcb, type Vec } from '@tracelet/kernel';
import { useApp } from '../store/app.js';
import { useT } from '../i18n/index.js';

export function OutlineNotch({ outline, edge, setEdge, preview, close }: {
  outline: Vec[]; edge: number; setEdge: (edge: number) => void;
  preview: (points: Vec[] | null) => void; close: () => void;
}) {
  const t = useT();
  const [width, setWidth] = useState(5), [depth, setDepth] = useState(3), [offset, setOffset] = useState(5);
  const points = useMemo(() => { try { return notchOutline(outline, edge, offset, width, depth); } catch { return null; } }, [outline, edge, offset, width, depth]);
  useEffect(() => { preview(points); return () => preview(null); }, [points, preview]);
  return <div className="banner" data-no-translate style={{ top: 100, width: 'min(440px, calc(100% - 24px))', flexDirection: 'column', alignItems: 'stretch', whiteSpace: 'normal' }} onPointerDown={e => e.stopPropagation()} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
    <strong>{t('outline.notch.title')}</strong>
    <span>{t('outline.notch.hint')}</span>
    <select className="input" aria-label={t('outline.notch.edge')} value={edge} onChange={e => setEdge(Number(e.target.value))}>
      {outline.map((p, i) => <option key={i} value={i}>{i + 1}: ({p.x.toFixed(1)}, {p.y.toFixed(1)}) → ({outline[(i + 1) % outline.length].x.toFixed(1)}, {outline[(i + 1) % outline.length].y.toFixed(1)}) · {dist(p, outline[(i + 1) % outline.length]).toFixed(1)} mm</option>)}
    </select>
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      {[[t('outline.notch.offset'), offset, setOffset], [t('outline.notch.width'), width, setWidth], [t('outline.notch.depth'), depth, setDepth]].map(([label, value, setter]) => <label key={String(label)}>{String(label)} <input className="input mono" type="number" min="0.01" step="0.25" style={{ width: 78 }} value={value as number} onChange={e => (setter as (n: number) => void)(Number(e.target.value))} /></label>)}
    </div>
    {!points && <span role="alert">{t('outline.notch.invalid')}</span>}
    <span>{t('outline.notch.note')}</span>
    <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}><button className="btn" onClick={close}>{t('outline.notch.cancel')}</button><button className="btn primary" disabled={!points} onClick={() => { if (points) useApp.getState().editor?.dispatch(pcb.setOutline(points)); close(); }}>{t('outline.notch.apply')}</button></div>
  </div>;
}
