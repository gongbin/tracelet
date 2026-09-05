import { useState } from 'react';
import { RULE_SETS, command, milToMm, type CheckItem } from '@tracelet/kernel';
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
  const project = useProject();
  const editor = useEditor();
  const app = useApp();
  const a = getAnalysis(project);
  const space: 'sch' | 'pcb' = app.screen === 'pcb' ? 'pcb' : 'sch';
  const report = space === 'pcb' ? a.drc : a.erc;
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [showIgnored, setShowIgnored] = useState(false);
  const keyOf = (i: CheckItem) => `${i.rule}|${i.refs.join(',')}`;
  const live = report.items.filter((i) => !ignored.has(keyOf(i)));
  const errors = live.filter((i) => i.severity === 'error'), warnings = live.filter((i) => i.severity === 'warning');
  const ignoredItems = report.items.filter((i) => ignored.has(keyOf(i)));
  const rules = a.rules;
  const setRule = (id: string) => editor.dispatch(command('规则集', (p) => ({ ...p, settings: { ...p.settings, ruleSetId: id, fab: RULE_SETS.find((r) => r.id === id)?.name ?? p.settings.fab } })));

  const Item = ({ i }: { i: CheckItem }) => (
    <div className={`issue${i.severity === 'error' ? ' error' : ''}`} style={{ outline: app.checkHighlight === i.id ? '1px solid var(--selection)' : undefined }}>
      <div className="row" style={{ gap: 6 }}><span style={{ color: i.severity === 'error' ? 'var(--error)' : 'var(--warning)' }}>{i.severity === 'error' ? '●' : '⚠'}</span><span style={{ fontWeight: 500 }}>{i.message}</span></div>
      <div className="muted mono xs" style={{ paddingLeft: 16 }}>{i.refs.join(' · ')}{space === 'sch' && i.location ? ` · (${milToMm(i.location.x).toFixed(1)}, ${milToMm(i.location.y).toFixed(1)}) mm` : ''}</div>
      <div className="why">为什么？{i.why}</div>
      <div className="row" style={{ gap: 6, paddingLeft: 16, marginTop: 2 }}>
        <button className="btn sm quiet" onClick={() => locateItem(i, space)}>定位</button>
        <button className="btn sm quiet muted" onClick={() => setIgnored(new Set([...ignored, keyOf(i)]))}>忽略</button>
        <button className="btn sm ai" onClick={() => { app.set('rightTab', 'ai'); app.set('checkHighlight', i.id); }}>✨ AI 修复</button>
      </div>
    </div>
  );

  return (
    <div className="col" style={{ height: '100%', gap: 0, fontSize: 12 }}>
      <div className="col" style={{ padding: 12, gap: 10, borderBottom: '1px solid var(--border)' }}>
        <div className="row">
          <span style={{ fontWeight: 500, fontSize: 13 }}>{space === 'pcb' ? 'DRC 检查' : 'ERC 检查'}</span>
          <button className="btn sm primary ml-auto" style={{ height: 26 }} onClick={() => app.toast(`检查实时运行：${report.errors} 错误 · ${report.warnings} 警告`, report.errors ? 'error' : 'success')}>▶ 运行</button>
          <select className="input" style={{ width: 'auto', height: 26 }} value={rules.id} onChange={(e) => setRule(e.target.value)}>{RULE_SETS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
        </div>
        <div className="row mono" style={{ gap: 14 }}><span style={{ color: errors.length ? 'var(--error)' : 'var(--text-3)' }}>● {errors.length} 错误</span><span style={{ color: warnings.length ? 'var(--warning)' : 'var(--text-3)' }}>⚠ {warnings.length} 警告</span><span className="dim">○ {ignoredItems.length} 已忽略</span></div>
      </div>
      <div className="grow col" style={{ overflow: 'auto', padding: '8px 12px', gap: 6 }}>
        {live.length === 0 && <div className="col" style={{ alignItems: 'center', padding: 24, gap: 6 }}><span style={{ fontSize: 22, color: 'var(--success)' }}>✓</span><span className="muted">没有问题</span></div>}
        {errors.length > 0 && <div className="muted" style={{ padding: '4px 0' }}>▾ 错误 ({errors.length})</div>}
        {errors.map((i) => <Item key={i.id} i={i} />)}
        {warnings.length > 0 && <div className="muted" style={{ padding: '8px 0 4px' }}>▾ 警告 ({warnings.length})</div>}
        {warnings.map((i) => (
          <div key={i.id} className="warn-row" style={{ outline: app.checkHighlight === i.id ? '1px solid var(--selection)' : undefined }} onClick={() => locateItem(i, space)}>
            <span style={{ color: 'var(--warning)' }}>⚠</span><span>{i.message}</span><span className="mono muted nowrap">{i.refs[0]}</span>
            <span className="ml-auto" style={{ color: 'var(--accent)' }}>定位</span>
            <span className="dim" title="忽略" onClick={(e) => { e.stopPropagation(); setIgnored(new Set([...ignored, keyOf(i)])); }}>✕</span>
          </div>
        ))}
        {ignoredItems.length > 0 && <div className="dim" style={{ padding: '8px 0 4px', cursor: 'pointer' }} onClick={() => setShowIgnored(!showIgnored)}>{showIgnored ? '▾' : '▸'} 已忽略 ({ignoredItems.length})</div>}
        {showIgnored && ignoredItems.map((i) => <div key={i.id} className="warn-row dim"><span>{i.message}</span><span className="ml-auto" style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => { const s = new Set(ignored); s.delete(keyOf(i)); setIgnored(s); }}>恢复</span></div>)}
      </div>
      <div className="col" style={{ flex: 'none', borderTop: '1px solid var(--border)', padding: '10px 12px', gap: 4, fontSize: 11.5 }}>
        <div className="row"><span className="muted">规则集：</span><span>{rules.name} {project.board.copperCount} 层</span><span className="ml-auto" style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => app.go('fab')}>编辑 →</span></div>
        <div className="muted mono">最小线宽 {rules.minTraceWidth} · 最小间距 {rules.minClearance} · 最小孔 {rules.minDrill}</div>
      </div>
    </div>
  );
}
