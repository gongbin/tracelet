import { useState } from 'react';
import { pcb, command, RULE_SETS, exportFabZip, boardBounds, DEFAULT_STACKUP } from '@tracelet/kernel';
import { StackupDialog } from '../components/StackupDialog.js';
import { modelFor, needsModel } from '../editors/three/models.js';
import { GerberPreview } from '../editors/pcb/GerberPreview.js';
import { useT } from '../i18n/index.js';
import { useApp, useEditor, useProject } from '../store/app.js';
import { getAnalysis } from '../store/analysis.js';
import { locateItem } from '../panels/CheckPanel.js';

function download(name: string, content: string | Uint8Array, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content as BlobPart], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function FabPage() {
  const project = useProject();
  const editor = useEditor();
  const app = useApp();
  const a = getAnalysis(project);
  const b = project.board;
  const bb = boardBounds(b);
  const [exports, setExports] = useState<Record<string, boolean>>({ gerber: true, bom: true, pnp: true, asm: true, sch: false });
  const [stackup, setStackup] = useState(false);
  const st = { ...DEFAULT_STACKUP, ...(b.stackup ?? {}) };
  const unmatched3d = b.footprints.filter((f) => needsModel(f) && !modelFor(f, b)).length;
  const [w, setW] = useState(String(bb.w)), [h, setH] = useState(String(bb.h));
  const [preview, setPreview] = useState(false);
  const t = useT();
  const slug = project.name.replace(/\s+/g, '-').toLowerCase();
  const hasVersion = b.texts.some((t) => /v\d/i.test(t.text));
  const outside = a.drc.items.filter((i) => i.rule === 'outside-board');

  const checks: { ok: boolean | 'warn'; text: string; action?: { label: string; run: () => void } }[] = [
    { ok: a.drc.errors === 0 ? true : false, text: a.drc.errors === 0 ? `DRC 通过（0 错误，${a.drc.warnings} 警告）` : `DRC ${a.drc.errors} 个错误`, action: a.drc.errors ? { label: '查看', run: () => { app.go('pcb'); app.set('rightTab', 'check'); } } : undefined },
    { ok: a.ratsnest.unrouted === 0, text: a.ratsnest.unrouted === 0 ? '所有元件已布线' : `还有 ${a.ratsnest.unrouted} 条连接未布线`, action: a.ratsnest.unrouted ? { label: '去布线', run: () => { app.go('pcb'); app.setPcbTool('route'); } } : undefined },
    { ok: outside.length === 0, text: outside.length === 0 ? '所有元件在板框内' : `${outside.length} 个元件在板框外`, action: outside.length ? { label: '定位', run: () => locateItem(outside[0], 'pcb') } : undefined },
    { ok: unmatched3d ? 'warn' : true, text: unmatched3d ? `${unmatched3d} 个元件未匹配 3D 模型（不影响制造）` : '3D 模型已匹配', action: unmatched3d ? { label: '去匹配', run: () => app.go('3d') } : undefined },
    { ok: b.outline.length >= 3, text: '板框闭合' },
    { ok: hasVersion ? true : 'warn', text: hasVersion ? '有版本号丝印' : '没有版本号丝印', action: hasVersion ? undefined : { label: '添加', run: () => editor.dispatch(pcb.addBoardText({ layer: 'F.Silk', text: 'v1.0', x: bb.x + bb.w - 6, y: bb.y + 2.5, size: 1 })) } }
  ];

  const doExport = () => {
    const z = exportFabZip(project, { bom: exports.bom, pnp: exports.pnp, netlist: true, project: true, assemblyPdf: exports.asm, schematicPdf: exports.sch });
    download(z.name, z.data, 'application/zip');
    app.toast(`已下载 ${z.name}（Gerber ${b.copperCount + 7} 层 + 钻孔${exports.bom ? ' + BOM' : ''}${exports.pnp ? ' + 坐标' : ''}${exports.asm ? ' + 装配图 PDF' : ''}${exports.sch ? ' + 原理图 PDF' : ''}）`, 'success');
  };
  const VENDOR: Record<string, { name: string; url: string }> = { jlc: { name: '嘉立创', url: 'https://www.jlc.com/' }, jlcpcb: { name: 'JLCPCB', url: 'https://cart.jlcpcb.com/quote' } };
  const order = () => {
    doExport();
    const v = VENDOR[project.settings.ruleSetId];
    if (v) { window.open(v.url, '_blank', 'noopener'); app.toast(`已打开${v.name}下单页：上传刚下载的 zip，按 README 里的参数（${b.copperCount} 层 · ${b.thickness}mm · ${st.finish} · ${st.maskColor}阻焊）填写即可`); }
    else app.toast('通用规则集没有绑定板厂：把 zip 上传到你的板厂下单页即可');
  };
  const setSetting = (patch: Partial<typeof project.settings>) => editor.dispatch(command('项目设置', (p) => ({ ...p, settings: { ...p.settings, ...patch } })));

  const EXPORTS = [['gerber', `Gerber + 钻孔（${project.settings.fab}格式）`], ['bom', 'BOM（LCSC 模板）'], ['pnp', '坐标文件'], ['asm', '装配图 PDF（顶 / 底）'], ['sch', '原理图 PDF']];

  return (
    <div className="page">
      <div className="page-inner">
        <h1>{t('fab.title')}</h1>
        <section className="col" style={{ gap: 10 }}>
          <h3>{t('fab.precheck')}</h3>
          <div className="check-list">
            {checks.map((c, i) => (
              <div key={i} className="item">
                <span className="mark" style={{ background: c.ok === true ? 'var(--success)' : c.ok === 'warn' ? 'var(--warning)' : 'var(--error)' }}>{c.ok === true ? '✓' : '!'}</span>
                <span>{c.text}</span>
                {c.action && <button className="btn sm ml-auto" onClick={c.action.run}>{c.action.label}</button>}
              </div>
            ))}
          </div>
        </section>
        <section className="row" style={{ gap: 28, flexWrap: 'wrap' }}>
          <div className="row"><span className="muted small">目标工厂</span>
            <select className="input" style={{ width: 'auto' }} value={project.settings.ruleSetId} onChange={(e) => setSetting({ ruleSetId: e.target.value, fab: RULE_SETS.find((r) => r.id === e.target.value)?.name })}>{RULE_SETS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          </div>
          <div className="row mono small muted" style={{ gap: 20 }}>
            <span>层数 <select className="input" style={{ width: 'auto', display: 'inline-block', height: 24 }} value={b.copperCount} onChange={(e) => editor.dispatch(pcb.setCopperCount(Number(e.target.value) as 2 | 4))}><option value={2}>2</option><option value={4}>4</option></select></span>
            <span>板厚 <b style={{ color: 'var(--text)', fontWeight: 500 }}>{b.thickness}</b></span>
            <span>工艺 <b style={{ color: 'var(--text)', fontWeight: 500 }}>{st.copperWeight}oz · {st.finish} · {st.maskColor}阻焊/{st.silkColor}丝印</b> <button className="btn sm" onClick={() => setStackup(true)}>层叠…</button></span>
            <span className="row" style={{ gap: 4 }}>尺寸 <input className="input mono" style={{ width: 60, height: 24 }} value={w} onChange={(e) => setW(e.target.value)} onBlur={() => editor.dispatch(pcb.setOutlineRect(Number(w) || bb.w, Number(h) || bb.h))} />×<input className="input mono" style={{ width: 60, height: 24 }} value={h} onChange={(e) => setH(e.target.value)} onBlur={() => editor.dispatch(pcb.setOutlineRect(Number(w) || bb.w, Number(h) || bb.h))} /> mm</span>
            <span>单位 <span className="seg sm" style={{ display: 'inline-flex', height: 24 }}>{(['mm', 'mil'] as const).map((u) => <span key={u} className={`seg-opt${project.settings.unit === u ? ' on' : ''}`} onClick={() => setSetting({ unit: u })}>{u}</span>)}</span></span>
          </div>
        </section>
        <section className="col" style={{ gap: 10 }}>
          <h3>{t('fab.export')}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: '8px 24px', maxWidth: 560 }}>
            {EXPORTS.map(([id, label]) => <label key={id} className="row" style={{ gap: 10, cursor: id === 'gerber' ? 'default' : 'pointer', opacity: id === 'gerber' ? 0.8 : 1 }} onClick={() => id !== 'gerber' && setExports({ ...exports, [id]: !exports[id] })}><span className={`check${exports[id] ? ' on' : ''}`}>{exports[id] ? '✓' : ''}</span><span>{label}</span></label>)}
          </div>
          <div className="dim xs">zip 内含 README（层数 / 板厚 / 铜厚 / 表面处理 / 阻焊色）、网表与项目备份。STEP / IPC-2581 需要几何内核暂不提供；3D 外形可在 3D 页导出 GLB。PDF 使用标准字体，中文字符以 ? 显示。</div>
        </section>
        <div className="row" style={{ gap: 10 }}>
          <button className="btn lg quiet" onClick={() => setPreview(true)}>{t('fab.preview')}</button>
          <button className="btn lg quiet" onClick={doExport}>⇩ {t('fab.download')}</button>
          <button className="btn lg primary" onClick={order} title="下载制造包并打开板厂下单页">{t('fab.order')}</button>
          <span className="ml-auto xs dim mono">{exportFabZip.name && `${slug}_${new Date().toISOString().slice(0, 10)}.zip`}</span>
        </div>
        <section className="col" style={{ gap: 6 }}>
          <h3>规则集 · {a.rules.name}</h3>
          <div className="muted small mono">最小线宽 {a.rules.minTraceWidth} · 最小间距 {a.rules.minClearance} · 最小孔 {a.rules.minDrill} · 环宽 {a.rules.minAnnularRing} · 铜到板边 {a.rules.copperToEdge}（mm）</div>
        </section>
      </div>
      {preview && <GerberPreview onClose={() => setPreview(false)} />}
      {stackup && <StackupDialog close={() => setStackup(false)} />}
    </div>
  );
}
