import { useState } from 'react';
import { StackupDialog } from '../components/StackupDialog.js';
import { pcb, LAYER_COLORS, copperLayers, type Layer } from '@tracelet/kernel';
import { useApp, useEditor, useProject } from '../store/app.js';
import { Icon } from '../components/Icon.js';
import { I } from '../icons.js';

export function LayersPanel() {
  const project = useProject();
  const editor = useEditor();
  const app = useApp();
  const board = project.board;
  const cu = copperLayers(board.copperCount);
  const layers: Layer[] = [...cu, 'F.Silk', 'B.Silk', 'F.Mask', 'B.Mask', 'Edge.Cuts'];
  const [stackup, setStackup] = useState(false);
  const [filters, setFilters] = useState<Record<string, boolean>>({ 元件: true, 走线: true, 过孔: true, 文字: false, 铺铜: false });
  const [q, setQ] = useState('');
  const hiddenFp = new Set(app.hiddenFootprints);
  const query = q.trim().toLowerCase();
  const matches = query ? board.footprints.filter((f) => f.ref.toLowerCase().includes(query) || (f.value ?? '').toLowerCase().includes(query)).slice(0, 40) : board.footprints.filter((f) => hiddenFp.has(f.id) || app.pcbSelection.includes(f.id));
  const toggleHidden = (id: string) => app.set('hiddenFootprints', hiddenFp.has(id) ? app.hiddenFootprints.filter((x) => x !== id) : [...app.hiddenFootprints, id]);
  const locate = (f: typeof board.footprints[number]) => { app.patch({ pcbSelection: [f.id], highlightNet: null, flyTo: { x: f.x, y: f.y, space: 'pcb', seq: Date.now() } }); };
  const hidden = (l: Layer) => board.hiddenLayers.includes(l);
  return (
    <div className="panel-pad">
      <div className="row"><span className="kicker">图层 · 点击切换当前层</span><span className="ml-auto mono muted">{board.copperCount} 层 · {board.thickness} mm{board.stackup ? ` · ${board.stackup.finish}` : ''}</span></div>
      {stackup && <StackupDialog close={() => setStackup(false)} />}
      <div className="col" style={{ gap: 0 }}>
        {layers.map((l) => {
          const ki = (cu as string[]).indexOf(l);
          const active = l === app.activeLayer;
          return (
            <div key={l} className={`layer-row${active ? ' on' : ''}`} onClick={() => ki >= 0 && app.set('activeLayer', cu[ki])}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', flex: 'none', background: LAYER_COLORS[l], opacity: hidden(l) ? 0.3 : 1 }} />
              <span className="mono" style={{ color: active ? 'var(--text)' : hidden(l) ? 'var(--text-3)' : 'var(--text-2)' }}>{l}</span>
              <span className="dim xs">{ki >= 0 ? ki + 1 : ''}</span>
              <span className="ml-auto" style={{ color: hidden(l) ? 'var(--text-3)' : 'var(--text-2)', display: 'flex' }} title="显示/隐藏" onClick={(e) => { e.stopPropagation(); editor.dispatch(pcb.setLayerHidden(l, !hidden(l))); }}><Icon d={I.eye} size={14} stroke={2} /></span>
              <span style={{ color: active ? 'var(--text-2)' : 'transparent', display: 'flex' }}><Icon d={I.lock} size={13} stroke={2} /></span>
            </div>
          );
        })}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn grow" style={{ justifyContent: 'center' }} onClick={() => { const n = board.copperCount === 4 ? 2 : 4; if (app.activeLayer.startsWith('In')) app.set('activeLayer', 'F.Cu'); editor.dispatch(pcb.setCopperCount(n)); }}>{board.copperCount === 4 ? '− 移除内层（改为 2 层）' : '+ 添加内层 In1 / In2（改为 4 层）'}</button>
        <button className="btn" onClick={() => setStackup(true)} title="板厚、铜厚、表面处理、阻焊 / 丝印颜色">层叠 →</button>
      </div>
      <div className="row muted" style={{ gap: 10 }}>
        <span style={{ flex: 'none' }}>非当前层</span>
        <div className="slider" onPointerDown={(e) => { const el = e.currentTarget; const setFrom = (cx: number) => { const r = el.getBoundingClientRect(); app.set('otherLayerOpacity', Math.round(Math.max(0, Math.min(1, (cx - r.left) / r.width)) * 20) / 20); }; setFrom(e.clientX); const mv = (ev: PointerEvent) => setFrom(ev.clientX); const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); }; window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); }}>
          <div className="fill" style={{ width: `${app.otherLayerOpacity * 100}%` }} /><div className="knob" style={{ left: `${app.otherLayerOpacity * 100}%` }} />
        </div>
        <span className="mono" style={{ color: 'var(--text)' }}>{Math.round(app.otherLayerOpacity * 100)}%</span>
      </div>
      <div className="divider" />
      <div className="col" style={{ gap: 6 }}>
        <div className="kicker">网络类</div>
        {board.netClasses.map((nc) => <div key={nc.name} className="row mono" style={{ justifyContent: 'space-between' }}><span>{nc.name}</span><span className="muted">{nc.traceWidth.toFixed(2)}mm · 过孔 {nc.viaSize}/{nc.viaDrill}</span></div>)}
      </div>
      <div className="divider" />
      <div className="col" style={{ gap: 6 }}>
        <div className="row"><span className="kicker">元件</span>{hiddenFp.size > 0 && <span className="ml-auto xs" style={{ cursor: 'pointer', color: 'var(--accent)' }} onClick={() => app.set('hiddenFootprints', [])}>显示全部（已隐藏 {hiddenFp.size}）</span>}</div>
        <div className="row" style={{ gap: 6 }}>
          <input className="input" style={{ flex: 1, height: 26, fontSize: 12 }} placeholder="搜索位号 / 值，如 C3、10uF" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && matches[0]) locate(matches[0]); if (e.key === 'Escape') setQ(''); }} />
          {app.pcbSelection.some((id) => board.footprints.some((f) => f.id === id)) && <button className="btn sm" title="隐藏当前选中的元件，方便选到被遮住的元件" onClick={() => app.set('hiddenFootprints', [...new Set([...app.hiddenFootprints, ...app.pcbSelection.filter((id) => board.footprints.some((f) => f.id === id))])])}>隐藏选中</button>}
        </div>
        {matches.length > 0 && <div className="col" style={{ gap: 2, maxHeight: 220, overflow: 'auto' }}>
          {matches.map((f) => <div key={f.id} className="row mono xs" style={{ gap: 6, padding: '3px 4px', borderRadius: 4, background: app.pcbSelection.includes(f.id) ? 'var(--bg-raised)' : 'transparent', opacity: hiddenFp.has(f.id) ? 0.55 : 1 }}>
            <span style={{ cursor: 'pointer', fontWeight: 500, minWidth: 34 }} onClick={() => locate(f)} title="定位并选中">{f.ref}</span>
            <span className="muted" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }} onClick={() => locate(f)}>{f.value} · {f.side === 'F' ? '顶' : '底'}</span>
            <span style={{ cursor: 'pointer' }} title={hiddenFp.has(f.id) ? '显示' : '隐藏（重叠时便于选到下面的元件）'} onClick={() => toggleHidden(f.id)}><Icon d={hiddenFp.has(f.id) ? I.eyeOff : I.eye} size={13} stroke={1.8} /></span>
          </div>)}
        </div>}
        {query && !matches.length && <div className="dim xs">没有匹配的元件</div>}
        <div className="dim xs">重叠的元件：再次点击已选中的元件会轮换选到它下面的那个。</div>
      </div>
      <div className="divider" />
      <div className="col" style={{ gap: 8 }}>
        <div className="kicker">选择过滤</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {Object.entries(filters).map(([k, on]) => <span key={k} className={`chip${on ? ' on' : ''}`} onClick={() => setFilters({ ...filters, [k]: !on })}>{k}</span>)}
        </div>
      </div>
    </div>
  );
}
