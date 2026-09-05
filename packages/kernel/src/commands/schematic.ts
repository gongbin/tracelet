import type { Project } from '../model/project.js';
import type { Sheet, SchComponent, Wire } from '../model/schematic.js';
import { type Vec, eq } from '../geometry.js';
import { newId } from '../ids.js';
import { getSymbol } from '../library/symbols.js';
import { findPin, pinGeoms, autoRoute, snapComponentOrigin } from '../schematic/geometry.js';
import { command, type Command } from './types.js';

function updateSheet(p: Project, sheetId: string, fn: (s: Sheet) => Sheet): Project {
  return { ...p, schematic: { ...p.schematic, sheets: p.schematic.sheets.map((s) => (s.id === sheetId ? fn(s) : s)) } };
}

const pinKey = (cid: string, pin: string) => `${cid}:${pin}`;

/** 重新计算与某元件相连的导线端点。 */
function rerouteWiresFor(sheet: Sheet, oldComp: SchComponent, newComp: SchComponent): Wire[] {
  const oldPins = pinGeoms(oldComp), newPins = pinGeoms(newComp);
  const byId = new Map(sheet.components.map((c) => [c.id, c]));
  return sheet.wires.map((w) => {
    if (w.auto) {
      const [a, b] = w.auto;
      if (!a.startsWith(newComp.id + ':') && !b.startsWith(newComp.id + ':')) return w;
      const resolve = (k: string) => {
        const [cid, pin] = k.split(':');
        const c = cid === newComp.id ? newComp : byId.get(cid);
        return c ? findPin(c, pin) : undefined;
      };
      const ga = resolve(a), gb = resolve(b);
      if (!ga || !gb) return w;
      return { ...w, points: autoRoute(ga, gb) };
    }
    const pts = [...w.points];
    let changed = false;
    for (const idx of [0, pts.length - 1]) {
      const i = oldPins.findIndex((g) => eq(g.end, pts[idx], 0.5));
      if (i >= 0) { pts[idx] = newPins[i].end; changed = true; }
    }
    return changed ? { ...w, points: pts } : w;
  });
}

export interface PlaceComponentArgs {
  sheetId: string;
  symbolId: string;
  center: Vec;
  value?: string;
  footprint?: string;
  rotation?: number;
  props?: Record<string, string>;
}

/** 放置元件；返回命令与新元件 id/位号。 */
export function placeComponent(p: Project, args: PlaceComponentArgs): { command: Command; id: string; ref: string } {
  const sym = getSymbol(args.symbolId);
  const id = newId('c');
  const n = p.schematic.counters[sym.prefix] ?? 1;
  const ref = `${sym.prefix}${n}`;
  const cmd = command(`放置 ${ref}`, (proj) => {
    const origin = snapComponentOrigin(sym, args.center);
    const comp: SchComponent = {
      id, ref, symbolId: sym.id, value: args.value ?? sym.defaultValue, footprint: args.footprint ?? sym.defaultFootprint,
      x: origin.x, y: origin.y, rotation: args.rotation ?? 0, mirror: false, props: args.props ?? {}
    };
    const next = updateSheet(proj, args.sheetId, (s) => ({ ...s, components: [...s.components, comp] }));
    return { ...next, schematic: { ...next.schematic, counters: { ...next.schematic.counters, [sym.prefix]: n + 1 } } };
  });
  return { command: cmd, id, ref };
}

export function moveComponent(sheetId: string, id: string, origin: Vec): Command {
  return command('移动元件', (proj) => updateSheet(proj, sheetId, (s) => {
    const old = s.components.find((c) => c.id === id);
    if (!old || (old.x === origin.x && old.y === origin.y)) return s;
    const nc = { ...old, x: origin.x, y: origin.y };
    return { ...s, components: s.components.map((c) => (c.id === id ? nc : c)), wires: rerouteWiresFor(s, old, nc) };
  }));
}

export function rotateComponent(sheetId: string, id: string, delta = 90): Command {
  return command('旋转元件', (proj) => updateSheet(proj, sheetId, (s) => {
    const old = s.components.find((c) => c.id === id);
    if (!old) return s;
    const nc = { ...old, rotation: ((old.rotation + delta) % 360 + 360) % 360 };
    return { ...s, components: s.components.map((c) => (c.id === id ? nc : c)), wires: rerouteWiresFor(s, old, nc) };
  }));
}

export function setComponentValue(sheetId: string, id: string, value: string): Command {
  return command('修改值', (proj) => updateSheet(proj, sheetId, (s) => ({ ...s, components: s.components.map((c) => (c.id === id ? { ...c, value } : c)) })));
}

export function setComponentFootprint(sheetId: string, id: string, footprint: string): Command {
  return command('修改封装', (proj) => updateSheet(proj, sheetId, (s) => ({ ...s, components: s.components.map((c) => (c.id === id ? { ...c, footprint } : c)) })));
}

export function setComponentRef(sheetId: string, id: string, ref: string): Command {
  return command('修改位号', (proj) => updateSheet(proj, sheetId, (s) => ({ ...s, components: s.components.map((c) => (c.id === id ? { ...c, ref } : c)) })));
}

export function deleteComponents(sheetId: string, ids: string[]): Command {
  const set = new Set(ids);
  return command(ids.length > 1 ? `删除 ${ids.length} 个元件` : '删除元件', (proj) => updateSheet(proj, sheetId, (s) => ({
    ...s,
    components: s.components.filter((c) => !set.has(c.id)),
    wires: s.wires.filter((w) => !w.auto || (!set.has(w.auto[0].split(':')[0]) && !set.has(w.auto[1].split(':')[0])))
  })));
}

/** 用正交导线连接两个引脚。 */
export function connectPins(sheetId: string, a: { componentId: string; pin: string }, b: { componentId: string; pin: string }): Command {
  return command('连线', (proj) => updateSheet(proj, sheetId, (s) => {
    const ca = s.components.find((c) => c.id === a.componentId), cb = s.components.find((c) => c.id === b.componentId);
    if (!ca || !cb) return s;
    const ga = findPin(ca, a.pin), gb = findPin(cb, b.pin);
    if (!ga || !gb) return s;
    const wire: Wire = { id: newId('w'), points: autoRoute(ga, gb), auto: [pinKey(a.componentId, a.pin), pinKey(b.componentId, b.pin)] };
    return { ...s, wires: [...s.wires, wire] };
  }));
}

export function addWire(sheetId: string, points: Vec[]): Command {
  return command('画导线', (proj) => updateSheet(proj, sheetId, (s) => ({ ...s, wires: [...s.wires, { id: newId('w'), points }] })));
}

export function deleteWires(sheetId: string, ids: string[]): Command {
  const set = new Set(ids);
  return command('删除导线', (proj) => updateSheet(proj, sheetId, (s) => ({ ...s, wires: s.wires.filter((w) => !set.has(w.id)) })));
}

export function addLabel(sheetId: string, text: string, at: Vec): Command {
  return command(`标签 ${text}`, (proj) => updateSheet(proj, sheetId, (s) => ({ ...s, labels: [...s.labels, { id: newId('l'), text, x: at.x, y: at.y }] })));
}

export function deleteLabels(sheetId: string, ids: string[]): Command {
  const set = new Set(ids);
  return command('删除标签', (proj) => updateSheet(proj, sheetId, (s) => ({ ...s, labels: s.labels.filter((l) => !set.has(l.id)) })));
}

export function renameProject(name: string): Command {
  return command('重命名项目', (proj) => ({ ...proj, name }));
}
