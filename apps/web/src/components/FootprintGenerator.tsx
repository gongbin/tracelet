import { useMemo, useState } from 'react';
import { generateFootprint, validateSpec, lib, CHIP_SIZES, type FootprintSpec, type ChipSize } from '@tracelet/kernel';
import { useApp, useEditor } from '../store/app.js';
import { FootprintThumb } from './Thumbs.js';

type Kind = FootprintSpec['kind'];
const KINDS: [Kind, string, string][] = [['chip', '贴片两端', '电阻 / 电容 / 电感 / LED（0201–2512）'], ['soic', 'SOIC / TSSOP', '双列翼形'], ['qfp', 'LQFP / TQFP', '四边翼形'], ['qfn', 'QFN / DFN', '四边无引脚，可带散热焊盘'], ['dip', 'DIP', '双列直插'], ['header', '排针 / 排母', '2.54 / 2.0 / 1.27 mm'], ['sot23', 'SOT-23', '3 / 5 / 6 脚']];

/** 参数化封装生成器：改参数即时预览，一键加入项目库（可撤销），PCB 页可直接放到板上。 */
export function FootprintGenerator({ close }: { close: () => void }) {
  const app = useApp();
  const editor = useEditor();
  const [kind, setKind] = useState<Kind>('chip');
  const [p, setP] = useState<Record<string, number | string | boolean>>({ size: '0603', prefix: 'R', pins: 8, pitch: 1.27, rows: 1, cols: 4, headerPitch: 2.54, socket: false, sotPins: 3, body: 0, span: 0, thermal: 0, drill: 0.8, dipSpan: 7.62 });
  const num = (k: string, d = 0) => { const v = Number(p[k]); return Number.isFinite(v) && v > 0 ? v : d; };
  const spec: FootprintSpec = useMemo(() => {
    switch (kind) {
      case 'chip': return { kind, size: p.size as ChipSize, prefix: p.prefix as 'R' };
      case 'soic': return { kind, pins: num('pins', 8), pitch: num('pitch', 1.27), ...(num('body') ? { bodyW: num('body') } : {}), ...(num('span') ? { span: num('span') } : {}) };
      case 'qfp': return { kind, pins: num('pins', 48), pitch: num('pitch', 0.5), ...(num('body') ? { body: num('body') } : {}) };
      case 'qfn': return { kind, pins: num('pins', 32), pitch: num('pitch', 0.5), ...(num('body') ? { body: num('body') } : {}), ...(num('thermal') ? { thermal: num('thermal') } : {}) };
      case 'dip': return { kind, pins: num('pins', 8), span: num('dipSpan', 7.62), drill: num('drill', 0.8) };
      case 'header': return { kind, rows: (num('rows', 1) === 2 ? 2 : 1), cols: Math.round(num('cols', 4)), pitch: num('headerPitch', 2.54), socket: !!p.socket };
      case 'sot23': return { kind, pins: (num('sotPins', 3) as 3 | 5 | 6) };
    }
  }, [kind, p]);
  const error = validateSpec(spec);
  const def = useMemo(() => { try { return error ? null : generateFootprint(spec); } catch { return null; } }, [spec, error]);
  const set = (k: string, v: number | string | boolean) => setP((prev) => ({ ...prev, [k]: v }));
  const N = ({ k, label, step = 0.01, min = 0 }: { k: string; label: string; step?: number; min?: number }) => <><span className="k">{label}</span><input className="input mono" type="number" step={step} min={min} value={String(p[k] ?? '')} onChange={(e) => set(k, e.target.value)} onKeyDown={(e) => e.stopPropagation()} /></>;
  const add = (thenPlace: boolean) => {
    if (!def) return;
    editor.dispatch(lib.addLibraryItems({ footprints: [def] }));
    app.toast(`已加入项目库：${def.name}（${def.pads.length} 焊盘，可 Undo）`, 'success');
    if (thenPlace) { app.setPcbTool('place'); app.patch({ pcbPlacing: { footprintId: def.id, label: def.name, rotation: 0 } }); if (app.screen !== 'pcb') app.go('pcb'); }
    close();
  };
  return (
    <div className="overlay" onClick={close}>
      <div className="dialog" style={{ width: 640 }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <div className="dialog-head"><div><div style={{ fontWeight: 600, fontSize: 15 }}>参数化生成封装</div><div className="small muted" style={{ marginTop: 2 }}>命名与 KiCad 一致，pin 1 左上、逆时针编号；尺寸为通用值，量产前请按数据手册核对</div></div><span className="ml-auto muted" style={{ cursor: 'pointer', fontSize: 16 }} onClick={close}>✕</span></div>
        <div className="dialog-body row" style={{ gap: 18, alignItems: 'flex-start' }}>
          <div className="col" style={{ gap: 4, width: 150, flex: 'none' }}>
            {KINDS.map(([k, name, desc]) => <div key={k} className={`next-step${kind === k ? ' on' : ''}`} style={{ background: kind === k ? 'var(--bg-raised)' : undefined }} onClick={() => { setKind(k); const d: Record<string, number> = { soic: 8, qfp: 48, qfn: 32, dip: 8 }; if (d[k] && !(p.pins && Number(p.pins) % (k === 'qfp' || k === 'qfn' ? 4 : 2) === 0 && Number(p.pins) >= (k === 'qfp' || k === 'qfn' ? 8 : 4))) set('pins', d[k]); if (k === 'qfp' || k === 'qfn') { if (Number(p.pitch) > 0.8) set('pitch', 0.5); } else if (k === 'soic' && Number(p.pitch) < 0.6) set('pitch', 1.27); }}><div><div>{name}</div><div className="dim xs">{desc}</div></div></div>)}
          </div>
          <div className="kv grow" style={{ gap: '8px 10px' }}>
            {kind === 'chip' && <>
              <span className="k">尺寸</span><div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>{(Object.keys(CHIP_SIZES) as ChipSize[]).map((sz) => <span key={sz} className={`chip mono${p.size === sz ? ' on' : ''}`} onClick={() => set('size', sz)}>{sz}</span>)}</div>
              <span className="k">类型前缀</span><div className="row" style={{ gap: 4 }}>{['R', 'C', 'L', 'LED', 'D', 'F'].map((x) => <span key={x} className={`chip mono${p.prefix === x ? ' on' : ''}`} onClick={() => set('prefix', x)}>{x}</span>)}</div>
            </>}
            {(kind === 'soic' || kind === 'qfp' || kind === 'qfn') && <><N k="pins" label="引脚数" step={kind === 'soic' ? 2 : 4} min={4} /><N k="pitch" label="间距 (mm)" /><N k="body" label={kind === 'soic' ? '本体宽 (mm，0=默认)' : '本体边长 (mm，0=默认)'} /></>}
            {kind === 'soic' && <N k="span" label="焊盘中心距 (mm，0=默认)" />}
            {kind === 'qfn' && <N k="thermal" label="散热焊盘边长 (mm，0=默认)" />}
            {kind === 'dip' && <><N k="pins" label="引脚数" step={2} min={4} /><span className="k">列距</span><div className="row" style={{ gap: 4 }}>{[7.62, 10.16, 15.24].map((x) => <span key={x} className={`chip mono${Number(p.dipSpan) === x ? ' on' : ''}`} onClick={() => set('dipSpan', x)}>{x}</span>)}</div><N k="drill" label="钻孔 (mm)" /></>}
            {kind === 'header' && <><span className="k">行数</span><div className="seg sm" style={{ width: 120 }}>{[1, 2].map((r) => <span key={r} className={`seg-opt${Number(p.rows) === r ? ' on' : ''}`} onClick={() => set('rows', r)}>{r} 排</span>)}</div><N k="cols" label="每排引脚数" step={1} min={1} /><span className="k">间距</span><div className="row" style={{ gap: 4 }}>{[2.54, 2.0, 1.27].map((x) => <span key={x} className={`chip mono${Number(p.headerPitch) === x ? ' on' : ''}`} onClick={() => set('headerPitch', x)}>{x}</span>)}</div><span className="k">类型</span><div className="seg sm" style={{ width: 140 }}><span className={`seg-opt${!p.socket ? ' on' : ''}`} onClick={() => set('socket', false)}>排针</span><span className={`seg-opt${p.socket ? ' on' : ''}`} onClick={() => set('socket', true)}>排母</span></div></>}
            {kind === 'sot23' && <><span className="k">引脚数</span><div className="row" style={{ gap: 4 }}>{[3, 5, 6].map((x) => <span key={x} className={`chip mono${Number(p.sotPins) === x ? ' on' : ''}`} onClick={() => set('sotPins', x)}>{x}</span>)}</div></>}
            <span className="k">预览</span>
            <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <div style={{ width: 120, height: 120, borderRadius: 4, background: 'var(--bg-canvas)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{def && <FootprintThumb fp={def} size={110} />}</div>
              <div className="col xs" style={{ gap: 4 }}>{def ? <><div className="mono" style={{ color: 'var(--text)' }}>{def.name}</div><div className="muted">{def.pads.length} 焊盘 · 本体 {def.body.w}×{def.body.h} mm · 高 {def.height} mm</div><div className="muted">{def.description}</div></> : <div style={{ color: 'var(--error)' }}>{error ?? '参数无效'}</div>}</div>
            </div>
          </div>
        </div>
        <div className="dialog-foot"><span className="xs dim">加入后在「项目库」标签里可见，随项目一起保存。</span><button className="btn lg ghost ml-auto" onClick={close}>取消</button>{app.screen === 'pcb' && <button className="btn lg" disabled={!def} onClick={() => add(true)}>加入并放到板上</button>}<button className="btn lg primary" disabled={!def} onClick={() => add(false)}>加入项目库</button></div>
      </div>
    </div>
  );
}
