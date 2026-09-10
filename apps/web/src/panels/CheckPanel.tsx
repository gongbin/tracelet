import { useEffect, useState } from 'react';
import { DiagnosticText } from '../i18n/DiagnosticText.js';
import { usePrefs, useT } from '../i18n/index.js';
import { translateText } from '../i18n/auto.js';
import { RULE_SETS, command, sch, milToMm, type CheckItem } from '@tracelet/kernel';
import { useApp, useEditor, useProject } from '../store/app.js';
import { getAnalysis } from '../store/analysis.js';

export function locateItem(item: CheckItem, space: 'sch' | 'pcb') {
  const app = useApp.getState();
  const patch: Parameters<typeof app.patch>[0] = { checkHighlight: item.id, rightTab: 'check' };
  if (item.location) patch.flyTo = { x: item.location.x, y: item.location.y, space, seq: Date.now() };
  if (space === 'sch' && item.objectIds.length) patch.selection = item.objectIds;
  if (space === 'sch' && item.sheetId) patch.sheetId = item.sheetId;
  if (space === 'pcb' && item.objectIds.length) patch.pcbSelection = item.objectIds.slice(0, 1);
  if (app.screen !== space) app.go(space);
  app.patch(patch);
}

export function CheckPanel() {
  const t = useT();
  const locale = usePrefs((s) => s.locale);
  const project = useProject();
  const editor = useEditor();
  const app = useApp();
  const a = getAnalysis(project);
  const space: 'sch' | 'pcb' = app.screen === 'pcb' ? 'pcb' : 'sch';
  const report = space === 'pcb' ? a.drc : a.erc;
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [showIgnored, setShowIgnored] = useState(false);
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState('all');
  const [currentSheetOnly, setCurrentSheetOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => { setIgnored(new Set()); setShowIgnored(false); setQuery(''); setSeverity('all'); setCurrentSheetOnly(false); setExpanded(null); }, [project.id, space]);
  const keyOf = (i: CheckItem) => JSON.stringify([project.id, space, i.sheetId, i.rule, i.objectIds, i.refs, i.location?.x, i.location?.y]);
  const live = report.items.filter((i) => !ignored.has(keyOf(i)) && (severity === 'all' || i.severity === severity) &&
    (!currentSheetOnly || !i.sheetId || i.sheetId === (app.sheetId ?? project.schematic.sheets[0].id)) &&
    `${i.message} ${i.why} ${i.refs.join(' ')} ${translateText(i.message, locale)} ${translateText(i.why, locale)}`.toLowerCase().includes(query.trim().toLowerCase()));
  const errors = live.filter((i) => i.severity === 'error'), warnings = live.filter((i) => i.severity === 'warning');
  const ignoredItems = report.items.filter((i) => ignored.has(keyOf(i)));
  const rules = a.rules;
  const setRule = (id: string) => editor.dispatch(command('规则集', (p) => ({ ...p, settings: { ...p.settings, ruleSetId: id, fab: RULE_SETS.find((r) => r.id === id)?.name ?? p.settings.fab } })));
  const unusedPin = (i: CheckItem) => i.rule === 'unconnected-pin' ? a.netlist.unconnectedPins.find(p => p.componentId === i.objectIds[0] && p.pos.x === i.location?.x && p.pos.y === i.location?.y) : undefined;

  const Item = ({ i }: { i: CheckItem }) => (
    <div className={`issue${i.severity === 'error' ? ' error' : ''}`} style={{ outline: app.checkHighlight === i.id ? '1px solid var(--selection)' : undefined }}>
      <div className="row" style={{ gap: 6 }}><span style={{ color: i.severity === 'error' ? 'var(--error)' : 'var(--warning)' }}>{i.severity === 'error' ? '●' : '⚠'}</span><span style={{ fontWeight: 500 }}><DiagnosticText>{i.message}</DiagnosticText></span></div>
      <div className="muted mono xs" style={{ paddingLeft: 16 }}><DiagnosticText>{i.refs.join(' · ')}</DiagnosticText>{space === 'sch' && i.location ? ` · (${milToMm(i.location.x).toFixed(1)}, ${milToMm(i.location.y).toFixed(1)}) mm` : ''}</div>
      <div className="why"><DiagnosticText>{`为什么？${i.why}`}</DiagnosticText></div>
      <div className="row" style={{ gap: 6, paddingLeft: 16, marginTop: 2, flexWrap: 'wrap' }}>
        <button className="btn sm quiet" onClick={() => locateItem(i, space)}>定位</button>
        <button className="btn sm quiet muted" onClick={() => setIgnored(new Set([...ignored, keyOf(i)]))}>忽略</button>
        <button className="btn sm ai" onClick={() => { app.set('rightTab', 'ai'); app.set('checkHighlight', i.id); }}>✨ AI 修复</button>
        {space === 'sch' && unusedPin(i)?.sheetId && <button className="btn sm quiet" title={t('sch.check.ncHint')} onClick={() => {
          const pin = unusedPin(i)!;
          editor.dispatch(sch.toggleNoConnect(pin.sheetId!, pin.componentId, pin.pinNumber));
          app.patch({ checkHighlight: null });
        }}>{t('sch.check.nc')}</button>}
      </div>
    </div>
  );

  return (
    <div key={locale} className="col" style={{ height: '100%', gap: 0, fontSize: 12 }}>
      <div className="col" style={{ padding: 12, gap: 10, borderBottom: '1px solid var(--border)' }}>
        <div className="row">
          <span style={{ fontWeight: 500, fontSize: 13 }}>{space === 'pcb' ? 'DRC 检查' : 'ERC 检查'}</span>
          <button className="btn sm primary ml-auto" style={{ height: 26 }} onClick={() => { if (space === 'sch') app.set('showSchCheckMarkers', true); app.toast(`检查实时运行：${report.errors} 错误 · ${report.warnings} 警告`, report.errors ? 'error' : 'success'); }}>▶ 运行</button>
          {space === 'pcb' && <select className="input" style={{ width: 'auto', height: 26 }} value={rules.id} onChange={(e) => setRule(e.target.value)}>{RULE_SETS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>}
        </div>
        <div className="row mono" style={{ gap: 14 }}><span style={{ color: errors.length ? 'var(--error)' : 'var(--text-3)' }}>● {errors.length} 错误</span><span style={{ color: warnings.length ? 'var(--warning)' : 'var(--text-3)' }}>⚠ {warnings.length} 警告</span><span className="dim">○ {ignoredItems.length} 已忽略</span></div>
        <input className="input" type="search" aria-label={t('sch.check.search')} placeholder={t('sch.check.search')} value={query} onChange={e => setQuery(e.target.value)} />
        {space === 'sch' && <label className="row" title={t('sch.check.markersHint')}><input type="checkbox" checked={app.showSchCheckMarkers} onChange={e => app.set('showSchCheckMarkers', e.target.checked)} />{t('sch.check.markers')}</label>}
        <div className="row" style={{ gap: 8 }}>
          <select className="input" style={{ flex: 1, width: 0, minWidth: 0 }} aria-label={t('sch.check.severity')} value={severity} onChange={e => setSeverity(e.target.value)}><option value="all">{t('sch.check.all')}</option><option value="error">{t('sch.check.errors')}</option><option value="warning">{t('sch.check.warnings')}</option></select>
          {space === 'sch' && <label className="row nowrap" style={{ flex: 'none' }}><input type="checkbox" checked={currentSheetOnly} onChange={e => setCurrentSheetOnly(e.target.checked)} />{t('sch.check.sheet')}</label>}
        </div>
      </div>
      <div className="grow col" style={{ overflow: 'auto', padding: '8px 12px', gap: 6 }}>
        {live.length === 0 && <div className="col" style={{ alignItems: 'center', padding: 24, gap: 6 }}><span style={{ fontSize: 22, color: report.items.length ? 'var(--text-3)' : 'var(--success)' }}>{report.items.length ? '—' : '✓'}</span><span className="muted">{t(report.items.length ? 'sch.check.noMatches' : 'sch.check.clean')}</span></div>}
        {errors.length > 0 && <div className="muted" style={{ padding: '4px 0' }}>▾ 错误 ({errors.length})</div>}
        {errors.map((i) => <Item key={i.id} i={i} />)}
        {warnings.length > 0 && <div className="muted" style={{ padding: '8px 0 4px' }}>▾ 警告 ({warnings.length})</div>}
        {warnings.map((i) => (
          <div key={keyOf(i)}>
            <button className="warn-row check-warning" aria-expanded={expanded === keyOf(i)} onClick={() => { setExpanded(expanded === keyOf(i) ? null : keyOf(i)); locateItem(i, space); }}>
              <span style={{ color: 'var(--warning)' }}>⚠</span><span><DiagnosticText>{i.message}</DiagnosticText><span className="mono muted xs" style={{ display: 'block' }}>{i.refs.join(' · ')}</span></span><span className="ml-auto dim">{expanded === keyOf(i) ? '▴' : '▾'}</span>
            </button>
            {expanded === keyOf(i) && <Item i={i} />}
          </div>
        ))}
        {ignoredItems.length > 0 && <div className="dim" style={{ padding: '8px 0 4px', cursor: 'pointer' }} onClick={() => setShowIgnored(!showIgnored)}>{showIgnored ? '▾' : '▸'} 已忽略 ({ignoredItems.length})</div>}
        {showIgnored && ignoredItems.map((i) => <div key={i.id} className="warn-row dim"><span><DiagnosticText>{i.message}</DiagnosticText></span><span className="ml-auto" style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => { const s = new Set(ignored); s.delete(keyOf(i)); setIgnored(s); }}>恢复</span></div>)}
      </div>
      {space === 'pcb' ? <div className="col" style={{ flex: 'none', borderTop: '1px solid var(--border)', padding: '10px 12px', gap: 4, fontSize: 11.5 }}>
        <div className="row"><span className="muted">规则集：</span><span>{rules.name} {project.board.copperCount} 层</span><span className="ml-auto" style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => app.go('fab')}>编辑 →</span></div>
        <div className="muted mono">最小线宽 {rules.minTraceWidth} · 最小间距 {rules.minClearance} · 最小孔 {rules.minDrill}</div>
      </div> : <div className="muted" style={{ flex: 'none', borderTop: '1px solid var(--border)', padding: 12, fontSize: 11.5 }}>{t('sch.check.help')}</div>}
    </div>
  );
}
