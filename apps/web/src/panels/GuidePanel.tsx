import { pcb, getSymbol, boardBounds, DEFAULT_STACKUP, checkPlacement } from '@tracelet/kernel';
import { useApp, useEditor, useProject, useSheet } from '../store/app.js';
import { getAnalysis } from '../store/analysis.js';
import { locateItem } from './CheckPanel.js';

type Status = 'done' | 'todo' | 'warn' | 'skip';
interface Step { title: string; status: Status; detail: string; actions?: { label: string; run: () => void; primary?: boolean }[]; tip?: string }

/** 完成一块板的分步向导：每步自动判断状态并给出一键操作，布线后自动打开。 */
export function GuidePanel() {
  const project = useProject();
  const editor = useEditor();
  const app = useApp();
  const sheet = useSheet();
  const a = getAnalysis(project);
  const b = project.board;
  const bb = boardBounds(b);
  const comps = project.schematic.sheets.flatMap((s) => s.components).filter((c) => !getSymbol(c.symbolId).power);
  const drcBy = (rule: string) => a.drc.items.filter((i) => i.rule === rule);
  const netNames = new Set(a.netlist.nets.map((n) => n.name));
  const gndNet = ['GND', 'AGND', 'DGND', 'VSS'].find((n) => netNames.has(n)) ?? [...netNames].find((n) => /gnd/i.test(n));
  const gndZones = b.zones.filter((z) => z.net && z.net === gndNet);
  const hasVersion = b.texts.some((t) => /v\d/i.test(t.text));
  const holes = b.footprints.filter((f) => !f.componentId && /^H\d/.test(f.ref)).length;
  const pendingSync = comps.length !== b.footprints.filter((f) => f.componentId).length;
  const placementIssues = b.footprints.length ? checkPlacement(b, a.rules) : [];
  const placementErrors = placementIssues.filter((i) => i.severity === 'error'), placementWarns = placementIssues.filter((i) => i.severity !== 'error');
  const st = { ...DEFAULT_STACKUP, ...(b.stackup ?? {}) };
  const go = (screen: 'sch' | 'pcb' | '3d' | 'fab') => { if (app.screen !== screen) app.go(screen); };

  const pourGround = () => {
    if (!gndNet) return;
    const layers = b.copperCount === 4 ? (['B.Cu', 'F.Cu'] as const) : (['B.Cu', 'F.Cu'] as const);
    editor.begin('一键铺地');
    for (const layer of layers) if (!gndZones.some((z) => z.layer === layer)) editor.dispatch(pcb.addZone({ layer, net: gndNet, polygon: b.outline }));
    editor.commit();
    go('pcb');
    app.toast(`已在 ${layers.join(' / ')} 铺 ${gndNet} 铜（热焊盘连接，可在属性里改成实心 / 调间隙，可 Undo）`, 'success');
  };
  const addVersion = () => { editor.dispatch(pcb.addBoardText({ layer: 'F.Silk', text: `${project.name.slice(0, 12)} v1.0`, x: bb.x + bb.w / 2, y: bb.y + bb.h - 1.5, size: 1 })); go('pcb'); };

  const schSteps: Step[] = [
    { title: '放置元件', status: comps.length ? 'done' : 'todo', detail: comps.length ? `${comps.length} 个元件` : '从右侧元件库或模板开始', actions: [{ label: '元件库', run: () => { go('sch'); app.set('rightTab', 'lib'); } }] },
    { title: '连线与网络标签', status: !comps.length ? 'skip' : a.netlist.unconnectedPins.length ? 'warn' : 'done', detail: a.netlist.unconnectedPins.length ? `${a.netlist.unconnectedPins.length} 个引脚未连接（红点）` : `${a.netlist.nets.length} 个网络`, actions: [{ label: 'W 连线', run: () => { go('sch'); app.setSchTool('wire'); } }], tip: '同名网络标签自动连通；电源用 P 放 +3V3 / GND 符号。' },
    { title: 'ERC 检查', status: !comps.length ? 'skip' : a.erc.errors ? 'todo' : a.erc.warnings ? 'warn' : 'done', detail: a.erc.errors ? `${a.erc.errors} 个错误` : a.erc.warnings ? `${a.erc.warnings} 个警告（可忽略）` : '通过', actions: a.erc.items.length ? [{ label: '查看', run: () => { go('sch'); app.set('rightTab', 'check'); } }] : undefined },
    { title: '图纸信息', status: sheet.frame.title || sheet.frame.company ? 'done' : 'warn', detail: sheet.frame.title ? `标题「${sheet.frame.title}」` : '标题栏用的是项目名；可填公司 / 作者 / 版本', actions: [{ label: '标题栏', run: () => { go('sch'); app.toast('子栏「标题栏…」可编辑文字、尺寸与纸张'); } }] },
    { title: '同步到 PCB', status: !comps.length ? 'skip' : pendingSync ? 'todo' : 'done', detail: pendingSync ? '原理图有改动尚未同步' : `PCB 上 ${b.footprints.length} 个封装`, actions: [{ label: '同步到 PCB', primary: pendingSync, run: () => { editor.dispatch(pcb.syncFromSchematic()); go('pcb'); } }] }
  ];
  const pcbSteps: Step[] = [
    { title: '板框与尺寸', status: b.outline.length >= 3 ? 'done' : 'todo', detail: `${bb.w.toFixed(1)} × ${bb.h.toFixed(1)} mm · ${b.copperCount} 层 · ${b.thickness} mm`, actions: [{ label: 'E 板框工具', run: () => { go('pcb'); app.setPcbTool('edge'); } }, { label: '层叠', run: () => { go('pcb'); app.set('rightTab', 'layers'); } }], tip: '先定板框和安装孔位置，再布局；「适配内容」可让板框自动包住元件。' },
    { title: '元件布局', status: !b.footprints.length ? 'skip' : placementErrors.length ? 'todo' : placementWarns.length ? 'warn' : 'done', detail: placementErrors.length ? `${placementErrors.length} 处重叠 / 出板` : placementWarns.length ? `${placementWarns.length} 条建议（去耦 / 间距 / 干扰 / 对齐）` : '布局检查通过', actions: [{ label: '优化布局（预览）', primary: placementErrors.length > 0 || placementWarns.length > 2, run: () => { go('pcb'); app.set('placementSeq', app.placementSeq + 1); } }, ...(placementIssues[0]?.location ? [{ label: '定位第一条', run: () => { go('pcb'); app.patch({ flyTo: { x: placementIssues[0].location!.x, y: placementIssues[0].location!.y, space: 'pcb', seq: Date.now() } }); } }] : [])], tip: placementIssues.slice(0, 3).map((i) => `${i.severity === 'error' ? '●' : '·'} ${i.message}${i.suggestion ? '，' + i.suggestion : ''}`).join('\n') || '连接器放板边、去耦电容贴近芯片电源脚、晶振靠近 MCU；R 旋转、F 翻面、L 对齐。' },
    { title: '安装孔', status: holes ? 'done' : 'warn', detail: holes ? `${holes} 个` : '还没有螺丝孔（如果板子要固定）', actions: [{ label: 'H 开孔', run: () => { go('pcb'); app.setPcbTool('hole'); } }] },
    { title: '布线', status: !b.footprints.length ? 'skip' : a.ratsnest.unrouted ? 'todo' : 'done', detail: a.ratsnest.unrouted ? `还有 ${a.ratsnest.unrouted} / ${a.ratsnest.total} 条连接未布线` : `${a.ratsnest.total} 条连接已全部布通`, actions: a.ratsnest.unrouted ? [{ label: '自动布线', primary: true, run: () => { go('pcb'); app.patch({ pcbTool: 'autoroute', routing: null }); } }, { label: 'X 手动走线', run: () => { go('pcb'); app.setPcbTool('route'); } }] : undefined, tip: '自动布线剩下的几条常常是电源 / 地：先铺地铜，再手动补几根粗线。' },
    { title: '铺铜（地平面）', status: !gndNet ? 'skip' : gndZones.length ? 'done' : 'todo', detail: !gndNet ? '没有 GND 网络' : gndZones.length ? `${gndNet} 已在 ${gndZones.map((z) => z.layer).join(' / ')} 铺铜` : `建议整板铺 ${gndNet}：减少走线、改善 EMI 与散热`, actions: gndNet && !gndZones.length ? [{ label: `一键铺 ${gndNet}`, primary: true, run: pourGround }] : gndNet ? [{ label: '重新铺铜（选中区域可调热焊盘）', run: () => { go('pcb'); app.set('rightTab', 'props'); } }] : undefined, tip: '铺铜后过孔 / 焊盘用热焊盘连接便于焊接；地铜会自动避让其他网络并移除孤岛。' },
    { title: 'DRC 检查', status: !b.footprints.length ? 'skip' : a.drc.errors ? 'todo' : a.drc.warnings ? 'warn' : 'done', detail: a.drc.errors ? `${a.drc.errors} 个错误` : a.drc.warnings ? `${a.drc.warnings} 个警告` : '通过', actions: a.drc.items.length ? [{ label: '查看', run: () => { go('pcb'); app.set('rightTab', 'check'); } }] : undefined, tip: '间距 / 线宽 / 孔径按所选板厂规则集检查；错误必须清零，警告按需处理。' },
    { title: '丝印与标识', status: hasVersion ? 'done' : 'warn', detail: hasVersion ? '有版本号' : '加上名称 / 版本号 / 日期，方便以后认板', actions: hasVersion ? undefined : [{ label: '添加版本号', run: addVersion }] },
    { title: '3D 检查', status: 'done', detail: `阻焊 ${st.maskColor} · 丝印 ${st.silkColor} · ${st.finish}`, actions: [{ label: '看 3D', run: () => go('3d') }], tip: '看看连接器方向、元件是否碰撞、丝印是否被遮挡。' },
    { title: '导出制造文件', status: a.drc.errors || a.ratsnest.unrouted ? 'skip' : 'todo', detail: 'Gerber + 钻孔 + BOM + 坐标 + 装配图，附下单参数', actions: [{ label: '去制造页', primary: !a.drc.errors && !a.ratsnest.unrouted, run: () => go('fab') }] }
  ];
  const steps = app.screen === 'pcb' || app.screen === '3d' ? pcbSteps : schSteps;
  const doneCount = steps.filter((s) => s.status === 'done').length, total = steps.filter((s) => s.status !== 'skip').length;
  const color: Record<Status, string> = { done: 'var(--success)', todo: 'var(--accent)', warn: 'var(--warning)', skip: 'var(--text-3)' };
  const mark: Record<Status, string> = { done: '✓', todo: '→', warn: '!', skip: '·' };
  const next = steps.find((s) => s.status === 'todo') ?? steps.find((s) => s.status === 'warn');
  return (
    <div className="col" style={{ height: '100%', gap: 0, fontSize: 12 }}>
      <div className="col" style={{ padding: 12, gap: 8, borderBottom: '1px solid var(--border)' }}>
        <div className="row"><span style={{ fontWeight: 500, fontSize: 13 }}>{app.screen === 'pcb' || app.screen === '3d' ? 'PCB 完成度' : '原理图完成度'}</span><span className="ml-auto mono muted">{doneCount}/{total}</span></div>
        <div style={{ height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}><div style={{ width: `${total ? (100 * doneCount) / total : 0}%`, height: '100%', background: 'var(--success)' }} /></div>
        {next && <div className="row" style={{ gap: 8 }}><span className="muted">下一步：</span><span style={{ fontWeight: 500 }}>{next.title}</span>{next.actions?.[0] && <button className="btn sm primary ml-auto" onClick={next.actions[0].run}>{next.actions[0].label}</button>}</div>}
        {!next && <div className="row" style={{ color: 'var(--success)' }}>✓ 这一阶段都完成了{app.screen !== 'pcb' && app.screen !== '3d' ? '，去 PCB 继续' : '，可以导出制造文件了'}</div>}
      </div>
      <div className="grow col" style={{ overflow: 'auto', padding: '8px 12px', gap: 6 }}>
        {steps.map((s, i) => (
          <div key={s.title} className="col" style={{ gap: 4, padding: '8px 10px', borderRadius: 6, background: s === next ? 'var(--bg-raised)' : 'transparent', border: `1px solid ${s === next ? 'var(--accent)' : 'var(--border)'}`, opacity: s.status === 'skip' ? 0.55 : 1 }}>
            <div className="row" style={{ gap: 8 }}><span style={{ width: 18, height: 18, borderRadius: '50%', border: `1.5px solid ${color[s.status]}`, color: color[s.status], display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flex: 'none' }}>{mark[s.status]}</span><span style={{ fontWeight: 500 }}>{i + 1}. {s.title}</span><span className="ml-auto muted xs">{s.detail}</span></div>
            {(s.actions?.length || s.tip) && <div className="row" style={{ gap: 6, paddingLeft: 26, flexWrap: 'wrap' }}>{s.actions?.map((ac) => <button key={ac.label} className={`btn sm${ac.primary ? ' primary' : ''}`} onClick={ac.run}>{ac.label}</button>)}{s.tip && <span className="dim xs" style={{ flexBasis: '100%', whiteSpace: 'pre-line' }}>{s.tip}</span>}</div>}
          </div>
        ))}
        <div className="dim xs" style={{ padding: '8px 2px' }}>每一步都可撤销（⌘Z）。遇到具体问题可到「AI」标签让助手直接修改。</div>
      </div>
    </div>
  );
}
