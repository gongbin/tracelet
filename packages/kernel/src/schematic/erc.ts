import type { Sheet } from '../model/schematic.js';
import type { Vec } from '../geometry.js';
import { buildNetlist, type Netlist } from './connectivity.js';
import { getSymbol } from '../library/symbols.js';

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
}

export interface CheckReport {
  items: CheckItem[];
  errors: number;
  warnings: number;
}

export function runErc(sheet: Sheet, netlist: Netlist = buildNetlist(sheet)): CheckReport {
  const items: CheckItem[] = [];
  let n = 0;
  const push = (i: Omit<CheckItem, 'id'>) => items.push({ id: `erc_${++n}`, ...i });

  // 重复位号
  const seen = new Map<string, string[]>();
  for (const c of sheet.components) {
    if (getSymbol(c.symbolId).power) continue;
    seen.set(c.ref, [...(seen.get(c.ref) ?? []), c.id]);
  }
  for (const [ref, ids] of seen) if (ids.length > 1) push({ rule: 'duplicate-ref', severity: 'error', message: `位号重复 ${ref}`, why: '两个元件共用一个位号会让 BOM 和 PCB 同步混乱。', refs: [ref], objectIds: ids });

  // 未连接引脚
  for (const p of netlist.unconnectedPins) {
    push({ rule: 'unconnected-pin', severity: 'warning', message: '引脚未连接', why: '未连接的引脚通常是漏画的导线；确实不用时可标记为不连接。', refs: [`${p.ref}.${p.pinName}`], location: p.pos, objectIds: [p.componentId] });
  }

  for (const net of netlist.nets) {
    const outs = net.pins.filter((p) => p.type === 'output');
    const powerIns = net.pins.filter((p) => p.type === 'power_in');
    if (outs.length > 1) push({ rule: 'output-conflict', severity: 'error', message: `输出对输出冲突 ${net.name}`, why: '两个输出引脚直接相连会互相灌电流，可能烧毁器件。', refs: outs.map((p) => `${p.ref}.${p.pinName}`), location: outs[0].pos, objectIds: outs.map((p) => p.componentId) });
    if (outs.length > 0 && net.powerNames.length > 0) push({ rule: 'output-to-power', severity: 'error', message: `输出引脚接到电源网络 ${net.name}`, why: '输出引脚被电源硬拉会损坏器件。', refs: outs.map((p) => `${p.ref}.${p.pinName}`), location: outs[0].pos, objectIds: outs.map((p) => p.componentId) });
    if (powerIns.length > 0 && !net.driven) push({ rule: 'power-not-driven', severity: 'error', message: `电源引脚未驱动 ${net.name}`, why: '电源输入引脚所在网络没有电源符号或电源输出，器件不会上电。', refs: powerIns.map((p) => `${p.ref}.${p.pinName}`), location: powerIns[0].pos, objectIds: powerIns.map((p) => p.componentId) });
    if (net.labels.length > 1) push({ rule: 'label-conflict', severity: 'warning', message: `网络有多个标签 ${net.labels.join(' / ')}`, why: '同一网络挂了不同名字的标签，可能是误连。', refs: net.labels, objectIds: [] });
    if (net.pins.length === 1 && net.labels.length === 0 && net.powerNames.length === 0) {
      const p = net.pins[0];
      push({ rule: 'single-pin-net', severity: 'warning', message: '导线悬空', why: '这根导线只连着一个引脚，另一端没有接到任何东西。', refs: [`${p.ref}.${p.pinName}`], location: p.pos, objectIds: [p.componentId] });
    }
  }

  return { items, errors: items.filter((i) => i.severity === 'error').length, warnings: items.filter((i) => i.severity === 'warning').length };
}
