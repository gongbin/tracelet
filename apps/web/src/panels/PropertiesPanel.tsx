import { useEffect, useState } from 'react';
import { sch, pcb, getSymbol, BUILTIN_FOOTPRINTS, BUILTIN_PARTS, findFootprint, footprintPads, milToMm, formatLength, copperLayers, registeredFootprints, crossSheetLabelNames } from '@tracelet/kernel';
import { useApp, useEditor, useProject, useSheet } from '../store/app.js';
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
  const sheet = useSheet();
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
        <div className="kv">
          <span className="k">网络</span><span className="field mono">{tr.net || '—'}</span>
          <span className="k">层</span><select className="input mono" value={tr.layer} onChange={(e) => editor.dispatch(pcb.setTraceProps(tr.id, { layer: e.target.value as typeof tr.layer }))}>{copperLayers(project.board.copperCount).map((l) => <option key={l} value={l}>{l}</option>)}</select>
          <span className="k">宽度 (mm)</span><ValueInput value={String(tr.width)} onCommit={(v) => { const n = Number(v); if (n > 0) editor.dispatch(pcb.setTraceProps(tr.id, { width: n })); }} />
          <span className="k">段数</span><span className="field mono">{tr.points.length - 1}</span>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{[0.15, 0.25, 0.3, 0.5, 0.8, 1.0].map((w) => <span key={w} className={`chip mono${Math.abs(tr.width - w) < 1e-9 ? ' on' : ''}`} onClick={() => editor.dispatch(pcb.setTraceProps(tr.id, { width: w }))}>{w}</span>)}</div>
        <div className="dim xs">再次点击已选中的走线并拖动可平移线段；拖动黄色手柄移动顶点。</div>
      </div>
    );
    if (via) return (
      <div className="panel-pad">
        <div className="row"><span style={{ fontWeight: 500 }}>过孔</span><span className="ml-auto muted" style={{ cursor: 'pointer' }} onClick={() => { editor.dispatch(pcb.deleteVias([via.id])); app.patch({ pcbSelection: [] }); }}>删除</span></div>
        <div className="kv">
          <span className="k">网络</span><ValueInput value={via.net} onCommit={(v) => editor.dispatch(pcb.setViaProps(via.id, { net: v }))} />
          <span className="k">外径 (mm)</span><ValueInput value={String(via.size)} onCommit={(v) => { const n = Number(v); if (n > 0) editor.dispatch(pcb.setViaProps(via.id, { size: n })); }} />
          <span className="k">孔径 (mm)</span><ValueInput value={String(via.drill)} onCommit={(v) => { const n = Number(v); if (n > 0) editor.dispatch(pcb.setViaProps(via.id, { drill: n })); }} />
          <span className="k">位置</span><div className="row" style={{ gap: 6 }}><ValueInput value={via.x.toFixed(2)} onCommit={(v) => editor.dispatch(pcb.setViaProps(via.id, { x: Number(v) }))} /><ValueInput value={via.y.toFixed(2)} onCommit={(v) => editor.dispatch(pcb.setViaProps(via.id, { y: Number(v) }))} /></div>
        </div>
      </div>
    );
    const txt = project.board.texts.find((t) => t.id === id);
    if (txt) return (
      <div className="panel-pad">
        <div className="row"><span style={{ fontWeight: 500 }}>丝印文字</span><span className="ml-auto muted" style={{ cursor: 'pointer' }} onClick={() => { editor.dispatch(pcb.deleteTexts([txt.id])); app.patch({ pcbSelection: [] }); }}>删除</span></div>
        <div className="kv">
          <span className="k">内容</span><ValueInput value={txt.text} onCommit={(v) => editor.dispatch(pcb.setTextProps(txt.id, { text: v }))} />
          <span className="k">大小 (mm)</span><ValueInput value={String(txt.size)} onCommit={(v) => { const n = Number(v); if (n > 0) editor.dispatch(pcb.setTextProps(txt.id, { size: n })); }} />
          <span className="k">层</span><div className="seg sm">{(['F.Silk', 'B.Silk'] as const).map((l) => <span key={l} className={`seg-opt mono${txt.layer === l ? ' on' : ''}`} onClick={() => editor.dispatch(pcb.setTextProps(txt.id, { layer: l }))}>{l}</span>)}</div>
        </div>
      </div>
    );
    if (zone) return (
      <div className="panel-pad">
        <div className="row"><span style={{ fontWeight: 500 }}>铺铜</span><span className="ml-auto muted" style={{ cursor: 'pointer' }} onClick={() => { editor.dispatch(pcb.deleteZones([zone.id])); app.patch({ pcbSelection: [] }); }}>删除</span></div>
        <div className="kv">
          <span className="k">网络</span><select className="input mono" value={zone.net} onChange={(e) => editor.dispatch(pcb.setZoneProps(zone.id, { net: e.target.value }))}><option value="">（无）</option>{a.netlist.nets.map((n) => <option key={n.name} value={n.name}>{n.name}</option>)}</select>
          <span className="k">层</span><select className="input mono" value={zone.layer} onChange={(e) => editor.dispatch(pcb.setZoneProps(zone.id, { layer: e.target.value as typeof zone.layer }))}>{copperLayers(project.board.copperCount).map((l) => <option key={l} value={l}>{l}</option>)}</select>
          <span className="k">焊盘连接</span><div className="seg sm"><span className={`seg-opt${(zone.thermal ?? 'relief') === 'relief' ? ' on' : ''}`} onClick={() => editor.dispatch(pcb.setZoneProps(zone.id, { thermal: 'relief' }))}>热焊盘</span><span className={`seg-opt${zone.thermal === 'solid' ? ' on' : ''}`} onClick={() => editor.dispatch(pcb.setZoneProps(zone.id, { thermal: 'solid' }))}>实心</span></div>
          {(zone.thermal ?? 'relief') === 'relief' && <>
            <span className="k">热焊盘间隙</span><ValueInput value={String(zone.thermalGap ?? 0.3)} onCommit={(v) => { const n = Number(v); if (n > 0) editor.dispatch(pcb.setZoneProps(zone.id, { thermalGap: n })); }} />
            <span className="k">辐条宽度</span><ValueInput value={String(zone.spokeWidth ?? 0.4)} onCommit={(v) => { const n = Number(v); if (n > 0) editor.dispatch(pcb.setZoneProps(zone.id, { spokeWidth: n })); }} />
          </>}
          <span className="k">间距 (mm)</span><ValueInput value={zone.clearance ? String(zone.clearance) : ''} onCommit={(v) => editor.dispatch(pcb.setZoneProps(zone.id, { clearance: Number(v) || 0 }))} />
          <span className="k">顶点</span><span className="field mono">{zone.polygon.length}</span>
        </div>
        <div className="dim xs">间距留空 = 使用网络类 / 板厂规则；热焊盘让焊盘更容易焊接，大电流路径可改实心。</div>
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
  const crossSheetNames = crossSheetLabelNames(project.schematic);
  if (label) return (
    <div className="panel-pad">
      <div className="row"><span style={{ fontWeight: 500 }}>网络标签</span><span className="ml-auto muted" style={{ cursor: 'pointer' }} onClick={() => { editor.dispatch(sch.deleteLabels(sheet.id, [label.id])); app.patch({ selection: [] }); }}>删除</span></div>
      <div className="kv"><span className="k">名称</span><span className="field mono">{label.text}</span></div>
      <div className="dim xs">同名标签自动相连（含其他图纸）{crossSheetNames.has(label.text) ? ' · 此网络也出现在其他图纸' : ''}。</div>
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
            {[...BUILTIN_FOOTPRINTS, ...registeredFootprints()].map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            {comp.footprint && !findFootprint(comp.footprint) && <option value={comp.footprint}>{comp.footprint.replace(/^fp:kicad:/, '')}（未解析，同步时映射/占位）</option>}
          </select></>}
        {part && <>
          <span className="k">数据手册</span>{/^https?:\/\//.test(comp.props.datasheet ?? '') ? <a href={comp.props.datasheet} target="_blank" rel="noreferrer">{comp.props.datasheet!.replace(/^https?:\/\//, '').slice(0, 40)} ↗</a> : <a href={`https://so.szlcsc.com/global.html?k=${encodeURIComponent(part.mpn)}`} target="_blank" rel="noreferrer" title="在立创商城查找数据手册">{part.datasheet ?? `${part.mpn}.pdf`} ↗</a>}
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
      <div className="col" style={{ gap: 6 }}>
        <div className="row"><span className="muted">自定义属性</span><span className="ml-auto" style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => { const k = prompt('属性名（如 mpn、lcsc、datasheet、tolerance、note）'); const key = k?.trim(); if (!key) return; if (key in comp.props) { app.toast('已有同名属性'); return; } editor.dispatch(sch.setComponentProps(sheet.id, comp.id, { ...comp.props, [key]: '' })); }}>+ 添加</span></div>
        {Object.entries(comp.props).map(([k, v]) => (
          <div key={k} className="row" style={{ gap: 6 }}>
            <span className="mono xs muted nowrap" style={{ width: 72, overflow: 'hidden', textOverflow: 'ellipsis' }} title={k}>{k}</span>
            <div className="grow"><ValueInput value={v} onCommit={(nv) => editor.dispatch(sch.setComponentProps(sheet.id, comp.id, { ...comp.props, [k]: nv }))} /></div>
            <span className="dim" style={{ cursor: 'pointer' }} title="删除属性" onClick={() => { const n = { ...comp.props }; delete n[k]; editor.dispatch(sch.setComponentProps(sheet.id, comp.id, n)); }}>✕</span>
          </div>
        ))}
        {Object.keys(comp.props).length === 0 && <div className="dim xs">无 · 常用：mpn（型号）、lcsc（立创编号，导出 BOM 会带上）、datasheet（链接）</div>}
      </div>
    </div>
  );
}
