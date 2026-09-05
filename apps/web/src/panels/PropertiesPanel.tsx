import { useEffect, useState } from 'react';
import { sch, pcb, getSymbol, BUILTIN_FOOTPRINTS, BUILTIN_PARTS, findFootprint, footprintPads, milToMm, formatLength } from '@tracelet/kernel';
import { useApp, useEditor, useProject } from '../store/app.js';
import { getAnalysis } from '../store/analysis.js';

function ValueInput({ value, onCommit, mono = true }: { value: string; onCommit: (v: string) => void; mono?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => { if (v !== value) onCommit(v); };
  return <input className={`input${mono ? ' mono' : ''}`} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setV(value); e.stopPropagation(); }} />;
}

export function PropertiesPanel() {
  const project = useProject();
  const editor = useEditor();
  const app = useApp();
  const a = getAnalysis(project);
  const sheet = project.schematic.sheets[0];
  const unit = project.settings.unit;

  if (app.screen === 'pcb') {
    const id = app.pcbSelection[0];
    const fp = project.board.footprints.find((f) => f.id === id);
    const tr = project.board.traces.find((t) => t.id === id);
    const via = project.board.vias.find((v) => v.id === id);
    const zone = project.board.zones.find((z) => z.id === id);
    if (fp) {
      const def = findFootprint(fp.footprintId);
      const pads = footprintPads(fp, project.board);
      return (
        <div className="panel-pad">
          <div className="row"><span className="mono" style={{ fontWeight: 500, background: 'var(--bg-raised)', padding: '2px 6px', borderRadius: 4 }}>{fp.ref}</span><span className="muted" style={{ fontWeight: 500 }}>{fp.value}</span></div>
          <div className="kv">
            <span className="k">封装</span><span className="field mono nowrap">{def?.name ?? fp.footprintId}</span>
            <span className="k">位置</span><div className="row" style={{ gap: 6 }}><span className="field mono grow"><span className="dim">X</span>{fp.x.toFixed(2)}</span><span className="field mono grow"><span className="dim">Y</span>{fp.y.toFixed(2)}</span></div>
            <span className="k">旋转</span><div className="seg sm">{[0, 90, 180, 270].map((r) => <span key={r} className={`seg-opt mono${fp.rotation === r ? ' on' : ''}`} onClick={() => editor.dispatch(pcb.rotateFootprint(fp.id, r - fp.rotation))}>{r}°</span>)}</div>
            <span className="k">面</span><div className="seg sm"><span className={`seg-opt${fp.side === 'F' ? ' on' : ''}`} onClick={() => fp.side !== 'F' && editor.dispatch(pcb.flipFootprint(fp.id))}>顶层</span><span className={`seg-opt${fp.side === 'B' ? ' on' : ''}`} onClick={() => fp.side !== 'B' && editor.dispatch(pcb.flipFootprint(fp.id))}>底层</span></div>
          </div>
          <div className="divider" />
          <div className="col" style={{ gap: 6 }}>
            <div className="row"><span className="muted">焊盘</span><span className="mono">{pads.length}</span></div>
            {pads.map((p, i) => <div key={i} className="pin-row"><span className="dot" style={{ background: p.net ? 'var(--success)' : 'var(--text-3)' }} /><span>{p.number}</span><span className="ml-auto muted">{p.net || '—'}</span></div>)}
          </div>
          <div className="row"><span className="muted">原理图</span><span className="ml-auto" style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => { if (fp.componentId) app.patch({ selection: [fp.componentId] }); app.go('sch'); }}>在原理图中定位 →</span></div>
        </div>
      );
    }
    if (tr) return (
      <div className="panel-pad">
        <div className="row"><span style={{ fontWeight: 500 }}>走线</span><span className="ml-auto muted" style={{ cursor: 'pointer' }} onClick={() => { editor.dispatch(pcb.deleteTraces([tr.id])); app.patch({ pcbSelection: [] }); }}>删除</span></div>
        <div className="kv"><span className="k">网络</span><span className="field mono">{tr.net || '—'}</span><span className="k">层</span><span className="field mono">{tr.layer}</span><span className="k">宽度</span><span className="field mono">{tr.width} mm</span><span className="k">段数</span><span className="field mono">{tr.points.length - 1}</span></div>
      </div>
    );
    if (via) return (
      <div className="panel-pad">
        <div className="row"><span style={{ fontWeight: 500 }}>过孔</span><span className="ml-auto muted" style={{ cursor: 'pointer' }} onClick={() => { editor.dispatch(pcb.deleteVias([via.id])); app.patch({ pcbSelection: [] }); }}>删除</span></div>
        <div className="kv"><span className="k">网络</span><span className="field mono">{via.net || '—'}</span><span className="k">外径/孔径</span><span className="field mono">{via.size} / {via.drill} mm</span><span className="k">位置</span><span className="field mono">{via.x.toFixed(2)}, {via.y.toFixed(2)}</span></div>
      </div>
    );
    if (zone) return (
      <div className="panel-pad">
        <div className="row"><span style={{ fontWeight: 500 }}>铺铜</span><span className="ml-auto muted" style={{ cursor: 'pointer' }} onClick={() => { editor.dispatch(pcb.deleteZones([zone.id])); app.patch({ pcbSelection: [] }); }}>删除</span></div>
        <div className="kv"><span className="k">网络</span><span className="field mono">{zone.net || '—'}</span><span className="k">层</span><span className="field mono">{zone.layer}</span><span className="k">顶点</span><span className="field mono">{zone.polygon.length}</span></div>
      </div>
    );
    const bb = project.board;
    return (
      <div className="panel-pad">
        <div className="muted">未选中对象 · 点选元件、走线或过孔查看属性</div>
        <div className="divider" />
        <div className="kicker">板</div>
        <div className="kv"><span className="k">元件</span><span className="mono">{bb.footprints.length}</span><span className="k">走线</span><span className="mono">{bb.traces.length}</span><span className="k">过孔</span><span className="mono">{bb.vias.length}</span><span className="k">未布线</span><span className="mono" style={{ color: a.ratsnest.unrouted ? 'var(--warning)' : 'var(--success)' }}>{a.ratsnest.unrouted}/{a.ratsnest.total}</span></div>
        <div className="divider" />
        <div className="kicker">下一步</div>
        <div className="col" style={{ gap: 6 }}>
          <div className="next-step" onClick={() => app.setPcbTool('route')}><span className="key">X</span>走线：点焊盘开始</div>
          <div className="next-step" onClick={() => app.setPcbTool('zone')}><span className="key">Z</span>铺铜：画区域填 GND</div>
          <div className="next-step" onClick={() => app.go('fab')}><span className="key">→</span>检查通过后去制造页导出</div>
        </div>
      </div>
    );
  }

  const id = app.selection[0];
  const comp = sheet.components.find((c) => c.id === id);
  const label = sheet.labels.find((l) => l.id === id);
  if (label) return (
    <div className="panel-pad">
      <div className="row"><span style={{ fontWeight: 500 }}>网络标签</span><span className="ml-auto muted" style={{ cursor: 'pointer' }} onClick={() => { editor.dispatch(sch.deleteLabels(sheet.id, [label.id])); app.patch({ selection: [] }); }}>删除</span></div>
      <div className="kv"><span className="k">名称</span><span className="field mono">{label.text}</span></div>
    </div>
  );
  if (!comp) return (
    <div className="panel-pad">
      <div className="muted">未选中对象 · 点选画布中的元件或导线查看属性</div>
      <div className="divider" />
      <div className="kicker">图纸</div>
      <div className="kv"><span className="k">元件</span><span className="mono">{sheet.components.length}</span><span className="k">导线</span><span className="mono">{sheet.wires.length}</span><span className="k">未连接引脚</span><span className="mono" style={{ color: a.netlist.unconnectedPins.length ? 'var(--warning)' : 'var(--success)' }}>{a.netlist.unconnectedPins.length}</span></div>
      <div className="divider" />
      <div className="kicker">下一步</div>
      <div className="col" style={{ gap: 6 }}>
        <div className="next-step" onClick={() => app.setSchTool('place')}><span className="key">A</span>放置元件</div>
        <div className="next-step" onClick={() => app.setSchTool('wire')}><span className="key">W</span>连线：点一个引脚，再点另一个</div>
        <div className="next-step" onClick={() => { editor.dispatch(pcb.syncFromSchematic()); app.go('pcb'); }}><span className="key">→</span>同步到 PCB，开始布局</div>
      </div>
    </div>
  );
  const sym = getSymbol(comp.symbolId);
  const part = BUILTIN_PARTS.find((p) => p.mpn === (comp.props.mpn ?? comp.value));
  const pinNets = sym.pins.map((p) => ({ name: p.name, net: a.netlist.pinNet.get(`${comp.id}:${p.number}`) ?? '' }));
  const open = pinNets.filter((p) => !p.net).length;
  const pos = (v: number) => formatLength(milToMm(v), unit, unit === 'mm' ? 2 : 0);
  return (
    <div className="panel-pad">
      <div className="row">
        <span className="mono" style={{ fontWeight: 500, background: 'var(--bg-raised)', padding: '2px 6px', borderRadius: 4 }}>{comp.ref}</span><span className="muted" style={{ fontWeight: 500 }}>{sym.kind}</span>
        <span className="ml-auto muted" style={{ cursor: 'pointer' }} title="删除 (Del)" onClick={() => { editor.dispatch(sch.deleteComponents(sheet.id, [comp.id])); app.patch({ selection: [] }); }}>删除</span>
      </div>
      <div className="kv">
        <span className="k">值</span><ValueInput value={comp.value} onCommit={(v) => editor.dispatch(sch.setComponentValue(sheet.id, comp.id, v))} />
        {!sym.power && <><span className="k">封装</span>
          <select className="input mono" value={comp.footprint} onChange={(e) => editor.dispatch(sch.setComponentFootprint(sheet.id, comp.id, e.target.value))}>
            {BUILTIN_FOOTPRINTS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select></>}
        {part && <>
          <span className="k">数据手册</span><a href="#" onClick={(e) => e.preventDefault()}>{part.datasheet ?? `${part.mpn}.pdf`} ↗</a>
          <span className="k">供应商</span><span>LCSC {part.lcsc} · <span style={{ color: 'var(--success)' }}>{part.stock}</span> {part.price}</span>
          <span className="k">3D</span><div style={{ height: 64, borderRadius: 4, background: 'var(--bg-canvas)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 11 }}>[3D 预览]</div>
        </>}
        <span className="k">位置</span><div className="row" style={{ gap: 6 }}><span className="field mono grow"><span className="dim">X</span>{pos(comp.x)}</span><span className="field mono grow"><span className="dim">Y</span>{pos(comp.y)}</span></div>
        <span className="k">旋转</span><div className="seg sm">{[0, 90, 180, 270].map((r) => <span key={r} className={`seg-opt mono${comp.rotation === r ? ' on' : ''}`} onClick={() => editor.dispatch(sch.rotateComponent(sheet.id, comp.id, r - comp.rotation))}>{r}°</span>)}</div>
      </div>
      <div className="divider" />
      <div className="col" style={{ gap: 6 }}>
        <div className="row"><span className="muted">引脚</span><span className="mono">{part?.pinCount ?? sym.pins.length}</span><span className="ml-auto muted">{sym.power ? '' : open ? `${open} 未连接` : '全部已连接'}</span></div>
        {pinNets.map((p, i) => <div key={i} className="pin-row"><span className="dot" style={{ background: p.net || sym.power ? 'var(--success)' : 'var(--error)' }} /><span>{p.name}</span><span className="ml-auto muted">{sym.power ? comp.value : p.net || '—'}</span></div>)}
      </div>
      <div className="row"><span className="muted">自定义属性</span><span className="ml-auto" style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => app.toast('自定义属性编辑在下一里程碑')}>+ 添加</span></div>
    </div>
  );
}
