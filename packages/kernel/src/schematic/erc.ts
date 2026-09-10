import type { Sheet, Schematic, SchComponent } from '../model/schematic.js';
import { key, pointOnSeg } from '../geometry.js';
import type { Vec } from '../geometry.js';
import { buildNetlist, buildSchematicNetlist, type Netlist, type NetPin } from './connectivity.js';
import { getSymbol } from '../library/symbols.js';
import { isMultiUnitPackage, componentPackages } from './units.js';
import { pinGeoms } from './geometry.js';

export type Severity = 'error' | 'warning';

export interface CheckItem {
  id: string;
  rule: string;
  severity: Severity;
  message: string;
  /** 面向新手的一句话解释 */
  why: string;
  /** 涉及对象（位号/引脚/网络） */
  refs: string[];
  location?: Vec;
  objectIds: string[];
  /** 所在图纸（多页时用于定位） */
  sheetId?: string;
}

export interface CheckReport {
  items: CheckItem[];
  errors: number;
  warnings: number;
}

export function runErc(sheet: Sheet, netlist: Netlist = buildNetlist(sheet)): CheckReport {
  return runSchematicErc({ sheets: [sheet], counters: {} }, netlist);
}

/** 多页 ERC：位号跨页唯一、跨页电源驱动、总线入口命名。 */
export function runSchematicErc(schematic: Schematic, netlist: Netlist = buildSchematicNetlist(schematic)): CheckReport {
  const items: CheckItem[] = [];
  let n = 0;
  const push = (i: Omit<CheckItem, 'id'>) => items.push({ id: `erc_${++n}`, ...i });
  const sheets = schematic.sheets;
  const sheetOfComp = new Map<string, string>();
  for (const sh of sheets) for (const c of sh.components) sheetOfComp.set(c.id, sh.id);
  const sheet = { components: sheets.flatMap((s) => s.components) } as Sheet;
  const physicalIds = new Map<string, string>();
  for (const group of componentPackages(sheet.components)) for (const c of group) physicalIds.set(c.id, group[0].id);
  const physicalPin = (p: NetPin) => `${physicalIds.get(p.componentId) ?? p.componentId}:${p.pinNumber}`;
  const distinctPins = (pins: NetPin[]) => [...new Map(pins.map(p => [physicalPin(p), p])).values()];
  const danglingNets = new Set<string>();
  for (const sh of sheets) {
    const pins = sh.components.flatMap(c => pinGeoms(c).map(g => g.end));
    const near = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y) < 0.5;
    const segments = sh.wires.flatMap(w => w.points.slice(1).map((b, i) => ({ id: w.id, a: w.points[i], b })));
    const onBus = (p: Vec) => (sh.buses ?? []).some(b => b.points.slice(1).some((end, i) => pointOnSeg(p, b.points[i], end, 0.5)));
    for (const label of sh.labels) {
      // Direct pin/label attachment uses the same point identity as the netlist.
      if (onBus(label) || pins.some(p => key(p) === key(label)) || segments.some(s => pointOnSeg(label, s.a, s.b, 0.5))) continue;
      push({ rule: 'dangling-label', severity: 'warning', message: '网络标签未接到引脚或导线', why: '文字看起来靠近导线，但锚点没有接上；拖动标签并吸附到引脚或导线上。', refs: [label.text], location: label, objectIds: [label.id], sheetId: sh.id });
    }
    const seenEnds = new Set<string>();
    for (const wire of sh.wires) {
      if (near(wire.points[0], wire.points[wire.points.length - 1])) continue;
      for (const end of [wire.points[0], wire.points[wire.points.length - 1]]) {
        // Bus entries have a separate naming check below; don't report them twice.
        if (onBus(end) || pins.some(p => near(p, end)) || sh.labels.some(l => near(l, end)) || segments.some(s => s.id !== wire.id && pointOnSeg(end, s.a, s.b, 0.5))) continue;
        const key = `${end.x},${end.y}`;
        if (seenEnds.has(key)) continue;
        seenEnds.add(key);
        const name = netlist.wireNet?.get(`${sh.id}:${wire.id}`);
        if (name) danglingNets.add(name);
        push({ rule: 'dangling-wire', severity: 'warning', message: '导线端点悬空', why: '这一端没有接到引脚、标签或其他导线；继续连线或删除多余线段。', refs: name ? [name] : [], location: end, objectIds: [wire.id], sheetId: sh.id });
      }
    }
  }

  // 总线入口：连到总线的导线端点必须有标签
  for (const sh of sheets) {
    if (sh.unresolvedHierarchy) push({ rule: 'unresolved-hierarchy', severity: 'error', message: '层次图纸连接未解析', why: '导入尚未展开父子图纸端口，当前网表不完整；请核对原始层次连接。', refs: [sh.name], objectIds: [], sheetId: sh.id });
    const buses = sh.buses ?? [];
    if (!buses.length) continue;
    const onBus = (p: Vec) => buses.some((b) => b.points.some((_, i) => i < b.points.length - 1 && pointOnSeg(p, b.points[i], b.points[i + 1], 0.5)));
    for (const w of sh.wires) for (const end of [w.points[0], w.points[w.points.length - 1]]) {
      if (!onBus(end)) continue;
      const labeled = sh.labels.some((l) => w.points.some((p) => Math.abs(p.x - l.x) < 0.5 && Math.abs(p.y - l.y) < 0.5) || w.points.some((_, i) => i < w.points.length - 1 && pointOnSeg({ x: l.x, y: l.y }, w.points[i], w.points[i + 1], 0.5)));
      if (!labeled) push({ rule: 'bus-entry-unnamed', severity: 'warning', message: '总线入口未命名', why: '连到总线的导线要用网络标签说明它是总线里的哪一根信号。', refs: [], location: end, objectIds: [w.id], sheetId: sh.id });
    }
  }

  for (const sh of sheets) for (const c of sh.components) {
    if (c.props.unresolvedSymbol) push({ rule: 'missing-symbol', severity: 'error', message: `缺少符号定义 ${c.ref}`, why: `无法校验引脚连接：${c.props.unresolvedSymbol}。请补全原始符号库后重新导入。`, refs: [c.ref], location: { x: c.x, y: c.y }, objectIds: [c.id], sheetId: sh.id });
    for (const pin of c.noConnectPins ?? []) {
      const net = netlist.nets.find((n) => n.pins.some((p) => p.componentId === c.id && p.pinNumber === pin));
      const p = net?.pins.find((p) => p.componentId === c.id && p.pinNumber === pin);
      if (p) push({ rule: 'no-connect-connected', severity: 'error', message: `不连接引脚已接线 ${c.ref}.${pin}`, why: '该引脚同时存在不连接标记和电气连接，请删除错误的标记或连线。', refs: [`${c.ref}.${pin}`], location: p.pos, objectIds: [c.id], sheetId: sh.id });
    }
  }

  // 重复位号
  const seen = new Map<string, SchComponent[]>();
  for (const c of sheet.components) {
    if (getSymbol(c.symbolId).power) continue;
    seen.set(c.ref, [...(seen.get(c.ref) ?? []), c]);
  }
  for (const [ref, components] of seen) if (components.length > 1 && !isMultiUnitPackage(components)) {
    const ids = components.map(c => c.id);
    push({ rule: 'duplicate-ref', severity: 'error', message: `位号重复 ${ref}`, why: '两个元件共用一个位号会让 BOM 和 PCB 同步混乱。', refs: [ref], objectIds: ids, sheetId: sheetOfComp.get(ids[0]) });
  }

  // 未连接引脚
  for (const p of distinctPins(netlist.unconnectedPins)) {
    push({ rule: 'unconnected-pin', severity: 'warning', message: '引脚未连接', why: '未连接的引脚通常是漏画的导线；确实不用时可标记为不连接。', refs: [`${p.ref}.${p.pinNumber}${p.pinName !== p.pinNumber ? ` (${p.pinName})` : ''}`], location: p.pos, objectIds: [p.componentId], sheetId: p.sheetId });
  }

  for (const net of netlist.nets) {
    const pins = distinctPins(net.pins);
    const outs = pins.filter((p) => p.type === 'output');
    const powerIns = pins.filter((p) => p.type === 'power_in');
    if (outs.length > 1) push({ rule: 'output-conflict', severity: 'error', message: `输出对输出冲突 ${net.name}`, why: '两个输出引脚直接相连会互相灌电流，可能烧毁器件。', refs: outs.map((p) => `${p.ref}.${p.pinName}`), location: outs[0].pos, objectIds: outs.map((p) => p.componentId), sheetId: outs[0].sheetId });
    if (outs.length > 0 && net.powerNames.length > 0) push({ rule: 'output-to-power', severity: 'error', message: `输出引脚接到电源网络 ${net.name}`, why: '输出引脚被电源硬拉会损坏器件。', refs: outs.map((p) => `${p.ref}.${p.pinName}`), location: outs[0].pos, objectIds: outs.map((p) => p.componentId), sheetId: outs[0].sheetId });
    if (powerIns.length > 0 && !net.driven) push({ rule: 'power-not-driven', severity: 'error', message: `电源引脚未驱动 ${net.name}`, why: '未找到这个网络的电源驱动声明。请核对供电连线；外部供电还需要明确电源来源。', refs: powerIns.map((p) => `${p.ref}.${p.pinNumber} (${p.pinName})`), location: powerIns[0].pos, objectIds: powerIns.map((p) => p.componentId), sheetId: powerIns[0].sheetId });
    if (net.labels.length > 1) {
      const sh = sheets.find(s => s.labels.some(l => net.labels.includes(l.text) && (!pins.length || pins.some(p => p.sheetId === s.id))));
      const label = sh?.labels.find(l => net.labels.includes(l.text));
      push({ rule: 'label-conflict', severity: 'warning', message: `网络有多个标签 ${net.labels.join(' / ')}`, why: '同一网络挂了不同名字的标签，可能是误连。', refs: net.labels, objectIds: label ? [label.id] : [], location: label, sheetId: sh?.id });
    }
    if (pins.length === 1 && net.labels.length === 0 && net.powerNames.length === 0 && !danglingNets.has(net.name)) {
      const p = pins[0];
      push({ rule: 'single-pin-net', severity: 'warning', message: '导线悬空', why: '这根导线只连着一个引脚，另一端没有接到任何东西。', refs: [`${p.ref}.${p.pinName}`], location: p.pos, objectIds: [p.componentId], sheetId: p.sheetId });
    }
  }

  return { items, errors: items.filter((i) => i.severity === 'error').length, warnings: items.filter((i) => i.severity === 'warning').length };
}
