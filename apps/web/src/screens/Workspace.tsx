import { modelFor, needsModel } from '../editors/three/models.js';
import { useEffect } from 'react';
import { sch, pcb, copperLayers, LAYER_COLORS, netClassFor, milToMm, formatLength, snapTo, SCH_GRID, getSymbol, boardBounds, paperSize, type CheckItem } from '@tracelet/kernel';
import { SheetFrameDialog } from '../components/SheetFrameDialog.js';
type Clipboard = sch.Clipboard;
import { useState } from 'react';
import { useApp, useEditor, useProject, useSheet } from '../store/app.js';
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
  { id: 'wire', name: '连线', key: 'W', d: I.wire, desc: '点引脚或空白处开始，逐点画正交导线，双击 / 点到引脚或导线结束。任何时候点引脚都能开始连线。' },
  { id: 'place', name: '放元件', key: 'A', d: I.comp, desc: '右侧变成元件搜索：按型号、参数或自然语言找零件，符号 + 封装 + 3D 一起带入。' },
  { id: 'pwr', name: '电源 / 地', key: 'P', d: I.pwr, desc: '一键放置 +3V3 / +5V / VCC / GND 符号。' },
  { id: 'label', name: '网络标签', key: 'L', d: I.tag, desc: '给导线命名，同名标签自动连通（跨页也连通）。' },
  { id: 'bus', name: '总线', key: 'B', d: I.bus, desc: '画一条粗总线；连到总线的导线用标签（D0、D1…）命名，总线上放 NAME[0..7] 标签。' },
  { id: 'junction', name: '结点', key: 'J', d: I.junc, desc: '在导线交叉处放置结点，使其相连。' },
  { id: 'draw', name: '图形', key: 'G', d: I.draw, desc: '线条 / 矩形 / 注释文字，不影响电气连接。' },
  { id: 'measure', name: '测量', key: 'M', d: I.ruler, desc: '点两点显示距离与 ΔX / ΔY。' }
];
const PCB_TOOLS: ToolDef[] = [
  { id: 'select', name: '选择', key: 'V', d: I.sel, desc: '点选焊盘会高亮整条网络；Esc 取消。' },
  { id: 'route', name: '走线', key: 'X', d: I.route, desc: '点击焊盘开始；默认 45° 拐角；双击结束。走线中按 V 放过孔换层。' },
  { id: 'via', name: '过孔', key: '', d: I.via, desc: '放置过孔，尺寸跟随网络类。' },
  { id: 'zone', name: '铺铜', key: 'Z', d: I.zone, desc: '画一个区域并选网络（默认 GND），自动填充铜。' },
  { id: 'place', name: '放置', key: 'A', d: I.comp, desc: '在板上直接放仅板级封装：定位孔、基准点、Logo、测试点（不进原理图 / BOM）。' },
  { id: 'hole', name: '开孔', key: 'H', d: I.junc, desc: '点击放置螺丝孔（M2–M4 非金属化）或金属化通孔；盘中孔请用过孔工具点在焊盘上。' },
  { id: 'edge', name: '板框', key: 'E', d: I.edge, desc: '改长宽、拖动整板（可连同元件）、板框自动包住内容；拖顶点微调，点板外画新的多边形板框（双击闭合）。' },
  { id: 'text', name: '文字', key: 'T', d: I.text, desc: '在丝印层写文字，如版本号、标识。' },
  { id: 'measure', name: '测量', key: 'M', d: I.ruler, desc: '点两点显示距离与 ΔX / ΔY。' },
  { id: 'flip', name: '翻面', key: 'F', d: I.flip, desc: '把选中元件放到板子另一面。', sep: true },
  { id: 'align', name: '对齐 / 分布', key: 'L', d: I.align, desc: '框选 2 个以上元件后：左/右/上/下对齐、居中、等距分布。' },
  { id: 'autoroute', name: '自动布线', key: '', d: I.auto, desc: '内置网格 A* 布线器布完剩余飞线（支持过孔换层），结果先以"建议"预览，接受后才生效，可 Undo。' },
  { id: 'refill', name: '重填铺铜', key: 'B', d: I.refill, desc: '移动元件后重新计算铺铜区域。' }
];
let clipboard: Clipboard | null = null;
const DRAW_MODES: ['line' | 'rect' | 'text', string, string][] = [['line', '线条', '点击加点 · 双击结束'], ['rect', '矩形', '点两个对角'], ['text', '文字', '点击放置注释']];
const PWR_OPTIONS = [['+3V3', '#C0392B', '常用 · 3.3V 逻辑'], ['+5V', '#C0392B', 'USB 供电'], ['VCC', '#C0392B', '通用电源'], ['GND', '#1F5F2B', '地']];

export function Workspace() {
  const project = useProject();
  const editor = useEditor();
  const app = useApp();
  const a = getAnalysis(project);
  const { screen, focusMode } = app;
  const sheet = useSheet();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [frameDialog, setFrameDialog] = useState(false);
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
      const sheetId = S.sheetId ?? editor.project.schematic.sheets[0].id;
      const cur = editor.project.schematic.sheets.find((x) => x.id === sheetId) ?? editor.project.schematic.sheets[0];
      if (S.screen === 'sch' && mod && k === 'c') { if (S.selection.length) { clipboard = sch.copySelection(cur, S.selection); S.toast(`已复制 ${clipboard.components.length} 个元件`); } return; }
      if (S.screen === 'sch' && mod && k === 'v') { e.preventDefault(); if (clipboard) S.patch({ pasting: { clip: clipboard }, placing: null, pendingPin: null, schTool: 'select' }); else S.toast('剪贴板为空'); return; }
      if (S.screen === 'sch' && mod && k === 'd') { e.preventDefault(); if (S.selection.length) { const clip = sch.copySelection(cur, S.selection); const r = sch.pasteClipboard(editor.project, sheetId, clip, { x: clip.anchor.x + 300, y: clip.anchor.y + 300 }); editor.dispatch(r.command); S.patch({ selection: r.ids }); } return; }
      if (S.screen === 'sch' && mod && k === 'a') { e.preventDefault(); S.patch({ selection: [...cur.components.map((c) => c.id), ...cur.wires.map((w) => w.id), ...cur.labels.map((l) => l.id)] }); return; }
      if (mod) return;
      if (e.key === 'Tab') { e.preventDefault(); S.set('focusMode', !S.focusMode); return; }
      if (e.key === 'Home' || (k === 'f' && S.screen === 'sch' && !S.selection.length)) { e.preventDefault(); S.set('fitSeq', S.fitSeq + 1); return; }
      if (e.key === '?') { S.toast(S.screen === 'pcb' ? '快捷键：X 走线 · V 过孔换层 · Z 铺铜 · A 放置 · H 开孔 · E 板框 · T 文字 · M 测量 · F 翻面 · R 旋转 · L 对齐 · 1-9 切层 · Home 适配 · ⌘Z 撤销' : '快捷键：A 放元件 · W 连线 · P 电源 · L 标签 · B 总线 · J 结点 · G 图形 · R 旋转 · X 镜像 · F/Home 适配全图 · 双击元件改值 · 双击标签改名 · ⌘C/V/D 复制粘贴 · ⌘K 命令面板'); return; }
      if (e.key === 'F8') { e.preventDefault(); const rep = S.screen === 'pcb' ? a.drc : a.erc; if (!rep.items.length) return; const i = rep.items.findIndex((x) => x.id === S.checkHighlight); const n = rep.items[(i + (e.shiftKey ? -1 : 1) + rep.items.length) % rep.items.length]; locateItem(n, S.screen === 'pcb' ? 'pcb' : 'sch'); return; }
      if (S.screen === 'sch') {
        if (e.key === 'Escape') {
          if (S.pasting) S.patch({ pasting: null }); else if (S.placing) S.stopPlacing(); else if (S.wireDraft || S.busDraft || S.drawDraft || S.measure) S.patch({ wireDraft: null, busDraft: null, drawDraft: null, measure: null }); else if (S.pendingPin) S.patch({ pendingPin: null }); else if (S.labelPrompt) S.patch({ labelPrompt: null }); else if (S.pwrMenuOpen || S.drawMenuOpen) S.patch({ pwrMenuOpen: false, drawMenuOpen: false }); else if (S.schTool !== 'select') S.setSchTool('select'); else S.patch({ selection: [], highlightNet: null, checkHighlight: null });
        }
        else if (k === 'x' && S.selection.length) { editor.begin('镜像'); for (const id of S.selection) if (cur.components.some((c) => c.id === id)) editor.dispatch(sch.mirrorComponent(sheetId, id)); editor.commit(); }
        else if (k === 'a') S.setSchTool('place');
        else if (k === 'w') S.setSchTool('wire');
        else if (k === 'v') S.setSchTool('select');
        else if (k === 'p') S.setSchTool('pwr');
        else if (k === 'l') S.setSchTool('label');
        else if (k === 'b') S.setSchTool('bus');
        else if (k === 'j') S.setSchTool('junction');
        else if (k === 'g') S.setSchTool('draw');
        else if (k === 'm') S.setSchTool('measure');
        else if (k === 'r') {
          if (S.placing) S.patch({ placing: { ...S.placing, rotation: (S.placing.rotation + 90) % 360 } });
          else if (S.selection.length) { editor.begin('旋转'); for (const id of S.selection) editor.dispatch(sch.rotateComponent(sheetId, id, 90)); editor.commit(); }
          else S.startPlacing({ symbolId: 'sym:R', value: '10kΩ', footprint: 'fp:R_0402', rotation: 0, partLabel: '电阻' });
        }
        else if (k === 'c') S.startPlacing({ symbolId: 'sym:C', value: '100nF', footprint: 'fp:C_0402', rotation: 0, partLabel: '电容' });
        else if (k === 'd') S.startPlacing({ symbolId: 'sym:LED', value: '红 0603', footprint: 'fp:LED_0603', rotation: 0, partLabel: 'LED' });
        else if ((e.key === 'Delete' || e.key === 'Backspace') && S.selection.length) {
          const has = (arr: { id: string }[]) => S.selection.filter((id) => arr.some((x) => x.id === id));
          const comps = has(cur.components), labels = has(cur.labels), wires = has(cur.wires), buses = has(cur.buses ?? []), graphics = has(cur.graphics ?? []), junctions = has(cur.junctions);
          editor.begin('删除');
          if (comps.length) editor.dispatch(sch.deleteComponents(sheetId, comps));
          if (labels.length) editor.dispatch(sch.deleteLabels(sheetId, labels));
          if (wires.length) editor.dispatch(sch.deleteWires(sheetId, wires));
          if (buses.length) editor.dispatch(sch.deleteBuses(sheetId, buses));
          if (graphics.length) editor.dispatch(sch.deleteGraphics(sheetId, graphics));
          if (junctions.length) editor.dispatch(sch.deleteJunctions(sheetId, junctions));
          editor.commit();
          S.patch({ selection: [] });
        }
        else return;
        e.preventDefault();
      } else if (S.screen === 'pcb') {
        if (e.key === 'Escape') { if (S.autoroute.status !== 'idle') S.patch({ autoroute: { status: 'idle', result: null } }); else if (S.placement.status !== 'idle') S.patch({ placement: { status: 'idle', result: null } }); else if (S.pcbPlacing) S.patch({ pcbPlacing: null }); else if (S.routing || S.zoneDraft || S.outlineDraft || S.measure) S.patch({ routing: null, zoneDraft: null, outlineDraft: null, measure: null }); else if (S.pcbTool !== 'select') S.setPcbTool('select'); else S.patch({ pcbSelection: [], highlightNet: null, checkHighlight: null }); }
        else if (k === 'v') {
          if (S.routing) {
            const r = S.routing; const last = r.points[r.points.length - 1];
            const nc = netClassFor(editor.project.board, r.net);
            editor.begin('过孔换层');
            if (r.points.length >= 2) editor.dispatch(pcb.addTrace({ layer: r.layer, net: r.net, width: r.width, points: r.points }).command);
            editor.dispatch(pcb.addVia({ x: last.x, y: last.y, size: S.viaOverride?.size ?? nc?.viaSize ?? 0.6, drill: S.viaOverride?.drill ?? nc?.viaDrill ?? 0.3, net: r.net }));
            editor.commit();
            const next = r.layer === 'F.Cu' ? 'B.Cu' : 'F.Cu';
            S.patch({ routing: { ...r, points: [last], layer: next, startPad: undefined }, activeLayer: next });
          } else S.setPcbTool('select');
        }
        else if (k === 'x') S.setPcbTool('route');
        else if (k === 'z') S.setPcbTool('zone');
        else if (k === 'a') S.setPcbTool('place');
        else if (k === 'h') S.setPcbTool('hole');
        else if (k === 'e') S.setPcbTool('edge');
        else if (k === 'l') S.setPcbTool('align');
        else if (k === 't') S.setPcbTool('text');
        else if (k === 'm') S.setPcbTool('measure');
        else if (k === 'b') S.toast('铺铜实时计算，无需重填');
        else if (k === 'f') { const id = S.pcbSelection[0]; if (id && editor.project.board.footprints.some((f) => f.id === id)) editor.dispatch(pcb.flipFootprint(id)); else S.setPcbTool('flip'); }
        else if (k === 'r') { if (S.pcbPlacing) S.patch({ pcbPlacing: { ...S.pcbPlacing, rotation: (S.pcbPlacing.rotation + 90) % 360 } }); else { const id = S.pcbSelection[0]; if (id && editor.project.board.footprints.some((f) => f.id === id)) editor.dispatch(pcb.rotateFootprint(id, 90)); } }
        else if (/^[1-9]$/.test(k) && cu[Number(k) - 1]) S.set('activeLayer', cu[Number(k) - 1]);
        else if ((e.key === 'Delete' || e.key === 'Backspace') && S.pcbSelection.length) {
          const b = editor.project.board;
          const tr = S.pcbSelection.filter((id) => b.traces.some((t) => t.id === id)), vi = S.pcbSelection.filter((id) => b.vias.some((v) => v.id === id)), zo = S.pcbSelection.filter((id) => b.zones.some((z) => z.id === id)), tx = S.pcbSelection.filter((id) => b.texts.some((t) => t.id === id));
          const boardOnly = S.pcbSelection.filter((id) => b.footprints.some((f) => f.id === id && !f.componentId)), linked = S.pcbSelection.filter((id) => b.footprints.some((f) => f.id === id && f.componentId));
          if (!tr.length && !vi.length && !zo.length && !tx.length && !boardOnly.length) { if (linked.length) S.toast('该封装来自原理图：请在原理图删除元件后「同步到 PCB」'); return; }
          if (linked.length) S.toast(`${linked.length} 个来自原理图的封装未删除（请在原理图中删除）`);
          editor.begin('删除');
          if (tr.length) editor.dispatch(pcb.deleteTraces(tr)); if (vi.length) editor.dispatch(pcb.deleteVias(vi)); if (zo.length) editor.dispatch(pcb.deleteZones(zo)); if (tx.length) editor.dispatch(pcb.deleteTexts(tx)); if (boardOnly.length) editor.dispatch(pcb.deleteFootprints(boardOnly));
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

  const onSchTool = (id: string) => { app.setSchTool(id as typeof app.schTool); };
  const sheets = project.schematic.sheets;
  const addSheet = () => { const name = prompt('新图纸名称', `图纸 ${sheets.length + 1}`); if (!name) return; const r = sch.addSheet(name); editor.dispatch(r.command); app.patch({ sheetId: r.id, selection: [] }); };
  const removeSheet = (id: string) => { if (sheets.length <= 1) return; const sh = sheets.find((x) => x.id === id)!; if (sh.components.length && !confirm(`删除图纸「${sh.name}」及其中 ${sh.components.length} 个元件？`)) return; editor.dispatch(sch.deleteSheet(id)); app.patch({ sheetId: sheets.find((x) => x.id !== id)!.id, selection: [] }); };
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
  const PCB_GRIDS = [0.05, 0.1, 0.125, 0.25, 0.5, 1];
  const SCH_GRIDS = [25, 50, 100];
  const WIDTHS = [0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.8, 1.0, 1.5, 2.0];
  const VIAS: [number, number][] = [[0.5, 0.25], [0.6, 0.3], [0.7, 0.35], [0.8, 0.4], [1.0, 0.5], [1.2, 0.6]];
  const curWidth = app.routing?.width ?? app.traceWidthOverride ?? nc?.traceWidth ?? 0.25;
  const curVia = app.viaOverride ?? { size: nc?.viaSize ?? 0.6, drill: nc?.viaDrill ?? 0.3 };
  const statusItems = screen === 'pcb'
    ? [
      { text: `X ${pos(app.cursorWorld.x, 'pcb')}  Y ${pos(app.cursorWorld.y, 'pcb')} ${unit}` },
      { text: `栅格 ${app.pcbGrid} ▾`, title: '捕捉栅格 (mm)', options: PCB_GRIDS.map((g) => ({ label: `${g} mm`, value: String(g) })), value: String(app.pcbGrid), onSelect: (v: string) => app.set('pcbGrid', Number(v)) },
      { text: `● ${app.activeLayer} ▾`, color: LAYER_COLORS[app.activeLayer], title: '当前层', options: cu.map((l) => ({ label: l, value: l })), value: app.activeLayer, onSelect: (v: string) => app.set('activeLayer', v as typeof app.activeLayer) },
      { text: `走线 ${curWidth.toFixed(2)}${app.traceWidthOverride === null && !app.routing ? '' : ' ✎'} ▾`, title: '新走线宽度（"跟随网络类"为默认）', options: [{ label: '跟随网络类', value: 'auto' }, ...WIDTHS.map((w) => ({ label: `${w.toFixed(2)} mm`, value: String(w) }))], value: app.traceWidthOverride === null ? 'auto' : String(app.traceWidthOverride), onSelect: (v: string) => { const w = v === 'auto' ? null : Number(v); app.patch({ traceWidthOverride: w, routing: app.routing && w ? { ...app.routing, width: w } : app.routing }); } },
      { text: `过孔 ${curVia.size}/${curVia.drill}${app.viaOverride ? ' ✎' : ''} ▾`, title: '过孔外径 / 钻孔', options: [{ label: '跟随网络类', value: 'auto' }, ...VIAS.map(([a, b]) => ({ label: `${a} / ${b} mm`, value: `${a}/${b}` }))], value: app.viaOverride ? `${app.viaOverride.size}/${app.viaOverride.drill}` : 'auto', onSelect: (v: string) => { if (v === 'auto') app.set('viaOverride', null); else { const [a, b] = v.split('/').map(Number); app.set('viaOverride', { size: a, drill: b }); } } },
      { text: `${cu.length} 层 · ${project.board.thickness} mm`, title: '层数 / 板厚（在图层面板「层叠」修改）', onClick: () => app.set('rightTab', 'layers') },
      { text: a.drc.errors ? `DRC ● ${a.drc.errors} 错误` : a.drc.warnings ? `DRC ⚠ ${a.drc.warnings} 警告` : 'DRC ✓ 通过', color: drcColor, onClick: () => app.set('rightTab', 'check') }
    ]
    : screen === '3d'
      ? [{ text: { iso: '等轴视图', top: '俯视', front: '正面', back: '背面' }[app.view3d] }, { text: `元件 ${project.board.footprints.length} · 未匹配 ${project.board.footprints.filter(f => needsModel(f) && !modelFor(f, project.board)).length}`, color: 'var(--warning)' }, { text: `尺寸 ${bb.w.toFixed(0)}×${bb.h.toFixed(0)} mm` }]
      : [
        { text: `X ${pos(app.cursorWorld.x, 'sch')}  Y ${pos(app.cursorWorld.y, 'sch')} ${unit}` },
        { text: unit === 'mm' ? `栅格 ${(app.schGrid * 0.0254).toFixed(2)} ▾` : `栅格 ${app.schGrid} ▾`, title: '导线 / 图形捕捉栅格（元件引脚始终对齐 100 mil）', options: SCH_GRIDS.map((g) => ({ label: unit === 'mm' ? `${(g * 0.0254).toFixed(2)} mm` : `${g} mil`, value: String(g) })), value: String(app.schGrid), onSelect: (v: string) => app.set('schGrid', Number(v)) },
        { text: `页 ${project.schematic.sheets.findIndex((x) => x.id === sheet.id) + 1}/${project.schematic.sheets.length}` },
        { text: sel ? `选中 ${sel.ref}` : app.selection.length ? `选中 ${app.selection.length} 项` : '未选中' },
        { text: a.erc.errors ? `ERC ● ${a.erc.errors} 错误` : a.erc.warnings ? `ERC ⚠ ${a.erc.warnings} 警告` : 'ERC ✓ 通过', color: ercColor, onClick: () => app.set('rightTab', 'check') }
      ];

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
              {screen === 'sch' && app.drawMenuOpen && (
                <div className="menu" style={{ left: 52, top: 272, width: 200, background: 'var(--bg-raised)', padding: 8 }} onClick={(e) => e.stopPropagation()}>
                  <div className="dim xs" style={{ padding: '2px 6px' }}>图形 · 非电气</div>
                  {DRAW_MODES.map(([m, label, hint]) => <div key={m} className={`menu-item${app.drawMode === m ? ' on' : ''}`} onClick={() => app.patch({ drawMode: m, drawMenuOpen: false, drawDraft: null })}><span>{label}</span><span className="ml-auto dim xs">{hint}</span></div>)}
                </div>
              )}
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
                {sheets.map((s) => (
                  <span key={s.id} className={`pill row${s.id === sheet.id ? ' on' : ''}`} style={{ gap: 6 }} onClick={() => app.patch({ sheetId: s.id, selection: [] })} onDoubleClick={() => setRenaming(s.id)} title="双击重命名">
                    {renaming === s.id
                      ? <input autoFocus className="input mono" style={{ height: 22, width: 120 }} defaultValue={s.name} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { const v = (e.target as HTMLInputElement).value.trim(); if (v) editor.dispatch(sch.renameSheet(s.id, v)); setRenaming(null); } if (e.key === 'Escape') setRenaming(null); }} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== s.name) editor.dispatch(sch.renameSheet(s.id, v)); setRenaming(null); }} />
                      : <>{s.name}<span className="dim xs">{s.components.filter((c) => !getSymbol(c.symbolId).power).length}</span></>}
                    {sheets.length > 1 && s.id === sheet.id && renaming !== s.id && <span className="dim" style={{ marginLeft: 2 }} title="删除图纸" onClick={(e) => { e.stopPropagation(); removeSheet(s.id); }}>✕</span>}
                  </span>
                ))}
                <span className="pill dim" onClick={addSheet}>+ 新页</span>
                <span style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 6px' }} />
                <select className="input" style={{ width: 'auto', height: 24, fontSize: 11 }} value={sheet.frame.size} onChange={(e) => { const v = e.target.value as typeof sheet.frame.size; if (v === 'custom') { const cur = paperSize(sheet.frame) ?? { w: 11693, h: 8268 }; editor.dispatch(sch.setSheetFrame(sheet.id, { size: 'custom', width: sheet.frame.width ?? cur.w, height: sheet.frame.height ?? cur.h })); } else editor.dispatch(sch.setSheetFrame(sheet.id, { size: v })); }} title="图纸模板">
                  {(['A5', 'A4', 'A3', 'A2', 'A1', 'custom', 'none'] as const).map((sz) => <option key={sz} value={sz}>{sz === 'none' ? '无边框' : sz === 'custom' ? '自定义尺寸' : sz}</option>)}
                </select>
                {sheet.frame.size !== 'none' && sheet.frame.size !== 'custom' && <span className="seg sm" style={{ height: 24 }}><span className={`seg-opt${sheet.frame.landscape ? ' on' : ''}`} style={{ padding: '0 8px' }} onClick={() => editor.dispatch(sch.setSheetFrame(sheet.id, { landscape: true }))}>横</span><span className={`seg-opt${!sheet.frame.landscape ? ' on' : ''}`} style={{ padding: '0 8px' }} onClick={() => editor.dispatch(sch.setSheetFrame(sheet.id, { landscape: false }))}>纵</span></span>}
                {sheet.frame.size === 'custom' && (() => { const p = paperSize(sheet.frame)!; const mm = (v: number) => Math.round(v * 0.0254); return <span className="row mono xs" style={{ gap: 4 }}>
                  <input className="input mono" style={{ width: 56, height: 22 }} key={`w${p.w}`} defaultValue={mm(p.w)} onBlur={(e) => { const v = Number(e.target.value); if (v >= 50 && v <= 2000) editor.dispatch(sch.setSheetFrame(sheet.id, { width: Math.round(v / 0.0254) })); }} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />×
                  <input className="input mono" style={{ width: 56, height: 22 }} key={`h${p.h}`} defaultValue={mm(p.h)} onBlur={(e) => { const v = Number(e.target.value); if (v >= 50 && v <= 2000) editor.dispatch(sch.setSheetFrame(sheet.id, { height: Math.round(v / 0.0254) })); }} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /> mm</span>; })()}
                {sheet.frame.size !== 'none' && <button className="btn sm" style={{ height: 24 }} onClick={() => setFrameDialog(true)} title="标题、公司、版本、作者、日期与标签文字">标题栏…</button>}
                <span className="ml-auto dim xs">{sheet.components.filter((c) => !getSymbol(c.symbolId).power).length} 元件 · {sheet.wires.length} 导线 · {a.netlist.nets.length} 网络（全部页）</span>
              </div>
            )}
            {frameDialog && screen === 'sch' && <SheetFrameDialog close={() => setFrameDialog(false)} />}
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
