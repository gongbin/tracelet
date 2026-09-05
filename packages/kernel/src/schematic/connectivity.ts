import type { Sheet, SchComponent, PinType, Schematic } from '../model/schematic.js';
import { UnionFind, key, pointOnSeg, type Vec } from '../geometry.js';
import { getSymbol } from '../library/symbols.js';
import { pinGeoms } from './geometry.js';

export interface NetPin {
  sheetId?: string;
  componentId: string;
  ref: string;
  pinNumber: string;
  pinName: string;
  type: PinType;
  pos: Vec;
}

export interface Net {
  name: string;
  pins: NetPin[];
  labels: string[];
  /** 通过电源符号命名 */
  powerNames: string[];
  /** 是否有驱动者（电源符号或 power_out 引脚） */
  driven: boolean;
}

export interface Netlist {
  nets: Net[];
  /** `${componentId}:${pinNumber}` -> 网络名 */
  pinNet: Map<string, string>;
  unconnectedPins: NetPin[];
}

const PIN = (cid: string, n: string) => `pin:${cid}:${n}`;
const PT = (p: Vec) => `pt:${key(p)}`;

/** 计算一张图纸的连通性与网表。 */
export function buildNetlist(sheet: Sheet): Netlist {
  const uf = new UnionFind();
  const segs: { a: Vec; b: Vec }[] = [];

  for (const w of sheet.wires) {
    for (let i = 0; i < w.points.length - 1; i++) {
      const a = w.points[i], b = w.points[i + 1];
      uf.union(PT(a), PT(b));
      segs.push({ a, b });
    }
  }
  const attach = (p: Vec, node: string) => {
    uf.union(node, PT(p));
    for (const s of segs) if (pointOnSeg(p, s.a, s.b, 0.5)) uf.union(node, PT(s.a));
  };
  // 结点：让经过该点的所有导线段相连
  for (const j of sheet.junctions) attach(j, `junction:${j.id}`);

  const pinInfo = new Map<string, NetPin>();
  const powerOf = new Map<string, string>();
  const byId = new Map<string, SchComponent>();
  for (const c of sheet.components) {
    byId.set(c.id, c);
    const sym = getSymbol(c.symbolId);
    for (const g of pinGeoms(c, sym)) {
      const node = PIN(c.id, g.def.number);
      pinInfo.set(node, { sheetId: sheet.id, componentId: c.id, ref: c.ref, pinNumber: g.def.number, pinName: g.def.name, type: g.def.type, pos: g.end });
      attach(g.end, node);
      if (sym.power) { uf.union(node, `power:${c.value}`); powerOf.set(node, c.value); }
    }
  }
  const onBus = (p: Vec) => (sheet.buses ?? []).some((b) => b.points.some((_, i) => i < b.points.length - 1 && pointOnSeg(p, b.points[i], b.points[i + 1], 0.5)));
  for (const l of sheet.labels) { if (onBus({ x: l.x, y: l.y })) continue; attach({ x: l.x, y: l.y }, `label:${l.id}`); }

  const labelText = new Map(sheet.labels.map((l) => [`label:${l.id}`, l.text]));
  const powerComponents = new Set(sheet.components.filter((c) => getSymbol(c.symbolId).power).map((c) => c.id));

  const nets: Net[] = [];
  const pinNet = new Map<string, string>();
  const unconnectedPins: NetPin[] = [];

  for (const [, members] of uf.groups()) {
    const pins: NetPin[] = [];
    const labels = new Set<string>();
    const powerNames = new Set<string>();
    let driven = false;
    for (const m of members) {
      if (m.startsWith('pin:')) {
        const info = pinInfo.get(m)!;
        if (powerComponents.has(info.componentId)) { driven = true; continue; }
        pins.push(info);
        if (info.type === 'power_out') driven = true;
      } else if (m.startsWith('label:')) labels.add(labelText.get(m) ?? '');
      else if (m.startsWith('power:')) powerNames.add(m.slice(6));
    }
    if (pins.length === 0 && labels.size === 0) continue;
    if (pins.length === 1 && labels.size === 0 && powerNames.size === 0 && members.filter((m) => m.startsWith('pt:')).length <= 1) {
      // 孤立引脚：没有任何导线相连
      const p = pins[0];
      if (p.type !== 'no_connect') unconnectedPins.push(p);
      pinNet.set(`${p.componentId}:${p.pinNumber}`, '');
      continue;
    }
    pins.sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }) || a.pinNumber.localeCompare(b.pinNumber, undefined, { numeric: true }));
    const lab = [...labels].filter(Boolean).sort();
    const pw = [...powerNames].sort();
    const name = lab[0] ?? pw[0] ?? (pins[0] ? `Net-(${pins[0].ref}-Pad${pins[0].pinNumber})` : 'Net-?');
    for (const p of pins) pinNet.set(`${p.componentId}:${p.pinNumber}`, name);
    nets.push({ name, pins, labels: lab, powerNames: pw, driven });
  }

  // 同名网络合并（标签/电源在不同位置出现）
  const merged = new Map<string, Net>();
  for (const n of nets) {
    const m = merged.get(n.name);
    if (!m) merged.set(n.name, { ...n, pins: [...n.pins], labels: [...n.labels], powerNames: [...n.powerNames] });
    else { m.pins.push(...n.pins); m.driven = m.driven || n.driven; m.labels = [...new Set([...m.labels, ...n.labels])]; m.powerNames = [...new Set([...m.powerNames, ...n.powerNames])]; }
  }
  const out = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { nets: out, pinNet, unconnectedPins };
}

/** 多页网表：各页独立计算后，按标签名 / 电源名跨页合并；自动命名的本地网络保留在各自页内。 */
export function buildSchematicNetlist(schematic: Schematic): Netlist {
  if (schematic.sheets.length === 1) return buildNetlist(schematic.sheets[0]);
  const merged = new Map<string, Net>();
  const pinNet = new Map<string, string>();
  const unconnectedPins: NetPin[] = [];
  for (const sheet of schematic.sheets) {
    const nl = buildNetlist(sheet);
    unconnectedPins.push(...nl.unconnectedPins);
    for (const n of nl.nets) {
      const global = n.labels.length > 0 || n.powerNames.length > 0;
      const key = global ? n.name : `${sheet.id}::${n.name}`;
      const m = merged.get(key);
      if (!m) merged.set(key, { ...n, pins: [...n.pins], labels: [...n.labels], powerNames: [...n.powerNames] });
      else { m.pins.push(...n.pins); m.driven = m.driven || n.driven; m.labels = [...new Set([...m.labels, ...n.labels])]; m.powerNames = [...new Set([...m.powerNames, ...n.powerNames])]; }
      for (const p of n.pins) pinNet.set(`${p.componentId}:${p.pinNumber}`, n.name);
    }
    for (const [k, v] of nl.pinNet) if (!pinNet.has(k)) pinNet.set(k, v);
  }
  const nets = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { nets, pinNet, unconnectedPins };
}
