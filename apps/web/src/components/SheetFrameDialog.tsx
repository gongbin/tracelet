import { useState } from 'react';
import { sch, PAPER_SIZES, paperSize, type SheetFrame } from '@tracelet/kernel';
import { useEditor, useSheet } from '../store/app.js';

const mm = (mil: number) => Math.round(mil * 0.0254);
const mil = (v: number) => Math.round(v / 0.0254);

/** 图纸边框 / 标题栏设置：纸张（含自定义长宽）、标题栏文字与标签文字。 */
export function SheetFrameDialog({ close }: { close: () => void }) {
  const editor = useEditor();
  const sheet = useSheet();
  const f = sheet.frame;
  const size = paperSize(f) ?? PAPER_SIZES.A4;
  const [w, setW] = useState(String(mm(f.width ?? size.w)));
  const [h, setH] = useState(String(mm(f.height ?? size.h)));
  const set = (patch: Partial<SheetFrame>) => editor.dispatch(sch.setSheetFrame(sheet.id, patch));
  const commitSize = () => { const W = Number(w), H = Number(h); if (W >= 50 && H >= 50 && W <= 2000 && H <= 2000) set({ size: 'custom', width: mil(W), height: mil(H) }); };
  const Field = ({ k, label, placeholder }: { k: keyof Pick<SheetFrame, 'title' | 'company' | 'revision' | 'author' | 'date' | 'comment'>; label: string; placeholder?: string }) => (
    <><span className="k">{label}</span><input className="input" defaultValue={f[k]} placeholder={placeholder} onBlur={(e) => { if (e.target.value !== f[k]) set({ [k]: e.target.value } as Partial<SheetFrame>); }} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /></>
  );
  const labels = f.labels;
  const setLabel = (k: keyof typeof labels, v: string) => set({ labels: { ...labels, [k]: v } });
  return (
    <div className="overlay" onClick={close}>
      <div className="dialog" style={{ width: 520 }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <div className="dialog-head"><div><div style={{ fontWeight: 600, fontSize: 15 }}>图纸边框与标题栏</div><div className="small muted" style={{ marginTop: 2 }}>当前图纸「{sheet.name}」· 每页可单独设置</div></div><span className="ml-auto muted" style={{ cursor: 'pointer', fontSize: 16 }} onClick={close}>✕</span></div>
        <div className="dialog-body kv" style={{ gap: '10px 12px' }}>
          <span className="k">纸张</span>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {(['A5', 'A4', 'A3', 'A2', 'A1', 'custom', 'none'] as const).map((sz) => <span key={sz} className={`chip${f.size === sz ? ' on' : ''}`} onClick={() => sz === 'custom' ? set({ size: 'custom', width: f.width ?? size.w, height: f.height ?? size.h }) : set({ size: sz })}>{sz === 'custom' ? '自定义' : sz === 'none' ? '无边框' : sz}</span>)}
          </div>
          {f.size !== 'none' && f.size !== 'custom' && <><span className="k">方向</span><div className="seg sm" style={{ width: 120 }}><span className={`seg-opt${f.landscape ? ' on' : ''}`} onClick={() => set({ landscape: true })}>横向</span><span className={`seg-opt${!f.landscape ? ' on' : ''}`} onClick={() => set({ landscape: false })}>纵向</span></div></>}
          {f.size === 'custom' && <><span className="k">长 × 宽 (mm)</span><div className="row" style={{ gap: 6 }}><input className="input mono" style={{ width: 90 }} value={w} onChange={(e) => setW(e.target.value)} onBlur={commitSize} onKeyDown={(e) => { if (e.key === 'Enter') commitSize(); }} /><span className="muted">×</span><input className="input mono" style={{ width: 90 }} value={h} onChange={(e) => setH(e.target.value)} onBlur={commitSize} onKeyDown={(e) => { if (e.key === 'Enter') commitSize(); }} /><span className="dim xs">50–2000 mm</span></div></>}
          <span className="k" style={{ gridColumn: '1 / -1', marginTop: 6 }}>标题栏内容（留空使用默认）</span>
          <Field k="title" label="标题" placeholder="默认：项目名" />
          <Field k="company" label="公司 / 作者单位" placeholder="默认：Tracelet" />
          <Field k="author" label="作者" />
          <Field k="revision" label="版本" />
          <Field k="date" label="日期" placeholder="默认：最近保存日期" />
          <Field k="comment" label="备注" />
          <span className="k" style={{ gridColumn: '1 / -1', marginTop: 6 }}>标签文字（可改成英文）</span>
          {(['sheet', 'date', 'revision', 'page', 'author'] as const).map((k) => <span key={k} className="row" style={{ gap: 6, gridColumn: 'span 1' }}><input className="input" style={{ width: 110 }} defaultValue={labels[k]} onBlur={(e) => { if (e.target.value !== labels[k]) setLabel(k, e.target.value); }} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /><span className="dim xs">{{ sheet: '图纸名', date: '日期', revision: '版本', page: '页码', author: '作者' }[k]}</span></span>)}
        </div>
        <div className="dialog-foot"><span className="xs dim">导出 PDF 时使用同样的边框与标题栏。</span><button className="btn lg primary ml-auto" onClick={close}>完成</button></div>
      </div>
    </div>
  );
}
