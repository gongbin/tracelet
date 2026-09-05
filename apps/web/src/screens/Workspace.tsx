import { useEffect } from 'react';
import { sch, pcb, copperLayers, LAYER_COLORS, netClassFor, milToMm, formatLength, snapTo, SCH_GRID, getSymbol, boardBounds, type CheckItem } from '@tracelet/kernel';
import { useApp, useEditor, useProject } from '../store/app.js';
import { getAnalysis } from '../store/analysis.js';
import { TopBar } from '../components/TopBar.js';
import { Toolbar, type ToolDef } from '../components/Toolbar.js';
import { StatusBar } from '../components/StatusBar.js';
import { BottomBar } from '../components/BottomBar.js';
import { RightPanel } from '../panels/RightPanel.js';
import { locateItem } from '../panels/CheckPanel.js';
import { SchematicCanvas } from '../editors/schematic/SchematicCanvas.js';
import { PcbCanvas } from '../editors/pcb/PcbCanvas.js';
import { ThreeView } from '../editors/three/ThreeView.js';
import { FabPage } from './FabPage.js';
import { LibPage } from './LibPage.js';
import { BomPage } from './BomPage.js';
import { I } from '../icons.js';

const SCH_TOOLS: ToolDef[] = [
  { id: 'select', name: '选择', key: 'V', d: I.sel, desc: '点选或框选对象；拖动元件时导线会跟随。' },
  { id: 'wire', name: '连线', key: 'W', d: I.wire, desc: '点一个引脚开始，再点另一个引脚结束；正交自动折线。其实不用切换工具——任何时候点引脚都能开始连线。' },
  { id: 'place', name: '放元件', key: 'A', d: I.comp, desc: '右侧变成元件搜索：按型号、参数或自然语言找零件，符号 + 封装 + 3D 一起带入。' },
  { id: 'pwr', name: '电源 / 地', key: 'P', d: I.pwr, desc: '一键放置 +3V3 / +5V / VCC / GND 符号。' },
  { id: 'label', name: '网络标签', key: 'L', d: I.tag, desc: '给导线命名，同名标签自动连通。' },
  { id: 'bus', name: '总线', key: 'B', d: I.bus, desc: '把一组信号画成一条粗线，减少图纸杂乱。' },
  { id: 'junction', name: '结点', key: 'J', d: I.junc, desc: '手动放置连接点，标记导线交叉处相连。' },
  { id: 'draw', name: '图形', key: 'G', d: I.draw, desc: '画框、线、注释文字，不影响电气连接。' },
  { id: 'measure', name: '测量', key: 'M', d: I.ruler, desc: '点两点显示距离与 ΔX / ΔY。' }
];
const PCB_TOOLS: ToolDef[] = [
  { id: 'select', name: '选择', key: 'V', d: I.sel, desc: '点选焊盘会高亮整条网络；Esc 取消。' },
  { id: 'route', name: '走线', key: 'X', d: I.route, desc: '点击焊盘开始；默认 45° 拐角；双击结束。走线中按 V 放过孔换层。' },
  { id: 'via', name: '过孔', key: '', d: I.via, desc: '放置过孔，尺寸跟随网络类。' },
  { id: 'zone', name: '铺铜', key: 'Z', d: I.zone, desc: '画一个区域并选网络（默认 GND），自动填充铜。' },
  { id: 'place', name: '放置', key: 'A', d: I.comp, desc: '在 PCB 上直接放置新元件，同时同步回原理图。' },
  { id: 'edge', name: '板框', key: 'E', d: I.edge, desc: '拖动顶点调整板框，或点击画新的多边形板框（双击闭合）。' },
  { id: 'text', name: '文字', key: 'T', d: I.text, desc: '在丝印层写文字，如版本号、标识。' },
  { id: 'measure', name: '测量', key: 'M', d: I.ruler, desc: '点两点显示距离与 ΔX / ΔY。' },
  { id: 'flip', name: '翻面', key: 'F', d: I.flip, desc: '把选中元件放到板子另一面。', sep: true },
  { id: 'align', name: '对齐 / 分布', key: 'L', d: I.align, desc: '框选 2 个以上元件后：左/右/上/下对齐、居中、等距分布。' },
  { id: 'autoroute', name: '自动布线', key: '', d: I.auto, desc: '内置网格 A* 布线器布完剩余飞线（支持过孔换层），结果先以"建议"预览，接受后才生效，可 Undo。' },
  { id: 'refill', name: '重填铺铜', key: 'B', d: I.refill, desc: '移动元件后重新计算铺铜区域。' }
];
const PWR_OPTIONS = [['+3V3', '#C0392B', '常用 · 3.3V 逻辑'], ['+5V', '#C0392B', 'USB 供电'], ['VCC', '#C0392B', '通用电源'], ['GND', '#1F5F2B', '地']];

export function Workspace() {
  const project = useProject();
  const editor = useEditor();
  const app = useApp();
  const a = getAnalysis(project);
  const { screen, focusMode } = app;
  const sheet = project.schematic.sheets[0];
  const unit = project.settings.unit;
  const cu = copperLayers(project.board.copperCount);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable)) return;
      const S = useApp.getState();
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) editor.redo(); else editor.undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); editor.redo(); return; }
      if (mod && ['1', '2', '3'].includes(e.key)) { e.preventDefault(); S.go((['sch', 'pcb', '3d'] as const)[Number(e.key) - 1]); return; }
      if (mod) return;
      if (e.key === 'Tab') { e.preventDefault(); S.set('focusMode', !S.focusMode); return; }
      if (e.key === '?') { S.toast('快捷键：A 放元件 · W 连线 · P 电源 · L 标签 · R 旋转 · X 走线 · Z 铺铜 · 1-9 切层 · ⌘K 命令面板 · Tab 焦点模式'); return; }
      if (e.key === 'F8') { e.preventDefault(); const rep = S.screen === 'pcb' ? a.drc : a.erc; if (!rep.items.length) return; const i = rep.items.findIndex((x) => x.id === S.checkHighlight); const n = rep.items[(i + (e.shiftKey ? -1 : 1) + rep.items.length) % rep.items.length]; locateItem(n, S.screen === 'pcb' ? 'pcb' : 'sch'); return; }
      const sheetId = editor.project.schematic.sheets[0].id;
      if (S.screen === 'sch') {
        if (e.key === 'Escape') {
          if (S.placing) S.stopPlacing(); else if (S.pendingPin) S.patch({ pendingPin: null }); else if (S.labelPrompt) S.patch({ labelPrompt: null }); else if (S.pwrMenuOpen) S.patch({ pwrMenuOpen: false }); else if (S.schTool !== 'select') S.setSchTool('select'); else S.patch({ selection: [], highlightNet: null, checkHighlight: null });
        }
        else if (k === 'a') S.setSchTool('place');
        else if (k === 'w') S.setSchTool('wire');
        else if (k === 'v') S.setSchTool('select');
        else if (k === 'p') S.setSchTool('pwr');
        else if (k === 'l') S.setSchTool('label');
        else if (k === 'r') {
          if (S.placing) S.patch({ placing: { ...S.placing, rotation: (S.placing.rotation + 90) % 360 } });
          else if (S.selection.length) { editor.begin('旋转'); for (const id of S.selection) editor.dispatch(sch.rotateComponent(sheetId, id, 90)); editor.commit(); }
          else S.startPlacing({ symbolId: 'sym:R', value: '10kΩ', footprint: 'fp:R_0402', rotation: 0, partLabel: '电阻' });
        }
        else if (k === 'c') S.startPlacing({ symbolId: 'sym:C', value: '100nF', footprint: 'fp:C_0402', rotation: 0, partLabel: '电容' });
        else if (k === 'd') S.startPlacing({ symbolId: 'sym:LED', value: '红 0603', footprint: 'fp:LED_0603', rotation: 0, partLabel: 'LED' });
        else if ((e.key === 'Delete' || e.key === 'Backspace') && S.selection.length) {
          const comps = S.selection.filter((id) => sheet.components.some((c) => c.id === id));
          const labels = S.selection.filter((id) => sheet.labels.some((l) => l.id === id));
          editor.begin('删除');
          if (comps.length) editor.dispatch(sch.deleteComponents(sheetId, comps));
          if (labels.length) editor.dispatch(sch.deleteLabels(sheetId, labels));
          editor.commit();
          S.patch({ selection: [] });
        }
        else return;
        e.preventDefault();
      } else if (S.screen === 'pcb') {
        if (e.key === 'Escape') { if (S.autoroute.status === 'done') S.patch({ autoroute: { status: 'idle', result: null } }); else if (S.routing || S.zoneDraft || S.outlineDraft || S.measure) S.patch({ routing: null, zoneDraft: null, outlineDraft: null, measure: null }); else if (S.pcbTool !== 'select') S.setPcbTool('select'); else S.patch({ pcbSelection: [], highlightNet: null, checkHighlight: null }); }
        else if (k === 'v') {
          if (S.routing) {
            const r = S.routing; const last = r.points[r.points.length - 1];
            const nc = netClassFor(editor.project.board, r.net);
            editor.begin('过孔换层');
            if (r.points.length >= 2) editor.dispatch(pcb.addTrace({ layer: r.layer, net: r.net, width: r.width, points: r.points }).command);
            editor.dispatch(pcb.addVia({ x: last.x, y: last.y, size: nc?.viaSize ?? 0.6, drill: nc?.viaDrill ?? 0.3, net: r.net }));
            editor.commit();
            const next = r.layer === 'F.Cu' ? 'B.Cu' : 'F.Cu';
            S.patch({ routing: { ...r, points: [last], layer: next, startPad: undefined }, activeLayer: next });
          } else S.setPcbTool('select');
        }
        else if (k === 'x') S.setPcbTool('route');
        else if (k === 'z') S.setPcbTool('zone');
        else if (k === 'a') S.setPcbTool('place');
        else if (k === 'e') S.setPcbTool('edge');
        else if (k === 'l') S.setPcbTool('align');
        else if (k === 't') S.setPcbTool('text');
        else if (k === 'm') S.setPcbTool('measure');
        else if (k === 'b') S.toast('铺铜实时计算，无需重填');
        else if (k === 'f') { const id = S.pcbSelection[0]; if (id && editor.project.board.footprints.some((f) => f.id === id)) editor.dispatch(pcb.flipFootprint(id)); else S.setPcbTool('flip'); }
        else if (k === 'r') { const id = S.pcbSelection[0]; if (id && editor.project.board.footprints.some((f) => f.id === id)) editor.dispatch(pcb.rotateFootprint(id, 90)); }
        else if (/^[1-9]$/.test(k) && cu[Number(k) - 1]) S.set('activeLayer', cu[Number(k) - 1]);
        else if ((e.key === 'Delete' || e.key === 'Backspace') && S.pcbSelection.length) {
          const b = editor.project.board;
          const tr = S.pcbSelection.filter((id) => b.traces.some((t) => t.id === id)), vi = S.pcbSelection.filter((id) => b.vias.some((v) => v.id === id)), zo = S.pcbSelection.filter((id) => b.zones.some((z) => z.id === id)), tx = S.pcbSelection.filter((id) => b.texts.some((t) => t.id === id));
          if (!tr.length && !vi.length && !zo.length && !tx.length) { S.toast('封装由原理图决定：请在原理图删除元件后同步'); return; }
          editor.begin('删除');
          if (tr.length) editor.dispatch(pcb.deleteTraces(tr)); if (vi.length) editor.dispatch(pcb.deleteVias(vi)); if (zo.length) editor.dispatch(pcb.deleteZones(zo)); if (tx.length) editor.dispatch(pcb.deleteTexts(tx));
          editor.commit(); S.patch({ pcbSelection: [] });
        }
        else return;
        e.preventDefault();
      } else if (S.screen === '3d') {
        if (e.key === 'Escape') S.patch({ pcbSelection: [] });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor, a, sheet, cu]);

  const onSchTool = (id: string) => {
    if (id === 'bus' || id === 'junction' || id === 'draw' || id === 'measure') { app.toast(`${SCH_TOOLS.find((t) => t.id === id)?.name} 在下一里程碑`); return; }
    app.setSchTool(id as typeof app.schTool);
  };
  const onPcbTool = (id: string) => {
    if (id === 'refill') { app.toast('铺铜实时计算，无需重填'); return; }
    if (id === 'autoroute') { if (a.ratsnest.unrouted === 0) { app.toast('没有未布线的连接'); return; } app.patch({ pcbTool: 'autoroute', routing: null, zoneDraft: null, outlineDraft: null, measure: null }); return; }
    app.setPcbTool(id as typeof app.pcbTool);
  };

  // ---- 状态栏 / 底栏数据 ----
  const pos = (v: number, space: 'sch' | 'pcb') => space === 'sch' ? formatLength(milToMm(snapTo(v, SCH_GRID)), unit, unit === 'mm' ? 2 : 0) : formatLength(v, unit, 2);
  const ercColor = a.erc.errors ? 'var(--error)' : a.erc.warnings ? 'var(--warning)' : 'var(--success)';
  const drcColor = a.drc.errors ? 'var(--error)' : a.drc.warnings ? 'var(--warning)' : 'var(--success)';
  const sel = sheet.components.find((c) => app.selection.includes(c.id));
  const nc = netClassFor(project.board, app.routing?.net ?? '');
  const bb = boardBounds(project.board);
  const statusItems = screen === 'pcb'
    ? [{ text: `X ${pos(app.cursorWorld.x, 'pcb')}  Y ${pos(app.cursorWorld.y, 'pcb')} ${unit}` }, { text: '栅格 0.25 ▾' }, { text: `● ${app.activeLayer} ▾`, color: LAYER_COLORS[app.activeLayer], onClick: () => app.set('activeLayer', cu[(cu.indexOf(app.activeLayer) + 1) % cu.length]) }, { text: `走线 ${(app.routing?.width ?? nc?.traceWidth ?? 0.25).toFixed(2)} ▾` }, { text: `过孔 ${nc?.viaSize ?? 0.6}/${nc?.viaDrill ?? 0.3} ▾` }, { text: `${cu.length} 层` }, { text: a.drc.errors ? `DRC ● ${a.drc.errors} 错误` : a.drc.warnings ? `DRC ⚠ ${a.drc.warnings} 警告` : 'DRC ✓ 通过', color: drcColor, onClick: () => app.set('rightTab', 'check') }]
    : screen === '3d'
      ? [{ text: { iso: '等轴视图', top: '俯视', front: '正面', back: '背面' }[app.view3d] }, { text: `元件 ${project.board.footprints.length} · 占位模型 ${project.board.footprints.length}`, color: 'var(--warning)' }, { text: `尺寸 ${bb.w.toFixed(0)}×${bb.h.toFixed(0)} mm` }]
      : [{ text: `X ${pos(app.cursorWorld.x, 'sch')}  Y ${pos(app.cursorWorld.y, 'sch')} ${unit}` }, { text: unit === 'mm' ? '栅格 2.54 ▾' : '栅格 100 ▾' }, { text: `页 1/${project.schematic.sheets.length}` }, { text: sel ? `选中 ${sel.ref}` : app.selection.length ? `选中 ${app.selection.length} 项` : '未选中' }, { text: a.erc.errors ? `ERC ● ${a.erc.errors} 错误` : a.erc.warnings ? `ERC ⚠ ${a.erc.warnings} 警告` : 'ERC ✓ 通过', color: ercColor, onClick: () => app.set('rightTab', 'check') }];

  const toRow = (i: CheckItem, space: 'sch' | 'pcb') => ({ id: i.id, mark: i.severity === 'error' ? '●' : '⚠', color: i.severity === 'error' ? 'var(--error)' : 'var(--warning)', text: i.message, where: i.refs.join(' · '), onLocate: () => locateItem(i, space) });
  const problems = screen === 'pcb' ? a.drc.items.map((i) => toRow(i, 'pcb')) : a.erc.items.map((i) => toRow(i, 'sch'));
  const summary = screen === 'pcb'
    ? [{ text: `${a.drc.errors ? '●' : '○'} ${a.drc.errors} 错误 · ${a.drc.warnings} 警告`, color: drcColor }, { text: `未布线 ${a.ratsnest.unrouted}/${a.ratsnest.total}`, color: a.ratsnest.unrouted ? 'var(--text-2)' : 'var(--success)' }, { text: `网络 ${a.netlist.nets.length}` }, { text: `历史 ${editor.historyLabels.length}` }]
    : [{ text: `${a.erc.warnings ? '⚠' : '✓'} ${a.netlist.unconnectedPins.length} 引脚未连接 · ${a.erc.errors} 错误`, color: ercColor }, { text: `导线 ${sheet.wires.length}` }, { text: `网络 ${a.netlist.nets.length}` }, { text: `历史 ${editor.historyLabels.length}` }];
  const nets = a.netlist.nets.map((n) => ({ name: n.name, count: n.pins.length }));

  const isEditor = screen === 'sch' || screen === 'pcb' || screen === '3d';
  return (
    <div className="col" style={{ flex: 1, minHeight: 0, gap: 0 }}>
      <TopBar />
      {screen === 'fab' && <FabPage />}
      {screen === 'lib' && <LibPage />}
      {screen === 'bom' && <BomPage />}
      {isEditor && (
        <div className="editor-body">
          {!focusMode && screen !== '3d' && (
            <Toolbar tools={screen === 'pcb' ? PCB_TOOLS : SCH_TOOLS} active={screen === 'pcb' ? app.pcbTool : app.schTool} onSelect={screen === 'pcb' ? onPcbTool : onSchTool}>
              {screen === 'sch' && app.pwrMenuOpen && (
                <div className="menu" style={{ left: 52, top: 120, width: 210, background: 'var(--bg-raised)', padding: 8 }} onClick={(e) => e.stopPropagation()}>
                  <div className="dim xs" style={{ padding: '2px 6px' }}>电源 / 地 · 选一个然后点画布</div>
                  {PWR_OPTIONS.map(([label, color, hint]) => (
                    <div key={label} className="menu-item" onClick={() => app.startPlacing({ symbolId: label === 'GND' ? 'sym:GND' : 'sym:PWR', value: label, footprint: '', rotation: 0, partLabel: label })}>
                      <span className="dot" style={{ width: 8, height: 8, background: color }} /><span className="mono">{label}</span><span className="ml-auto muted">{hint}</span>
                    </div>
                  ))}
                </div>
              )}
            </Toolbar>
          )}
          <div className="canvas-col">
            {screen === 'sch' && (
              <div className="subbar">
                {project.schematic.sheets.map((s, i) => <span key={s.id} className={`pill${i === 0 ? ' on' : ''}`}>Sheet: {s.name} <span className="muted">▾</span></span>)}
                <span className="pill dim" onClick={() => app.toast('多页图纸在下一里程碑')}>+ 新页</span>
                <span className="ml-auto dim xs">{sheet.components.filter((c) => !getSymbol(c.symbolId).power).length} 元件 · {sheet.wires.length} 导线 · {a.netlist.nets.length} 网络</span>
              </div>
            )}
            {screen === 'sch' ? <SchematicCanvas /> : screen === 'pcb' ? <PcbCanvas /> : <ThreeView />}
            {!focusMode && screen !== '3d' && <BottomBar summary={summary} problems={problems} nets={nets} />}
          </div>
          {!focusMode && <RightPanel />}
        </div>
      )}
      <StatusBar items={statusItems} zoom={undefined} />
    </div>
  );
}
