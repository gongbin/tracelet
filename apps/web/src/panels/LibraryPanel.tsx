import { useMemo, useRef, useState, useEffect } from 'react';
import { allParts, searchParts, getSymbol, findFootprint, BUILTIN_FOOTPRINTS, importLibraryFile, lib, LIBRARY_FILE_HINT, type Part, type SymbolDef, type FootprintDef } from '@tracelet/kernel';
import { useApp, useProject, useEditor } from '../store/app.js';
import { Pager, pageSlice } from '../components/Pager.js';
import { readFileText } from '../store/backup.js';
import { Icon } from '../components/Icon.js';
import { I } from '../icons.js';
import { CategoryFilter } from '../components/CategoryFilter.js';
import { SymbolThumb, FootprintThumb } from '../components/Thumbs.js';
import { FootprintGenerator } from '../components/FootprintGenerator.js';
import { usePartsStore, DEFAULT_PARTS_URL } from '../store/partsStore.js';
import { useInventory, type InventoryItem } from '../store/inventory.js';
import { downloadFile } from '../store/backup.js';

const QUICK = [['R', '电阻', 'sym:R', '10kΩ', 'fp:R_0402'], ['C', '电容', 'sym:C', '100nF', 'fp:C_0402'], ['D', 'LED', 'sym:LED', '红 0603', 'fp:LED_0603']] as const;
type Tab = 'all' | 'project' | 'fav' | 'builtin' | 'inv';
const TABS: [Tab, string][] = [['all', '全部'], ['project', '项目库'], ['fav', '收藏'], ['inv', '我的库存'], ['builtin', '零件库']];

/** 统一的库条目：内置零件 / 项目内符号 / 仅封装。 */
interface Entry { id: string; name: string; maker: string; kind: string; description: string; symbolId?: string; footprintId: string; value: string; params: string; part?: Part; inv?: InventoryItem; source: 'builtin' | 'project' | 'footprint' | 'generated' | 'inventory' }

const partEntry = (p: Part): Entry => ({ id: p.id, name: p.mpn, maker: p.source === 'user' ? `我的 · ${p.maker}` : p.source === 'community' ? `社区 · ${p.maker}` : p.maker, kind: p.kind, description: p.description, symbolId: p.symbolId, footprintId: p.footprintId, value: p.value, params: p.params, part: p, source: 'builtin' });
const symEntry = (s: SymbolDef): Entry => ({ id: s.id, name: s.name, maker: s.source?.startsWith('kicad') ? 'KiCad' : s.source === 'ai-extract' ? 'AI 识别' : '项目', kind: s.kind, description: s.description, symbolId: s.id, footprintId: s.defaultFootprint, value: s.defaultValue || s.name, params: `${s.pins.length} 引脚${s.defaultFootprint ? ` · 封装 ${s.defaultFootprint.replace(/^fp:(kicad:|gen:)?/, '')}` : ''}`, source: 'project' });
const invEntry = (i: InventoryItem): Entry => ({ id: i.id, name: i.name, maker: i.location ? `库存 · ${i.location}` : '我的库存', kind: i.value || '元件', description: i.note ?? '', symbolId: i.symbolId || undefined, footprintId: i.footprintId, value: i.value || i.name, params: `数量 ${i.qty}${i.lcsc ? ` · LCSC ${i.lcsc}` : ''}${findFootprint(i.footprintId) ? ` · 封装 ${findFootprint(i.footprintId)!.name}` : i.footprintId ? ` · 封装 ${i.footprintId}` : ''}`, inv: i, source: 'inventory' });
const fpEntry = (f: FootprintDef, source: Entry['source']): Entry => ({ id: f.id, name: f.name, maker: source === 'generated' ? '参数化' : f.id.startsWith('fp:kicad') ? 'KiCad' : source === 'footprint' ? '项目' : '内置', kind: '封装', description: f.description, footprintId: f.id, value: f.name, params: `${f.pads.length} 焊盘 · ${f.body.w}×${f.body.h} mm`, source });

export function LibraryPanel() {
  const app = useApp();
  const project = useProject();
  const editor = useEditor();
  const [cat, setCat] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [gen, setGen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const inventory = useInventory();
  const q = app.libQuery.trim().toLowerCase();
  const onPcb = app.screen === 'pcb';

  const entries = useMemo(() => {
    const builtin = searchParts(app.libQuery, allParts(), cat ?? undefined).map(partEntry);
    const match = (e: Entry) => !q || `${e.name} ${e.kind} ${e.description} ${e.params} ${e.maker}`.toLowerCase().includes(q);
    const projSyms = cat ? [] : project.library.symbols.filter((s) => !s.power || !s.id.startsWith('sym:kicad')).map(symEntry).filter(match);
    const projFps = cat ? [] : project.library.footprints.map((f) => fpEntry(f, f.id.startsWith('fp:gen:') ? 'generated' : 'footprint')).filter(match);
    const builtinFps = cat || !onPcb ? [] : BUILTIN_FOOTPRINTS.map((f) => fpEntry(f, 'builtin')).filter(match);
    const inv = cat ? [] : inventory.items.map(invEntry).filter(match);
    const all = tab === 'builtin' ? [...builtin, ...builtinFps] : tab === 'project' ? [...projSyms, ...projFps] : tab === 'inv' ? inv : [...inv, ...builtin, ...projSyms, ...projFps, ...builtinFps];
    const list = tab === 'fav' ? [...inv, ...builtin, ...projSyms, ...projFps, ...BUILTIN_FOOTPRINTS.map((f) => fpEntry(f, 'builtin'))].filter((e) => app.favorites.includes(e.id)) : all;
    // PCB 页优先显示可直接放到板上的封装
    return onPcb ? [...list.filter((e) => !e.symbolId), ...list.filter((e) => e.symbolId)] : list;
  }, [app.libQuery, q, cat, tab, project.library, app.favorites, onPcb, inventory.items]);
  const [page, setPage] = useState(0);
  const LIB_PAGE = 60;
  useEffect(() => { setPage(0); }, [app.libQuery, cat, tab]);
  const pg = pageSlice(entries, page, LIB_PAGE);
  const sel = entries.find((e) => e.id === app.libSelected) ?? pg.shown[0];

  const placeSymbol = (e: Entry) => {
    if (!e.symbolId) { app.toast('这条库存没有指定符号：在库存里填符号 id（如 sym:R），或先从官方库放置再「加入库存」'); return; }
    if (!getSymbol(e.symbolId) || getSymbol(e.symbolId).source === 'missing') { app.toast(`符号 ${e.symbolId} 不存在`, 'error'); return; }
    if (app.screen !== 'sch') app.go('sch');
    app.startPlacing({ symbolId: e.symbolId, value: e.value, footprint: e.footprintId, props: e.part ? { mpn: e.part.mpn, lcsc: e.part.lcsc ?? '' } : e.inv ? { mpn: e.inv.name, ...(e.inv.lcsc ? { lcsc: e.inv.lcsc } : {}), ...(e.inv.location ? { stock: `${e.inv.qty}@${e.inv.location}` } : {}) } : {}, rotation: 0, partLabel: e.name });
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
          {tab === 'builtin' && <PartsTools />}
          {tab === 'inv' && <>
            <button className="btn sm" onClick={() => { const name = prompt('型号 / 名称（如 0603WAF1002T5E 或 10k 电阻）'); if (!name) return; const value = prompt('值（如 10kΩ）', '') ?? ''; const qty = Number(prompt('数量', '10') ?? 0) || 0; inventory.add({ name, value, symbolId: /电阻|res|\d+k|Ω/i.test(name + value) ? 'sym:R' : /电容|cap|[num]f/i.test(name + value) ? 'sym:C' : /led/i.test(name) ? 'sym:LED' : '', footprintId: '', qty, location: prompt('存放位置（可空）', '') ?? undefined }); }}>+ 手动添加</button>
            <button className="btn sm" onClick={() => csvRef.current?.click()} title="CSV 列：型号,值,符号,封装,LCSC,数量,位置,备注">⇪ 导入 CSV</button>
            <button className="btn sm" disabled={!inventory.items.length} onClick={() => downloadFile('tracelet-inventory.csv', '\ufeff' + inventory.exportCsv(), 'text/csv')}>⇩ 导出 CSV</button>
            <input ref={csvRef} type="file" accept=".csv,text/csv" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const n = inventory.importCsv(await f.text()); app.toast(`已导入 / 更新 ${n} 条库存`, 'success'); } e.target.value = ''; }} />
          </>}
        </div>
        {tab !== 'project' && <div style={{ paddingBottom: 4 }}><CategoryFilter value={cat} onChange={setCat} /></div>}
      </div>
      <div className="grow" style={{ overflow: 'auto', padding: 6 }}>
        {pg.shown.map((e) => (
          <div key={e.id} className={`part-row${sel?.id === e.id ? ' on' : ''}`} onClick={() => app.set('libSelected', e.id)} onDoubleClick={() => primary(e)}>
            <div className="part-thumb">{e.symbolId ? <SymbolThumb sym={getSymbol(e.symbolId)} /> : findFootprint(e.footprintId) ? <FootprintThumb fp={findFootprint(e.footprintId)!} size={30} /> : <span className="dim">▢</span>}</div>
            <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
              <div className="row" style={{ gap: 6 }}><div className="mono nowrap" style={{ fontWeight: 500 }}>{e.name}</div><span className="ml-auto" style={{ cursor: 'pointer', color: app.favorites.includes(e.id) ? 'var(--warning)' : 'var(--text-3)' }} title="收藏" onClick={(ev) => { ev.stopPropagation(); app.toggleFavorite(e.id); }}>{app.favorites.includes(e.id) ? '★' : '☆'}</span></div>
              <div className="muted nowrap">{e.maker} · {e.kind}{e.description ? ` · ${e.description}` : ''}</div>
              <div className="muted mono xs nowrap">{e.symbolId ? `封装 ${findFootprint(e.footprintId)?.name ?? (e.footprintId ? e.footprintId.replace(/^fp:(kicad:)?/, '') + '（同步时映射）' : '未指定')}` : e.params}</div>
              {e.part && <div className="row xs" style={{ marginTop: 2 }}><span style={{ color: 'var(--success)' }}>{e.part.has3d ? '✓ 3D' : '— 3D'}</span><span style={{ color: 'var(--success)' }}>✓ 数据手册</span><span className="ml-auto">{e.part.price} {e.part.stock}</span></div>}
            </div>
          </div>
        ))}
        <Pager page={pg.page} count={pg.count} total={entries.length} onChange={setPage} compact />
        {entries.length === 0 && (
          <div className="col" style={{ padding: 12, gap: 8 }}>
            <div className="muted">{tab === 'fav' ? '还没有收藏：在条目右侧点 ☆' : tab === 'inv' ? '库存为空：点「+ 手动添加」、导入 CSV，或在任意元件预览里点「+ 库存」' : tab === 'project' ? '项目库为空：导入 KiCad 库文件、参数化生成封装，或导入 KiCad 工程时自动带入' : `没有找到「${app.libQuery}」`}</div>
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
            <div style={{ height: 84, borderRadius: 4, background: 'var(--bg-canvas-sch)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{sel.symbolId ? <SymbolThumb sym={getSymbol(sel.symbolId)} size={70} /> : <span className="dim xs">{sel.inv ? '未指定符号' : '仅封装'}</span>}</div>
            <div style={{ height: 84, borderRadius: 4, background: 'var(--bg-canvas)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{findFootprint(sel.footprintId) ? <FootprintThumb fp={findFootprint(sel.footprintId)!} /> : <span className="dim xs">同步时按名称映射</span>}</div>
          </div>
          <div className="muted" style={{ fontSize: 11.5 }}>{sel.params}{sel.description && sel.params !== sel.description ? ` · ${sel.description}` : ''}</div>
          <div className="row" style={{ gap: 6 }}>
            {sel.symbolId && <button className="btn primary grow" style={{ height: 30, justifyContent: 'center' }} onClick={() => placeSymbol(sel)}>{onPcb ? '放到原理图' : '放置'} <span className="mono" style={{ opacity: .7 }}>⏎</span></button>}
            {findFootprint(sel.footprintId) && <button className={`btn ${sel.symbolId ? '' : 'primary grow'}`} style={{ height: 30, justifyContent: 'center' }} title="仅板级封装：不出现在原理图 / BOM" onClick={() => placeFootprint(sel)}>{sel.symbolId ? '仅封装放到板上' : '放到板上'}</button>}
            {sel.source !== 'builtin' && sel.source !== 'inventory' && <button className="btn" style={{ height: 30 }} title="从项目库移除" onClick={() => { editor.dispatch(lib.removeLibraryItems([sel.id])); app.toast('已从项目库移除（可 Undo）'); }}>移除</button>}
            {sel.source !== 'inventory' && <button className="btn" style={{ height: 30 }} title="记录到我的库存（数量 / 位置）" onClick={() => { const qty = Number(prompt(`「${sel.name}」库存数量`, '10') ?? 0) || 0; const location = prompt('存放位置（可空）', '') ?? ''; inventory.add({ name: sel.name, value: sel.value, symbolId: sel.symbolId ?? '', footprintId: sel.footprintId, lcsc: sel.part?.lcsc, qty, location: location || undefined }); app.toast('已加入我的库存', 'success'); setTab('inv'); }}>+ 库存</button>}
          </div>
          {sel.inv && <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span className="row mono xs" style={{ gap: 4 }}>数量<input className="input mono" style={{ width: 60, height: 22 }} key={sel.inv.qty} defaultValue={sel.inv.qty} onBlur={(e) => inventory.update(sel.inv!.id, { qty: Number(e.target.value) || 0 })} onKeyDown={(e) => e.stopPropagation()} /></span>
            <span className="row xs" style={{ gap: 4 }}>位置<input className="input" style={{ width: 90, height: 22 }} key={sel.inv.location} defaultValue={sel.inv.location ?? ''} onBlur={(e) => inventory.update(sel.inv!.id, { location: e.target.value || undefined })} onKeyDown={(e) => e.stopPropagation()} /></span>
            <span className="row mono xs" style={{ gap: 4 }}>符号<input className="input mono" style={{ width: 90, height: 22 }} key={sel.inv.symbolId} defaultValue={sel.inv.symbolId} placeholder="sym:R" onBlur={(e) => inventory.update(sel.inv!.id, { symbolId: e.target.value.trim() })} onKeyDown={(e) => e.stopPropagation()} /></span>
            <span className="row mono xs" style={{ gap: 4 }}>封装<input className="input mono" style={{ width: 110, height: 22 }} key={sel.inv.footprintId} defaultValue={sel.inv.footprintId} placeholder="fp:R_0603" onBlur={(e) => inventory.update(sel.inv!.id, { footprintId: e.target.value.trim() })} onKeyDown={(e) => e.stopPropagation()} /></span>
            <button className="btn sm" onClick={() => { inventory.remove(sel.inv!.id); app.set('libSelected', null); }}>删除</button>
          </div>}
        </div>
      )}
      {gen && <FootprintGenerator close={() => setGen(false)} />}
    </div>
  );
}


/** 零件库工具条：导入 CSV / JSON、手动录入、从网络更新、导出我的零件。 */
function PartsTools() {
  const app = useApp();
  const parts = usePartsStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ mpn: '', maker: '', description: '', package: '', pins: '', lcsc: '', value: '' });
  const [urlEdit, setUrlEdit] = useState(false);
  const download = (name: string, text: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })); a.download = name; a.click(); };
  const onFile = async (f: File) => {
    const text = await f.text(); const kind = /\.json$/i.test(f.name) ? 'json' : 'csv';
    const r = parts.importText(text, kind);
    app.toast(r.added ? `已导入 ${r.added} 个零件到「我的」${r.errors.length ? `，${r.errors.length} 行跳过` : ''}` : `没有导入：${r.errors[0] ?? '文件为空'}`, r.added ? 'success' : 'error');
  };
  const submit = () => {
    if (!form.mpn.trim()) { app.toast('型号不能为空', 'error'); return; }
    const r = parts.importText(JSON.stringify([{ mpn: form.mpn, maker: form.maker, description: form.description, package: form.package, pins: form.pins, lcsc: form.lcsc, value: form.value }]), 'json');
    if (r.added) { app.toast(`已录入 ${form.mpn}`, 'success'); setAdding(false); setForm({ mpn: '', maker: '', description: '', package: '', pins: '', lcsc: '', value: '' }); } else app.toast(r.errors[0] ?? '录入失败', 'error');
  };
  return (
    <div className="col" style={{ gap: 6, padding: '6px 0' }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void onFile(f); }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={() => fileRef.current?.click()} title="CSV 列：mpn/型号, maker/厂商, description/描述, package/封装, pins/引脚(数量或 1:VCC;2:GND), lcsc, value；也支持嘉立创 / LCSC 导出的表格">导入 CSV / JSON</button>
        <button className="btn sm" onClick={() => setAdding(!adding)}>+ 录入</button>
        <button className="btn sm" disabled={parts.busy} onClick={() => void parts.updateFromUrl().then((r) => app.toast(`社区零件库已更新：${r.count} 个零件${r.version ? ` · ${r.version}` : ''}`, 'success')).catch((e) => app.toast(`更新失败：${(e as Error).message}`, 'error'))}>{parts.busy ? '更新中…' : '从网络更新'}</button>
        {parts.user.length > 0 && <button className="btn sm quiet" onClick={() => download('my-parts.csv', parts.exportUser('csv'))}>导出我的（{parts.user.length}）</button>}
        <input ref={fileRef} type="file" accept=".csv,.json,text/csv,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onFile(f); }} />
      </div>
      <div className="dim xs" style={{ lineHeight: 1.6 }}>
        内置 {allParts().filter((p) => p.source === 'builtin').length} · 社区 {parts.community.length}{parts.meta.updatedAt ? `（${parts.meta.version ?? ''} ${new Date(parts.meta.updatedAt).toLocaleDateString()}）` : '（未更新）'} · 我的 {parts.user.length}
        <span style={{ cursor: 'pointer', marginLeft: 6, color: 'var(--accent)' }} onClick={() => setUrlEdit(!urlEdit)}>更新源</span>
        {parts.meta.lastError && <span style={{ color: 'var(--error)' }}> · 上次更新失败：{parts.meta.lastError}</span>}
      </div>
      {urlEdit && <div className="row" style={{ gap: 6 }}><input className="input mono xs" style={{ flex: 1 }} defaultValue={parts.meta.url} placeholder={DEFAULT_PARTS_URL} onBlur={(e) => parts.setUrl(e.target.value.trim() || DEFAULT_PARTS_URL)} /><span className="dim xs">JSON：{'{ version, parts: [...] }'}</span></div>}
      {adding && (
        <div className="col" style={{ gap: 4, padding: 8, border: '1px solid var(--border)', borderRadius: 6 }}>
          <div className="row" style={{ gap: 4 }}><input className="input xs" placeholder="型号 *（如 STM32G030F6P6）" value={form.mpn} onChange={(e) => setForm({ ...form, mpn: e.target.value })} /><input className="input xs" style={{ width: 90 }} placeholder="厂商" value={form.maker} onChange={(e) => setForm({ ...form, maker: e.target.value })} /></div>
          <input className="input xs" placeholder="描述（用于自动分类：如 3.3V LDO / N-MOS / 电容 10uF）" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="row" style={{ gap: 4 }}><input className="input xs" placeholder="封装（0603 / SOT-23-5 / TSSOP-20 / LQFP-48）" value={form.package} onChange={(e) => setForm({ ...form, package: e.target.value })} /><input className="input xs" style={{ width: 90 }} placeholder="值" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></div>
          <div className="row" style={{ gap: 4 }}><input className="input xs" placeholder="引脚：数量（20）或 1:VDD;2:GND;3:PA0…（IC / 连接器需要）" value={form.pins} onChange={(e) => setForm({ ...form, pins: e.target.value })} /><input className="input xs mono" style={{ width: 90 }} placeholder="LCSC" value={form.lcsc} onChange={(e) => setForm({ ...form, lcsc: e.target.value })} /></div>
          <div className="row" style={{ gap: 6 }}><button className="btn sm primary" onClick={submit}>保存到「我的」</button><button className="btn sm" onClick={() => setAdding(false)}>取消</button><span className="dim xs">符号按类别 / 引脚自动生成，封装按名字参数化生成</span></div>
        </div>
      )}
    </div>
  );
}
