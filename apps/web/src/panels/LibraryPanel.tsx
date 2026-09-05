import { useMemo, useRef, useState } from 'react';
import { BUILTIN_PARTS, searchParts, getSymbol, findFootprint, BUILTIN_FOOTPRINTS, importLibraryFile, lib, LIBRARY_FILE_HINT, type Part, type SymbolDef, type FootprintDef } from '@tracelet/kernel';
import { useApp, useProject, useEditor } from '../store/app.js';
import { readFileText } from '../store/backup.js';
import { Icon } from '../components/Icon.js';
import { I } from '../icons.js';
import { CategoryFilter } from '../components/CategoryFilter.js';
import { SymbolThumb, FootprintThumb } from '../components/Thumbs.js';
import { FootprintGenerator } from '../components/FootprintGenerator.js';

const QUICK = [['R', '电阻', 'sym:R', '10kΩ', 'fp:R_0402'], ['C', '电容', 'sym:C', '100nF', 'fp:C_0402'], ['D', 'LED', 'sym:LED', '红 0603', 'fp:LED_0603']] as const;
type Tab = 'all' | 'project' | 'fav' | 'builtin';
const TABS: [Tab, string][] = [['all', '全部'], ['project', '项目库'], ['fav', '收藏'], ['builtin', '官方库']];

/** 统一的库条目：内置零件 / 项目内符号 / 仅封装。 */
interface Entry { id: string; name: string; maker: string; kind: string; description: string; symbolId?: string; footprintId: string; value: string; params: string; part?: Part; source: 'builtin' | 'project' | 'footprint' | 'generated' }

const partEntry = (p: Part): Entry => ({ id: p.id, name: p.mpn, maker: p.maker, kind: p.kind, description: p.description, symbolId: p.symbolId, footprintId: p.footprintId, value: p.value, params: p.params, part: p, source: 'builtin' });
const symEntry = (s: SymbolDef): Entry => ({ id: s.id, name: s.name, maker: s.source?.startsWith('kicad') ? 'KiCad' : s.source === 'ai-extract' ? 'AI 识别' : '项目', kind: s.kind, description: s.description, symbolId: s.id, footprintId: s.defaultFootprint, value: s.defaultValue || s.name, params: `${s.pins.length} 引脚${s.defaultFootprint ? ` · 封装 ${s.defaultFootprint.replace(/^fp:(kicad:|gen:)?/, '')}` : ''}`, source: 'project' });
const fpEntry = (f: FootprintDef, source: Entry['source']): Entry => ({ id: f.id, name: f.name, maker: source === 'generated' ? '参数化' : f.id.startsWith('fp:kicad') ? 'KiCad' : source === 'footprint' ? '项目' : '内置', kind: '封装', description: f.description, footprintId: f.id, value: f.name, params: `${f.pads.length} 焊盘 · ${f.body.w}×${f.body.h} mm`, source });

export function LibraryPanel() {
  const app = useApp();
  const project = useProject();
  const editor = useEditor();
  const [cat, setCat] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [gen, setGen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const q = app.libQuery.trim().toLowerCase();
  const onPcb = app.screen === 'pcb';

  const entries = useMemo(() => {
    const builtin = searchParts(app.libQuery, BUILTIN_PARTS, cat ?? undefined).map(partEntry);
    const match = (e: Entry) => !q || `${e.name} ${e.kind} ${e.description} ${e.params} ${e.maker}`.toLowerCase().includes(q);
    const projSyms = cat ? [] : project.library.symbols.filter((s) => !s.power || !s.id.startsWith('sym:kicad')).map(symEntry).filter(match);
    const projFps = cat ? [] : project.library.footprints.map((f) => fpEntry(f, f.id.startsWith('fp:gen:') ? 'generated' : 'footprint')).filter(match);
    const builtinFps = cat || !onPcb ? [] : BUILTIN_FOOTPRINTS.map((f) => fpEntry(f, 'builtin')).filter(match);
    const all = tab === 'builtin' ? [...builtin, ...builtinFps] : tab === 'project' ? [...projSyms, ...projFps] : [...builtin, ...projSyms, ...projFps, ...builtinFps];
    const list = tab === 'fav' ? [...builtin, ...projSyms, ...projFps, ...BUILTIN_FOOTPRINTS.map((f) => fpEntry(f, 'builtin'))].filter((e) => app.favorites.includes(e.id)) : all;
    // PCB 页优先显示可直接放到板上的封装
    return onPcb ? [...list.filter((e) => !e.symbolId), ...list.filter((e) => e.symbolId)] : list;
  }, [app.libQuery, q, cat, tab, project.library, app.favorites, onPcb]);
  const sel = entries.find((e) => e.id === app.libSelected) ?? entries[0];

  const placeSymbol = (e: Entry) => {
    if (!e.symbolId) return;
    if (app.screen !== 'sch') app.go('sch');
    app.startPlacing({ symbolId: e.symbolId, value: e.value, footprint: e.footprintId, props: e.part ? { mpn: e.part.mpn, lcsc: e.part.lcsc ?? '' } : {}, rotation: 0, partLabel: e.name });
  };
  const placeFootprint = (e: Entry) => {
    if (!e.footprintId || !findFootprint(e.footprintId)) { app.toast('该条目没有可用封装'); return; }
    if (app.screen !== 'pcb') app.go('pcb');
    app.setPcbTool('place'); app.patch({ pcbPlacing: { footprintId: e.footprintId, label: e.name, rotation: 0 }, rightTab: 'lib' });
    app.toast(`点击板面放置 ${e.name}（仅板级封装，R 旋转，右键 / Esc 结束）`);
  };
  const primary = (e: Entry) => (onPcb || !e.symbolId ? placeFootprint(e) : placeSymbol(e));

  const importFiles = async (files: File[]) => {
    const symbols: SymbolDef[] = [], footprints: FootprintDef[] = [], warnings: string[] = [];
    for (const f of files) {
      try { const r = importLibraryFile(f.name, await readFileText(f)); symbols.push(...r.symbols); footprints.push(...r.footprints); warnings.push(...r.warnings); }
      catch (err) { warnings.push(`${f.name}: ${(err as Error).message}`); }
    }
    if (symbols.length || footprints.length) { editor.dispatch(lib.addLibraryItems({ symbols, footprints })); setTab('project'); app.toast(`已导入 ${symbols.length} 个符号 · ${footprints.length} 个封装到项目库（可 Undo）`, 'success'); }
    for (const w of warnings.slice(0, 3)) app.toast(w, 'error');
    if (!symbols.length && !footprints.length && !warnings.length) app.toast('文件里没有可导入的符号 / 封装');
  };

  return (
    <div className="col" style={{ height: '100%', gap: 0, fontSize: 12 }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const fs = Array.from(e.dataTransfer.files); if (fs.length) void importFiles(fs); }}>
      {app.placing && (
        <div className="row" style={{ margin: '10px 12px 0', padding: '8px 10px', borderRadius: 4, background: 'rgba(61,139,255,.14)', border: '1px solid rgba(61,139,255,.5)' }}>
          <span className="dot" style={{ width: 8, height: 8, background: 'var(--accent)' }} />正在放置 <b className="mono" style={{ fontWeight: 500 }}>{app.placing.partLabel ?? app.placing.value}</b> · 点击画布放置，可连续放置
          <span className="ml-auto muted mono" style={{ cursor: 'pointer' }} onClick={() => app.stopPlacing()}>Esc</span>
        </div>
      )}
      {app.pcbPlacing && onPcb && (
        <div className="row" style={{ margin: '10px 12px 0', padding: '8px 10px', borderRadius: 4, background: 'rgba(61,139,255,.14)', border: '1px solid rgba(61,139,255,.5)' }}>
          <span className="dot" style={{ width: 8, height: 8, background: 'var(--accent)' }} />放到板上：<b className="mono" style={{ fontWeight: 500 }}>{app.pcbPlacing.label}</b> · 点击板面放置，R 旋转
          <span className="ml-auto muted mono" style={{ cursor: 'pointer' }} onClick={() => app.setPcbTool('select')}>Esc</span>
        </div>
      )}
      <div className="col" style={{ padding: '12px 12px 0', gap: 10 }}>
        <div className="row field input-focus-ring" style={{ height: 32, padding: '0 10px' }}>
          <Icon d={I.search} size={14} stroke={2} color="var(--text-2)" />
          <input className="mono grow" style={{ background: 'transparent', border: 0, color: 'var(--text)' }} placeholder={onPcb ? '封装名 · 型号 · 关键字' : '型号 · 参数 · 关键字'} value={app.libQuery} autoFocus onChange={(e) => app.set('libQuery', e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && sel) primary(sel); if (e.key === 'Escape') (e.target as HTMLInputElement).blur(); }} />
          {app.libQuery && <span className="dim" style={{ cursor: 'pointer' }} onClick={() => app.set('libQuery', '')}>✕</span>}
        </div>
        {!onPcb && <div className="row" style={{ gap: 6 }}><span className="dim xs">通用件</span>
          {QUICK.map(([k, label, symbolId, value, fp]) => <span key={k} className="chip row" style={{ gap: 6, padding: '3px 8px' }} onClick={() => app.startPlacing({ symbolId, value, footprint: fp, rotation: 0, partLabel: label })}><b className="mono" style={{ fontWeight: 500, color: 'var(--accent)' }}>{k}</b>{label}</span>)}
        </div>}
        <div className="lib-tabs">{TABS.map(([id, label]) => <span key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}{id === 'project' && (project.library.symbols.length + project.library.footprints.length) > 0 ? ` ${project.library.symbols.length + project.library.footprints.length}` : ''}{id === 'fav' && app.favorites.length ? ` ${app.favorites.length}` : ''}</span>)}<a className="ml-auto xs" href={`https://so.szlcsc.com/global.html?k=${encodeURIComponent(app.libQuery || sel?.name || '')}`} target="_blank" rel="noreferrer" title="在立创商城搜索（新窗口）">LCSC ↗</a></div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn sm" onClick={() => fileRef.current?.click()} title={LIBRARY_FILE_HINT}>⇪ 导入库（KiCad / 立创）</button>
          <button className="btn sm" onClick={() => setGen(true)}>⚙ 参数化封装</button>
          <input ref={fileRef} type="file" accept=".kicad_sym,.kicad_mod,.json" multiple hidden onChange={(e) => { const fs = e.target.files ? Array.from(e.target.files) : []; if (fs.length) void importFiles(fs); e.target.value = ''; }} />
        </div>
        {tab !== 'project' && <div style={{ paddingBottom: 4 }}><CategoryFilter value={cat} onChange={setCat} /></div>}
      </div>
      <div className="grow" style={{ overflow: 'auto', padding: 6 }}>
        {entries.map((e) => (
          <div key={e.id} className={`part-row${sel?.id === e.id ? ' on' : ''}`} onClick={() => app.set('libSelected', e.id)} onDoubleClick={() => primary(e)}>
            <div className="part-thumb">{e.symbolId ? <SymbolThumb sym={getSymbol(e.symbolId)} /> : <FootprintThumb fp={findFootprint(e.footprintId)!} size={30} />}</div>
            <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
              <div className="row" style={{ gap: 6 }}><div className="mono nowrap" style={{ fontWeight: 500 }}>{e.name}</div><span className="ml-auto" style={{ cursor: 'pointer', color: app.favorites.includes(e.id) ? 'var(--warning)' : 'var(--text-3)' }} title="收藏" onClick={(ev) => { ev.stopPropagation(); app.toggleFavorite(e.id); }}>{app.favorites.includes(e.id) ? '★' : '☆'}</span></div>
              <div className="muted nowrap">{e.maker} · {e.kind}{e.description ? ` · ${e.description}` : ''}</div>
              <div className="muted mono xs nowrap">{e.symbolId ? `封装 ${findFootprint(e.footprintId)?.name ?? (e.footprintId ? e.footprintId.replace(/^fp:(kicad:)?/, '') + '（同步时映射）' : '未指定')}` : e.params}</div>
              {e.part && <div className="row xs" style={{ marginTop: 2 }}><span style={{ color: 'var(--success)' }}>{e.part.has3d ? '✓ 3D' : '— 3D'}</span><span style={{ color: 'var(--success)' }}>✓ 数据手册</span><span className="ml-auto">{e.part.price} {e.part.stock}</span></div>}
            </div>
          </div>
        ))}
        {entries.length === 0 && (
          <div className="col" style={{ padding: 12, gap: 8 }}>
            <div className="muted">{tab === 'fav' ? '还没有收藏：在条目右侧点 ☆' : tab === 'project' ? '项目库为空：导入 KiCad 库文件、参数化生成封装，或导入 KiCad 工程时自动带入' : `没有找到「${app.libQuery}」`}</div>
            <button className="btn" onClick={() => fileRef.current?.click()}>导入库文件（KiCad .kicad_sym / .kicad_mod，立创 EDA 符号 / 封装 JSON）</button>
            <button className="btn" onClick={() => setGen(true)}>参数化生成封装</button>
            <button className="btn ai" onClick={() => app.set('rightTab', 'ai')}>✨ 向 AI 描述让它画符号</button>
          </div>
        )}
        <div className="row dim xs" style={{ padding: '10px 8px 4px', gap: 6 }}><span style={{ color: 'var(--ai)' }}>✨</span>试试自然语言："能驱动 2A 电机的 H 桥"</div>
      </div>
      {sel && (
        <div className="col" style={{ flex: 'none', borderTop: '1px solid var(--border)', padding: 12, gap: 10 }}>
          <div className="kicker">预览 · {sel.name}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div style={{ height: 84, borderRadius: 4, background: 'var(--bg-canvas-sch)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{sel.symbolId ? <SymbolThumb sym={getSymbol(sel.symbolId)} size={70} /> : <span className="dim xs">仅封装</span>}</div>
            <div style={{ height: 84, borderRadius: 4, background: 'var(--bg-canvas)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{findFootprint(sel.footprintId) ? <FootprintThumb fp={findFootprint(sel.footprintId)!} /> : <span className="dim xs">同步时按名称映射</span>}</div>
          </div>
          <div className="muted" style={{ fontSize: 11.5 }}>{sel.params}{sel.description && sel.params !== sel.description ? ` · ${sel.description}` : ''}</div>
          <div className="row" style={{ gap: 6 }}>
            {sel.symbolId && <button className="btn primary grow" style={{ height: 30, justifyContent: 'center' }} onClick={() => placeSymbol(sel)}>{onPcb ? '放到原理图' : '放置'} <span className="mono" style={{ opacity: .7 }}>⏎</span></button>}
            {findFootprint(sel.footprintId) && <button className={`btn ${sel.symbolId ? '' : 'primary grow'}`} style={{ height: 30, justifyContent: 'center' }} title="仅板级封装：不出现在原理图 / BOM" onClick={() => placeFootprint(sel)}>{sel.symbolId ? '仅封装放到板上' : '放到板上'}</button>}
            {sel.source !== 'builtin' && <button className="btn" style={{ height: 30 }} title="从项目库移除" onClick={() => { editor.dispatch(lib.removeLibraryItems([sel.id])); app.toast('已从项目库移除（可 Undo）'); }}>移除</button>}
          </div>
        </div>
      )}
      {gen && <FootprintGenerator close={() => setGen(false)} />}
    </div>
  );
}
