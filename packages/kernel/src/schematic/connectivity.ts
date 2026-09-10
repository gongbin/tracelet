import type { Sheet, SchComponent, PinType, Schematic } from '../model/schematic.js';
import { UnionFind, key, pointOnSeg, type Vec } from '../geometry.js';
import { getSymbol } from '../library/symbols.js';
import { pinGeoms } from './geometry.js';
import { componentPackages } from './units.js';

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
  /** Names allowed to join nets across sheets; local label aliases are excluded. */
  globalNames?: string[];
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
  /** `${sheetId}:${wireId}` -> resolved electrical net, including aliases and branches. */
  wireNet?: Map<string, string>;
}

const PIN = (cid: string, n: string) => `pin:${cid}:${n}`;
const PT = (p: Vec) => `pt:${key(p)}`;
const ALIAS = (name: string) => `alias:${name}`;
const uniqueName = (name: string, used: Set<string>): string => {
  let result = name, suffix = 2;
  while (used.has(result)) result = `${name}#${suffix++}`;
  used.add(result);
  return result;
};

/** Shared unit pins are one physical pad, even when drawn on different sheets. */
function joinUnitPins(sheets: Sheet[], netlist: Netlist): Netlist {
  const components = sheets.flatMap(s => s.components);
  const sheetIds = new Map(sheets.flatMap(s => s.components.map(c => [c.id, s.id] as const)));
  const packages = componentPackages(components).filter(group => group.length > 1);
  if (!packages.length) return netlist;
  const uf = new UnionFind();
  const entries = new Map<string, { net?: Net; pin?: NetPin; unused?: boolean }>();
  const pinNodes = new Map<string, string>();
  for (const net of netlist.nets) {
    const node = `net:${entries.size}`;
    entries.set(node, { net }); uf.find(node);
    for (const p of net.pins) pinNodes.set(`${p.componentId}:${p.pinNumber}`, node);
  }
  for (const pin of netlist.unconnectedPins) {
    const node = `pin:${pin.componentId}:${pin.pinNumber}`;
    entries.set(node, { pin }); uf.find(node);
    pinNodes.set(`${pin.componentId}:${pin.pinNumber}`, node);
  }
  for (const group of packages) {
    const firstPins = new Map<string, string>();
    for (const c of group) for (const g of pinGeoms(c)) {
      const pin = g.def;
      let node = pinNodes.get(`${c.id}:${pin.number}`);
      // A no-connect mark applies to the physical pin. Retain it in this graph
      // so a wired copy is still reported as a contradiction by ERC.
      if (!node && netlist.pinNet.has(`${c.id}:${pin.number}`)) {
        node = `pin:${c.id}:${pin.number}`;
        entries.set(node, { unused: true, pin: { sheetId: sheetIds.get(c.id), componentId: c.id, ref: c.ref, pinNumber: pin.number, pinName: pin.name, type: pin.type, pos: g.end } });
        uf.find(node);
      }
      if (node) {
        const first = firstPins.get(pin.number);
        if (first) uf.union(node, first); else firstPins.set(pin.number, node);
      }
    }
  }
  const nets: Net[] = [], unconnectedPins: NetPin[] = [];
  const pinNet = new Map(netlist.pinNet);
  const renamed = new Map<string, string>();
  for (const members of uf.groups().values()) {
    const values = members.map(m => entries.get(m)!);
    const connected = values.flatMap(e => e.net ? [e.net] : []);
    const loose = values.flatMap(e => e.pin ? [e.pin] : []);
    if (!connected.length) { if (!values.some(e => e.unused)) unconnectedPins.push(...loose); continue; }
    connected.sort((a, b) => Number(!!b.globalNames?.length) - Number(!!a.globalNames?.length) || a.name.localeCompare(b.name));
    const name = connected[0].name;
    for (const net of connected) renamed.set(net.name, name);
    const pins = [...connected.flatMap(n => n.pins), ...loose];
    for (const p of pins) pinNet.set(`${p.componentId}:${p.pinNumber}`, name);
    nets.push({ name, pins, labels: [...new Set(connected.flatMap(n => n.labels))].sort(),
      powerNames: [...new Set(connected.flatMap(n => n.powerNames))].sort(),
      globalNames: [...new Set(connected.flatMap(n => n.globalNames ?? []))].sort(), driven: connected.some(n => n.driven) || pins.some(p => p.type === 'power_out') });
  }
  nets.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const wireNet = new Map([...(netlist.wireNet ?? [])].map(([key, name]) => [key, renamed.get(name) ?? name]));
  return { nets, pinNet, unconnectedPins, wireNet };
}

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
  // T junctions connect at wire endpoints; bare interior crossings do not.
  for (const w of sheet.wires) for (const p of [w.points[0], w.points[w.points.length - 1]]) attach(p, PT(p));
  // 结点：让经过该点的所有导线段相连
  for (const j of sheet.junctions) attach(j, `junction:${j.id}`);

  const pinInfo = new Map<string, NetPin>();
  const byId = new Map<string, SchComponent>();
  for (const c of sheet.components) {
    byId.set(c.id, c);
    const sym = getSymbol(c.symbolId);
    for (const g of pinGeoms(c, sym)) {
      const node = PIN(c.id, g.def.number);
      pinInfo.set(node, { sheetId: sheet.id, componentId: c.id, ref: c.ref, pinNumber: g.def.number, pinName: g.def.name, type: g.def.type, pos: g.end });
      attach(g.end, node);
      if (sym.power) { uf.union(node, `power:${c.value}`); uf.union(node, ALIAS(c.value)); }
    }
  }
  const onBus = (p: Vec) => (sheet.buses ?? []).some((b) => b.points.some((_, i) => i < b.points.length - 1 && pointOnSeg(p, b.points[i], b.points[i + 1], 0.5)));
  for (const l of sheet.labels) {
    if (onBus(l)) continue;
    attach(l, `label:${l.id}`);
    if (l.text) uf.union(`label:${l.id}`, ALIAS(l.text));
  }

  const labelInfo = new Map(sheet.labels.map((l) => [`label:${l.id}`, l]));
  const powerComponents = new Set(sheet.components.filter((c) => getSymbol(c.symbolId).power).map((c) => c.id));

  const nets: Net[] = [];
  const pinNet = new Map<string, string>();
  const unconnectedPins: NetPin[] = [];
  const usedNames = new Set<string>();
  const groupNames = new Map<string, string>();

  for (const [root, members] of uf.groups()) {
    const pins: NetPin[] = [];
    const labels = new Set<string>();
    const powerNames = new Set<string>();
    const globalNames = new Set<string>();
    let driven = false;
    for (const m of members) {
      if (m.startsWith('pin:')) {
        const info = pinInfo.get(m)!;
        if (powerComponents.has(info.componentId)) { driven = true; continue; }
        pins.push(info);
        if (info.type === 'power_out') driven = true;
      } else if (m.startsWith('label:')) {
        const label = labelInfo.get(m)!;
        labels.add(label.text);
        if (label.text && (!label.scope || label.scope === 'global')) globalNames.add(label.text);
      } else if (m.startsWith('power:')) { powerNames.add(m.slice(6)); globalNames.add(m.slice(6)); }
    }
    if (pins.length === 0 && labels.size === 0) continue;
    if (pins.length === 1 && labels.size === 0 && powerNames.size === 0 && members.filter((m) => m.startsWith('pt:')).length <= 1) {
      // 孤立引脚：没有任何导线相连
      const p = pins[0];
      if (p.type !== 'no_connect' && !byId.get(p.componentId)?.noConnectPins?.includes(p.pinNumber)) unconnectedPins.push(p);
      pinNet.set(`${p.componentId}:${p.pinNumber}`, '');
      continue;
    }
    pins.sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }) || a.pinNumber.localeCompare(b.pinNumber, undefined, { numeric: true }));
    const lab = [...labels].filter(Boolean).sort();
    const pw = [...powerNames].sort();
    const name = uniqueName(lab[0] ?? pw[0] ?? (pins[0] ? `Net-(${pins[0].ref}-Pad${pins[0].pinNumber})` : 'Net-?'), usedNames);
    groupNames.set(root, name);
    for (const p of pins) pinNet.set(`${p.componentId}:${p.pinNumber}`, name);
    nets.push({ name, pins, labels: lab, powerNames: pw, globalNames: [...globalNames].sort(), driven });
  }

  // All electrical aliases were unioned before choosing display names. Never
  // merge disconnected automatic nets merely because duplicate refs name them alike.
  nets.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const wireNet = new Map<string, string>();
  for (const w of sheet.wires) { const name = groupNames.get(uf.find(PT(w.points[0]))); if (name) wireNet.set(`${sheet.id}:${w.id}`, name); }
  return joinUnitPins([sheet], { nets, pinNet, unconnectedPins, wireNet });
}

/** Merge only global aliases across sheets; namespace local names for PCB sync/export. */
export function buildSchematicNetlist(schematic: Schematic): Netlist {
  if (schematic.sheets.length === 1) return buildNetlist(schematic.sheets[0]);
  const uf = new UnionFind();
  const entries = new Map<string, { net: Net; sheet: Sheet }>();
  const pinNet = new Map<string, string>();
  const unconnectedPins: NetPin[] = [];
  const wireNet = new Map<string, string>();
  for (const sheet of schematic.sheets) {
    const nl = buildNetlist(sheet);
    for (const [key, name] of nl.wireNet ?? []) wireNet.set(key, name);
    unconnectedPins.push(...nl.unconnectedPins);
    for (const net of nl.nets) {
      const node = `net:${entries.size}`;
      entries.set(node, { net, sheet });
      uf.find(node);
      for (const name of net.globalNames ?? []) uf.union(node, ALIAS(name));
    }
    for (const [k, v] of nl.pinNet) pinNet.set(k, v);
  }
  const nets: Net[] = [];
  const usedNames = new Set<string>();
  const sourceWireNet = new Map(wireNet);
  const groups = [...uf.groups().values()].map(members => members.filter(m => entries.has(m)).map(m => entries.get(m)!));
  // Assign global names first so a user-named global always retains its name.
  groups.sort((a, b) => Number(!!b[0].net.globalNames?.length) - Number(!!a[0].net.globalNames?.length));
  for (const group of groups) {
    const first = group[0];
    const labels = [...new Set(group.flatMap(e => e.net.labels))].sort();
    const powerNames = [...new Set(group.flatMap(e => e.net.powerNames))].sort();
    const globalNames = [...new Set(group.flatMap(e => e.net.globalNames ?? []))].sort();
    const sheetName = schematic.sheets.filter(s => s.name === first.sheet.name).length > 1
      ? `${first.sheet.name}#${first.sheet.id}` : first.sheet.name;
    const baseName = labels.find(l => globalNames.includes(l)) ?? globalNames[0] ?? `/${sheetName}/${first.net.name}`;
    const name = uniqueName(baseName, usedNames);
    for (const entry of group) for (const w of entry.sheet.wires) {
      const key = `${entry.sheet.id}:${w.id}`;
      if (sourceWireNet.get(key) === entry.net.name) wireNet.set(key, name);
    }
    const pins = group.flatMap(e => e.net.pins);
    for (const p of pins) pinNet.set(`${p.componentId}:${p.pinNumber}`, name);
    nets.push({ name, labels, powerNames, globalNames, pins, driven: group.some(e => e.net.driven) });
  }
  nets.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return joinUnitPins(schematic.sheets, { nets, pinNet, unconnectedPins, wireNet });
}
