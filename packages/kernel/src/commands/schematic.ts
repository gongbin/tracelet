import type { Project } from '../model/project.js';
import type { Sheet, SchComponent, Wire, Graphic, NetLabel, Bus, SheetFrame } from '../model/schematic.js';
import { DEFAULT_FRAME } from '../model/schematic.js';
import { type Vec, eq } from '../geometry.js';
import { SCH_GRID, snapTo } from '../units.js';
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

// ---------- 图纸 ----------
export function addSheet(name: string): { command: Command; id: string } {
  const id = newId('sheet');
  return { id, command: command(`新建图纸 ${name}`, (proj) => ({ ...proj, schematic: { ...proj.schematic, sheets: [...proj.schematic.sheets, { id, name, frame: { ...DEFAULT_FRAME }, components: [], wires: [], labels: [], junctions: [], buses: [], graphics: [] }] } })) };
}
export function renameSheet(sheetId: string, name: string): Command {
  return command('重命名图纸', (proj) => updateSheet(proj, sheetId, (s) => ({ ...s, name })));
}
/** 删除图纸（至少保留一页）。 */
export function deleteSheet(sheetId: string): Command {
  return command('删除图纸', (proj) => (proj.schematic.sheets.length <= 1 ? proj : { ...proj, schematic: { ...proj.schematic, sheets: proj.schematic.sheets.filter((s) => s.id !== sheetId) } }));
}
export function setSheetFrame(sheetId: string, frame: Partial<SheetFrame>): Command {
  return command('图纸模板', (proj) => updateSheet(proj, sheetId, (s) => ({ ...s, frame: { ...DEFAULT_FRAME, ...s.frame, ...frame } })));
}

// ---------- 导线编辑 ----------
/** 修改导线顶点；自动导线一经手工调整即转为手动。 */
export function setWirePoints(sheetId: string, id: string, points: Vec[]): Command {
  return command('编辑导线', (proj) => updateSheet(proj, sheetId, (s) => ({ ...s, wires: s.wires.map((w) => (w.id === id ? { id: w.id, points } : w)) })));
}

// ---------- 结点 / 总线 / 图形 ----------
export function addJunction(sheetId: string, at: Vec): Command {
  return command('结点', (proj) => updateSheet(proj, sheetId, (s) => ({ ...s, junctions: [...s.junctions, { id: newId('j'), x: at.x, y: at.y }] })));
}
export function deleteJunctions(sheetId: string, ids: string[]): Command {
  const set = new Set(ids);
  return command('删除结点', (proj) => updateSheet(proj, sheetId, (s) => ({ ...s, junctions: s.junctions.filter((j) => !set.has(j.id)) })));
}
export function addBus(sheetId: string, points: Vec[]): Command {
  return command('总线', (proj) => updateSheet(proj, sheetId, (s) => ({ ...s, buses: [...(s.buses ?? []), { id: newId('b'), points }] })));
}
export function deleteBuses(sheetId: string, ids: string[]): Command {
  const set = new Set(ids);
  return command('删除总线', (proj) => updateSheet(proj, sheetId, (s) => ({ ...s, buses: (s.buses ?? []).filter((b) => !set.has(b.id)) })));
}
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
export type GraphicInput = DistributiveOmit<Graphic, 'id'>;
export function addGraphic(sheetId: string, g: GraphicInput): Command {
  const label = g.kind === 'text' ? '文字' : g.kind === 'rect' ? '矩形' : '线条';
  return command(label, (proj) => updateSheet(proj, sheetId, (s) => ({ ...s, graphics: [...(s.graphics ?? []), { ...g, id: newId('g') } as Graphic] })));
}
export function updateGraphic(sheetId: string, id: string, patch: Partial<Graphic>): Command {
  return command('修改图形', (proj) => updateSheet(proj, sheetId, (s) => ({ ...s, graphics: (s.graphics ?? []).map((g) => (g.id === id ? ({ ...g, ...patch } as Graphic) : g)) })));
}
export function deleteGraphics(sheetId: string, ids: string[]): Command {
  const set = new Set(ids);
  return command('删除图形', (proj) => updateSheet(proj, sheetId, (s) => ({ ...s, graphics: (s.graphics ?? []).filter((g) => !set.has(g.id)) })));
}

// ---------- 剪贴板 ----------
export interface Clipboard {
  components: SchComponent[];
  wires: Wire[];
  labels: NetLabel[];
  buses: Bus[];
  graphics: Graphic[];
  /** 左上角锚点（粘贴时对齐鼠标） */
  anchor: Vec;
}

/** 复制选区：元件、两端都在选区内的自动导线、任一顶点落在选区元件引脚/标签上的手动导线、标签、总线、图形。 */
export function copySelection(sheet: Sheet, ids: string[]): Clipboard {
  const set = new Set(ids);
  const components = sheet.components.filter((c) => set.has(c.id));
  const compIds = new Set(components.map((c) => c.id));
  const labels = sheet.labels.filter((l) => set.has(l.id));
  const buses = (sheet.buses ?? []).filter((b) => set.has(b.id));
  const graphics = (sheet.graphics ?? []).filter((g) => set.has(g.id));
  const pinEnds = new Set<string>();
  for (const c of components) for (const g of pinGeoms(c)) pinEnds.add(`${g.end.x},${g.end.y}`);
  const wires = sheet.wires.filter((w) => {
    if (set.has(w.id)) return true;
    if (w.auto) return compIds.has(w.auto[0].split(':')[0]) && compIds.has(w.auto[1].split(':')[0]);
    const a = w.points[0], b = w.points[w.points.length - 1];
    return pinEnds.has(`${a.x},${a.y}`) && pinEnds.has(`${b.x},${b.y}`);
  });
  const pts: Vec[] = [...components.map((c) => ({ x: c.x, y: c.y })), ...wires.flatMap((w) => w.points), ...labels.map((l) => ({ x: l.x, y: l.y })), ...buses.flatMap((b) => b.points)];
  const anchor = pts.length ? { x: Math.min(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)) } : { x: 0, y: 0 };
  return { components, wires, labels, buses, graphics, anchor };
}

/** 粘贴：新 id、新位号（按前缀计数器递增）、整体平移到 target（锚点对齐并吸附栅格）。 */
export function pasteClipboard(project: Project, sheetId: string, clip: Clipboard, target: Vec): { command: Command; ids: string[] } {
  const dx = snapTo(target.x - clip.anchor.x, SCH_GRID), dy = snapTo(target.y - clip.anchor.y, SCH_GRID);
  const idMap = new Map<string, string>();
  const newIds: string[] = [];
  const cmd = command(`粘贴 ${clip.components.length} 个元件`, (proj) => {
    const counters = { ...proj.schematic.counters };
    const comps: SchComponent[] = clip.components.map((c) => {
      const sym = getSymbol(c.symbolId);
      const id = newId('c'); idMap.set(c.id, id); newIds.push(id);
      let ref = c.ref;
      if (!sym.power) { const n = counters[sym.prefix] ?? 1; ref = `${sym.prefix}${n}`; counters[sym.prefix] = n + 1; }
      return { ...c, id, ref, x: c.x + dx, y: c.y + dy };
    });
    const mapKey = (k: string) => { const [cid, pin] = k.split(':'); return `${idMap.get(cid) ?? cid}:${pin}`; };
    const wires: Wire[] = clip.wires.map((w) => ({ id: newId('w'), points: w.points.map((p) => ({ x: p.x + dx, y: p.y + dy })), ...(w.auto ? { auto: [mapKey(w.auto[0]), mapKey(w.auto[1])] as [string, string] } : {}) }));
    const labels: NetLabel[] = clip.labels.map((l) => { const id = newId('l'); newIds.push(id); return { ...l, id, x: l.x + dx, y: l.y + dy }; });
    const buses: Bus[] = clip.buses.map((b) => ({ id: newId('b'), points: b.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }));
    const graphics: Graphic[] = clip.graphics.map((g) => g.kind === 'line' ? { ...g, id: newId('g'), points: g.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) } : g.kind === 'rect' ? { ...g, id: newId('g'), a: { x: g.a.x + dx, y: g.a.y + dy }, b: { x: g.b.x + dx, y: g.b.y + dy } } : { ...g, id: newId('g'), x: g.x + dx, y: g.y + dy });
    const next = updateSheet(proj, sheetId, (s) => ({ ...s, components: [...s.components, ...comps], wires: [...s.wires, ...wires], labels: [...s.labels, ...labels], buses: [...(s.buses ?? []), ...buses], graphics: [...(s.graphics ?? []), ...graphics] }));
    return { ...next, schematic: { ...next.schematic, counters } };
  });
  return { command: cmd, ids: newIds };
}
