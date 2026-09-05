/**
 * KiCad 6/7/8 导入：.kicad_sch → 图纸 + 项目内符号库；.kicad_pcb → 板 + 项目内封装库。
 * 原理图：mm → mil，库符号 y 向上 → y 向下；PCB：mm 直接使用。
 */
import { parseSExpr, child, children, str, num, isList, hasFlag, type SList, type SExpr } from './sexpr.js';
import type { Sheet, SymbolDef, PinDef, SymbolShape, SchComponent, Wire, NetLabel, Junction, Bus, Graphic, PinType, PinSide } from '../model/schematic.js';
import { DEFAULT_FRAME } from '../model/schematic.js';
import type { Board, FootprintDef, PadDef, BoardFootprint, Trace, Via, Zone, BoardText, CopperLayer } from '../model/board.js';
import { emptyBoard } from '../model/board.js';
import { createProject, type Project } from '../model/project.js';
import { registerSymbols, registerFootprints } from '../library/registry.js';
import { newId } from '../ids.js';
import { type Vec, dist } from '../geometry.js';
import { buildSchematicNetlist } from '../schematic/connectivity.js';
import { getSymbol } from '../library/symbols.js';

const MIL = 1000 / 25.4;
const mil = (mm: number) => Math.round(mm * MIL * 100) / 100;
const snap = (v: number) => Math.round(v / 50) * 50; // KiCad 栅格 1.27mm = 50mil

export interface ImportWarning { where: string; message: string }
export interface SchImportResult { sheet: Sheet; symbols: SymbolDef[]; warnings: ImportWarning[] }
export interface PcbImportResult { board: Board; footprints: FootprintDef[]; warnings: ImportWarning[] }

// ---------------- 原理图 ----------------

const PIN_TYPES: Record<string, PinType> = { input: 'input', output: 'output', bidirectional: 'bidirectional', tri_state: 'bidirectional', passive: 'passive', free: 'passive', unspecified: 'passive', power_in: 'power_in', power_out: 'power_out', open_collector: 'open_collector', open_emitter: 'open_collector', no_connect: 'no_connect' };

interface RawSymbol { id: string; name: string; power: boolean; pinNamesHidden: boolean; pinNumbersHidden: boolean; units: Map<number, SList[]>; props: Record<string, string> }

function parseLibSymbols(root: SList): Map<string, RawSymbol> {
  const out = new Map<string, RawSymbol>();
  const lib = child(root, 'lib_symbols');
  if (!lib) return out;
  for (const sym of children(lib, 'symbol')) {
    const name = str(sym[1]);
    const props: Record<string, string> = {};
    for (const p of children(sym, 'property')) props[str(p[1])] = str(p[2]);
    const pinNames = child(sym, 'pin_names'), pinNumbers = child(sym, 'pin_numbers');
    const raw: RawSymbol = { id: name, name, power: hasFlag(sym, 'power'), pinNamesHidden: !!pinNames && hasFlag(pinNames, 'hide'), pinNumbersHidden: !!pinNumbers && hasFlag(pinNumbers, 'hide'), units: new Map(), props };
    for (const sub of children(sym, 'symbol')) {
      const m = /_(\d+)_(\d+)$/.exec(str(sub[1]));
      const unit = m ? Number(m[1]) : 0, style = m ? Number(m[2]) : 1;
      if (style > 1) continue;
      raw.units.set(unit, [...(raw.units.get(unit) ?? []), sub]);
    }
    // 兼容旧格式：图形直接放在 symbol 下
    const direct = sym.filter((x): x is SList => isList(x) && ['polyline', 'rectangle', 'circle', 'arc', 'pin', 'text'].includes(String(x[0])));
    if (direct.length) raw.units.set(0, [...(raw.units.get(0) ?? []), direct as unknown as SList]);
    out.set(name, raw);
  }
  return out;
}

/** 把一个库符号（指定 unit）转成通用 SymbolDef（局部坐标：外接框左上角，mil，y 向下）。 */
function buildSymbolDef(raw: RawSymbol, unit: number, libId: string): SymbolDef {
  const shapes: SymbolShape[] = [];
  const pins: (PinDef & { _base: Vec })[] = [];
  const P = (x: SExpr | undefined, y: SExpr | undefined): Vec => ({ x: mil(num(x)), y: -mil(num(y)) });
  const fillOf = (n: SList): 'none' | 'background' | 'outline' => { const f = child(n, 'fill'); const t = f ? str(child(f, 'type')?.[1]) : 'none'; return t === 'background' ? 'background' : t === 'outline' ? 'outline' : 'none'; };
  const widthOf = (n: SList) => { const s = child(n, 'stroke'); const w = s ? num(child(s, 'width')?.[1]) : 0; return w > 0 ? mil(w) : 10; };
  const groups = [...(raw.units.get(0) ?? []), ...(raw.units.get(unit) ?? [])];
  for (const g of groups) {
    const items = g[0] === 'symbol' ? g.slice(2) : g;
    for (const n of items) {
      if (!isList(n)) continue;
      const k = n[0];
      if (k === 'polyline') { const pts = children(child(n, 'pts') ?? [], 'xy').map((xy) => P(xy[1], xy[2])); if (pts.length >= 2) shapes.push({ kind: 'polyline', points: pts, fill: fillOf(n), width: widthOf(n) }); }
      else if (k === 'rectangle') { const s = child(n, 'start')!, e = child(n, 'end')!; shapes.push({ kind: 'rect', a: P(s[1], s[2]), b: P(e[1], e[2]), fill: fillOf(n), width: widthOf(n) }); }
      else if (k === 'circle') { const c = child(n, 'center')!; shapes.push({ kind: 'circle', c: P(c[1], c[2]), r: mil(num(child(n, 'radius')?.[1])), fill: fillOf(n), width: widthOf(n) }); }
      else if (k === 'arc') { const s = child(n, 'start')!, m = child(n, 'mid')!, e = child(n, 'end')!; shapes.push({ kind: 'arc', start: P(s[1], s[2]), mid: P(m[1], m[2]), end: P(e[1], e[2]), width: widthOf(n) }); }
      else if (k === 'text') { const at = child(n, 'at')!; shapes.push({ kind: 'text', x: mil(num(at[1])), y: -mil(num(at[2])), text: str(n[1]), size: 50 }); }
      else if (k === 'pin') {
        const type = PIN_TYPES[str(n[1])] ?? 'passive';
        const at = child(n, 'at')!;
        const end = P(at[1], at[2]);
        const angle = num(at[3]);
        const length = mil(num(child(n, 'length')?.[1]));
        const rad = (angle * Math.PI) / 180;
        const base = { x: end.x + length * Math.cos(rad), y: end.y - length * Math.sin(rad) };
        const name = str(child(n, 'name')?.[1]), number = str(child(n, 'number')?.[1]);
        const side: PinSide = angle === 0 ? 'L' : angle === 180 ? 'R' : angle === 90 ? 'B' : 'T';
        pins.push({ number, name: name === '~' ? number : name, side, offset: 0, length, type, at: end, dir: angle, hidden: hasFlag(n, 'hide'), _base: base });
      }
    }
  }
  // 外接框
  const pts: Vec[] = [];
  for (const s of shapes) { if (s.kind === 'polyline') pts.push(...s.points); else if (s.kind === 'rect') pts.push(s.a, s.b); else if (s.kind === 'circle') pts.push({ x: s.c.x - s.r, y: s.c.y - s.r }, { x: s.c.x + s.r, y: s.c.y + s.r }); else if (s.kind === 'arc') pts.push(s.start, s.mid, s.end); else pts.push({ x: s.x, y: s.y }); }
  for (const p of pins) { pts.push(p.at!, p._base); }
  if (!pts.length) pts.push({ x: -100, y: -100 }, { x: 100, y: 100 });
  const minX = Math.min(...pts.map((p) => p.x)), minY = Math.min(...pts.map((p) => p.y)), maxX = Math.max(...pts.map((p) => p.x)), maxY = Math.max(...pts.map((p) => p.y));
  const sh = (p: Vec): Vec => ({ x: Math.round((p.x - minX) * 100) / 100, y: Math.round((p.y - minY) * 100) / 100 });
  const shapes2: SymbolShape[] = shapes.map((s) => s.kind === 'polyline' ? { ...s, points: s.points.map(sh) } : s.kind === 'rect' ? { ...s, a: sh(s.a), b: sh(s.b) } : s.kind === 'circle' ? { ...s, c: sh(s.c) } : s.kind === 'arc' ? { ...s, start: sh(s.start), mid: sh(s.mid), end: sh(s.end) } : { ...s, ...sh({ x: s.x, y: s.y }) });
  const prefix = (raw.props.Reference ?? 'U').replace(/[?\d]+$/, '') || 'U';
  const def: SymbolDef & { anchor?: Vec } = {
    id: libId, name: raw.name, kind: raw.power ? '电源' : '导入', prefix: raw.power ? '#PWR' : prefix,
    width: Math.max(1, Math.round((maxX - minX) * 100) / 100), height: Math.max(1, Math.round((maxY - minY) * 100) / 100),
    graphic: 'shapes', shapes: shapes2,
    pins: pins.map(({ _base, ...p }) => ({ ...p, at: sh(p.at!) })),
    showPinNames: !raw.pinNamesHidden, power: raw.power, defaultValue: raw.props.Value ?? '', defaultFootprint: '', description: raw.props.Description ?? raw.props.ki_description ?? '', source: `kicad:${raw.name}`
  };
  // 记录锚点（KiCad 原点）在局部框中的位置，供实例定位
  (def as unknown as { anchor: Vec }).anchor = sh({ x: 0, y: 0 });
  return def;
}

/** 把 KiCad 实例（锚点 at、旋转 angle（屏幕逆时针）、镜像）换算到我们的模型（外接框左上角 + 绕中心顺时针旋转 + x 镜像）。 */
function placeInstance(def: SymbolDef, anchor: Vec, atMil: Vec, angle: number, mirror: 'x' | 'y' | null): { x: number; y: number; rotation: number; mirror: boolean } {
  let rotation = ((-angle) % 360 + 360) % 360;
  let mir = false;
  if (mirror === 'y') mir = true;
  if (mirror === 'x') { mir = true; rotation = (rotation + 180) % 360; }
  const C = { x: def.width / 2, y: def.height / 2 };
  let lp = { x: anchor.x - C.x, y: anchor.y - C.y };
  if (mir) lp = { x: -lp.x, y: lp.y };
  const r = (rotation * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const rp = { x: lp.x * c - lp.y * s, y: lp.x * s + lp.y * c };
  return { x: Math.round((atMil.x - C.x - rp.x) * 100) / 100, y: Math.round((atMil.y - C.y - rp.y) * 100) / 100, rotation, mirror: mir };
}

export function importKicadSchematic(text: string, opts: { sheetName?: string; sheetId?: string } = {}): SchImportResult {
  const root = parseSExpr(text);
  if (root[0] !== 'kicad_sch') throw new Error('不是 KiCad 原理图文件（kicad_sch）');
  const warnings: ImportWarning[] = [];
  const raws = parseLibSymbols(root);
  const defs = new Map<string, SymbolDef & { anchor?: Vec }>();
  const defFor = (libId: string, unit: number) => {
    const key = `sym:kicad:${libId}#u${unit}`;
    let d = defs.get(key);
    if (!d) { const raw = raws.get(libId); if (!raw) return undefined; d = buildSymbolDef(raw, unit, key); defs.set(key, d); }
    return d;
  };
  const components: SchComponent[] = [];
  const P = (x: SExpr | undefined, y: SExpr | undefined): Vec => ({ x: mil(num(x)), y: mil(num(y)) });
  for (const inst of children(root, 'symbol')) {
    const libId = str(child(inst, 'lib_id')?.[1]);
    const unit = num(child(inst, 'unit')?.[1], 1);
    const def = defFor(libId, unit);
    if (!def) { warnings.push({ where: libId, message: '缺少库符号定义，已跳过' }); continue; }
    const at = child(inst, 'at')!;
    const mirrorTag = child(inst, 'mirror'); const mirror = mirrorTag ? (str(mirrorTag[1]) as 'x' | 'y') : null;
    const props: Record<string, string> = {};
    for (const p of children(inst, 'property')) props[str(p[1])] = str(p[2]);
    const placed = placeInstance(def, def.anchor ?? { x: 0, y: 0 }, P(at[1], at[2]), num(at[3]), mirror);
    const ref = props.Reference ?? def.prefix + '?';
    components.push({ id: newId('c'), ref: def.power ? `#PWR${components.length + 1}` : ref, symbolId: def.id, value: props.Value ?? def.defaultValue, footprint: props.Footprint ? `fp:kicad:${props.Footprint.split(':').pop()}` : '', x: placed.x, y: placed.y, rotation: placed.rotation, mirror: placed.mirror, props: { ...(props.Footprint ? { kicadFootprint: props.Footprint } : {}), ...(props.Datasheet && props.Datasheet !== '~' ? { datasheet: props.Datasheet } : {}) } });
  }
  const wires: Wire[] = children(root, 'wire').map((w) => ({ id: newId('w'), points: children(child(w, 'pts') ?? [], 'xy').map((xy) => P(xy[1], xy[2])) })).filter((w) => w.points.length >= 2);
  const buses: Bus[] = children(root, 'bus').map((b) => ({ id: newId('b'), points: children(child(b, 'pts') ?? [], 'xy').map((xy) => P(xy[1], xy[2])) })).filter((b) => b.points.length >= 2);
  // 总线入口画成短导线
  for (const be of children(root, 'bus_entry')) { const at = child(be, 'at')!, sz = child(be, 'size')!; const a = P(at[1], at[2]); wires.push({ id: newId('w'), points: [a, { x: a.x + mil(num(sz[1])), y: a.y + mil(num(sz[2])) }] }); }
  const junctions: Junction[] = children(root, 'junction').map((j) => { const at = child(j, 'at')!; return { id: newId('j'), ...P(at[1], at[2]) }; });
  const labels: NetLabel[] = [];
  for (const kind of ['label', 'global_label', 'hierarchical_label']) for (const l of children(root, kind)) { const at = child(l, 'at')!; labels.push({ id: newId('l'), text: str(l[1]).replace(/^\//, ''), ...P(at[1], at[2]) }); }
  const graphics: Graphic[] = [];
  for (const t of children(root, 'text')) { const at = child(t, 'at')!; graphics.push({ id: newId('g'), kind: 'text', x: mil(num(at[1])), y: mil(num(at[2])), text: str(t[1]), size: 120 }); }
  for (const pl of children(root, 'polyline')) { const pts = children(child(pl, 'pts') ?? [], 'xy').map((xy) => P(xy[1], xy[2])); if (pts.length >= 2) graphics.push({ id: newId('g'), kind: 'line', points: pts }); }
  for (const r of children(root, 'rectangle')) { const s = child(r, 'start')!, e = child(r, 'end')!; graphics.push({ id: newId('g'), kind: 'rect', a: P(s[1], s[2]), b: P(e[1], e[2]) }); }
  const paper = str(child(root, 'paper')?.[1]);
  const tb = child(root, 'title_block');
  const frame = { ...DEFAULT_FRAME, size: (['A4', 'A3', 'A2'].includes(paper) ? paper : 'A4') as 'A4', landscape: !(child(root, 'paper') && hasFlag(child(root, 'paper')!, 'portrait')), title: tb ? str(child(tb, 'title')?.[1]) : '', revision: tb ? str(child(tb, 'rev')?.[1]) || '1.0' : '1.0', company: tb ? str(child(tb, 'company')?.[1]) : '' };
  const symbols = [...defs.values()].map(({ anchor: _a, ...d }) => d as SymbolDef);
  registerSymbols(symbols);
  const sheet: Sheet = { id: opts.sheetId ?? newId('sheet'), name: opts.sheetName ?? (frame.title || '主图'), frame, components, wires, labels, junctions, buses, graphics };
  return { sheet, symbols, warnings };
}

// ---------------- PCB ----------------

const CU: Record<string, CopperLayer> = { 'F.Cu': 'F.Cu', 'B.Cu': 'B.Cu', 'In1.Cu': 'In1.Cu', 'In2.Cu': 'In2.Cu' };

function arcPoints(start: Vec, mid: Vec, end: Vec, n = 8): Vec[] {
  // 三点圆
  const ax = start.x, ay = start.y, bx = mid.x, by = mid.y, cx = end.x, cy = end.y;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return [start, end];
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  let a0 = Math.atan2(ay - uy, ax - ux), a1 = Math.atan2(cy - uy, cx - ux); const am = Math.atan2(by - uy, bx - ux);
  // 选择经过 mid 的方向
  const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let sweep = norm(a1 - a0); const mids = norm(am - a0);
  if (mids > sweep) sweep = sweep - 2 * Math.PI;
  const out: Vec[] = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (sweep * i) / n; out.push({ x: ux + r * Math.cos(a), y: uy + r * Math.sin(a) }); }
  void a1;
  return out;
}

/** 把 Edge.Cuts 的线段链接成闭合多边形。 */
function chainOutline(segs: Vec[][]): Vec[] {
  if (!segs.length) return [];
  const rest = segs.map((s) => [...s]);
  const poly = rest.shift()!;
  const tol = 0.01;
  for (let guard = 0; rest.length && guard < 10000; guard++) {
    const tail = poly[poly.length - 1];
    let found = false;
    for (let i = 0; i < rest.length; i++) {
      const s = rest[i];
      if (dist(s[0], tail) < tol) { poly.push(...s.slice(1)); rest.splice(i, 1); found = true; break; }
      if (dist(s[s.length - 1], tail) < tol) { poly.push(...s.slice(0, -1).reverse()); rest.splice(i, 1); found = true; break; }
    }
    if (!found) break;
  }
  if (poly.length > 2 && dist(poly[0], poly[poly.length - 1]) < tol) poly.pop();
  return poly.map((p) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 }));
}

export function importKicadPcb(text: string): PcbImportResult {
  const root = parseSExpr(text);
  if (root[0] !== 'kicad_pcb') throw new Error('不是 KiCad PCB 文件（kicad_pcb）');
  const warnings: ImportWarning[] = [];
  const board: Board = { ...emptyBoard(), outline: [], footprints: [], traces: [], vias: [], zones: [], texts: [] };
  const general = child(root, 'general');
  if (general) board.thickness = num(child(general, 'thickness')?.[1], 1.6);
  const layersNode = child(root, 'layers');
  const cuNames = layersNode ? layersNode.filter((l): l is SList => isList(l) && /\.Cu$/.test(str(l[1]))).map((l) => str(l[1])) : ['F.Cu', 'B.Cu'];
  board.copperCount = cuNames.length >= 4 ? 4 : 2;
  if (cuNames.length > 4) warnings.push({ where: 'layers', message: `${cuNames.length} 层板暂按 4 层导入` });
  const nets = new Map<number, string>();
  for (const n of children(root, 'net')) nets.set(num(n[1]), str(n[2]).replace(/^\//, ''));
  const netName = (node: SList | undefined) => (node ? (str(node[2]) || nets.get(num(node[1])) || '').replace(/^\//, '') : '');
  const P = (node: SList | undefined): Vec => ({ x: num(node?.[1]), y: num(node?.[2]) });

  // 封装
  const fpDefs = new Map<string, FootprintDef>();
  const fpNodes = [...children(root, 'footprint'), ...children(root, 'module')];
  for (const fp of fpNodes) {
    const libName = str(fp[1]);
    const shortName = libName.split(':').pop() || libName;
    const at = child(fp, 'at');
    const fpAngle = num(at?.[3]);
    const layer = str(child(fp, 'layer')?.[1]);
    const side: 'F' | 'B' = layer.startsWith('B') ? 'B' : 'F';
    const props: Record<string, string> = {};
    for (const p of children(fp, 'property')) props[str(p[1])] = str(p[2]);
    for (const t of children(fp, 'fp_text')) { const k = str(t[1]); if (k === 'reference') props.Reference = str(t[2]); if (k === 'value') props.Value = str(t[2]); }
    const pads: PadDef[] = [];
    const padNets: Record<string, string> = {};
    const seen = new Map<string, number>();
    for (const pad of children(fp, 'pad')) {
      let number = str(pad[1]);
      const kind = str(pad[2]), shape = str(pad[3]);
      const pat = child(pad, 'at'); const size = child(pad, 'size'); const drill = child(pad, 'drill');
      const padAngle = num(pat?.[3]);
      const rel = ((padAngle - fpAngle) % 180 + 180) % 180;
      let w = num(size?.[1]), h = num(size?.[2]);
      if (Math.abs(rel - 90) < 1e-6) [w, h] = [h, w];
      const npth = kind === 'np_thru_hole';
      if (!number) number = npth ? `NPTH${pads.length + 1}` : `P${pads.length + 1}`;
      const dup = seen.get(number) ?? 0; seen.set(number, dup + 1);
      const drillD = drill ? (typeof drill[1] === 'number' ? num(drill[1]) : num(drill[2])) : 0;
      pads.push({ number, x: num(pat?.[1]), y: num(pat?.[2]), w, h, shape: shape === 'circle' ? 'circle' : shape === 'oval' ? 'oval' : shape === 'roundrect' ? 'roundrect' : 'rect', drill: kind === 'smd' ? 0 : drillD, npth });
      const nn = netName(child(pad, 'net'));
      if (nn && !padNets[number]) padNets[number] = nn;
    }
    // 本体：优先 courtyard，其次 fab，其次焊盘外接框
    const boxFrom = (layerName: string): { w: number; h: number } | null => {
      const pts: Vec[] = [];
      for (const ln of children(fp, 'fp_line')) if (str(child(ln, 'layer')?.[1]) === layerName) pts.push(P(child(ln, 'start')), P(child(ln, 'end')));
      for (const r of children(fp, 'fp_rect')) if (str(child(r, 'layer')?.[1]) === layerName) pts.push(P(child(r, 'start')), P(child(r, 'end')));
      for (const c of children(fp, 'fp_circle')) if (str(child(c, 'layer')?.[1]) === layerName) { const ce = P(child(c, 'center')), en = P(child(c, 'end')); const r = dist(ce, en); pts.push({ x: ce.x - r, y: ce.y - r }, { x: ce.x + r, y: ce.y + r }); }
      if (!pts.length) return null;
      return { w: Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)), h: Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)) };
    };
    const body = boxFrom('F.CrtYd') ?? boxFrom('B.CrtYd') ?? boxFrom('F.Fab') ?? boxFrom('B.Fab') ?? boxFrom('F.SilkS') ?? (pads.length ? { w: Math.max(...pads.map((p) => Math.abs(p.x) + p.w / 2)) * 2 + 0.2, h: Math.max(...pads.map((p) => Math.abs(p.y) + p.h / 2)) * 2 + 0.2 } : { w: 2, h: 2 });
    const sig = JSON.stringify(pads.map((p) => [p.number, p.x, p.y, p.w, p.h, p.shape, p.drill]));
    let id = `fp:kicad:${shortName}`;
    for (let k = 2; fpDefs.has(id) && JSON.stringify(fpDefs.get(id)!.pads.map((p) => [p.number, p.x, p.y, p.w, p.h, p.shape, p.drill])) !== sig; k++) id = `fp:kicad:${shortName}#${k}`;
    if (!fpDefs.has(id)) fpDefs.set(id, { id, name: shortName, body: { w: Math.round(body.w * 100) / 100, h: Math.round(body.h * 100) / 100 }, pads, height: 1, description: `KiCad ${libName}` });
    board.footprints.push({ id: newId('fp'), ref: props.Reference ?? 'REF?', footprintId: id, value: props.Value ?? '', x: num(at?.[1]), y: num(at?.[2]), rotation: ((-fpAngle) % 360 + 360) % 360, side, padNets });
  }
  // 走线 / 过孔
  for (const s of children(root, 'segment')) {
    const layer = CU[str(child(s, 'layer')?.[1])];
    if (!layer) continue;
    board.traces.push({ id: newId('t'), layer, points: [P(child(s, 'start')), P(child(s, 'end'))], width: num(child(s, 'width')?.[1], 0.25), net: nets.get(num(child(s, 'net')?.[1])) ?? '' } as Trace);
  }
  for (const v of children(root, 'via')) {
    const at = P(child(v, 'at'));
    board.vias.push({ id: newId('v'), x: at.x, y: at.y, size: num(child(v, 'size')?.[1], 0.6), drill: num(child(v, 'drill')?.[1], 0.3), net: nets.get(num(child(v, 'net')?.[1])) ?? '' } as Via);
  }
  // 铺铜
  for (const z of children(root, 'zone')) {
    const layer = CU[str(child(z, 'layer')?.[1])] ?? CU[str(child(z, 'layers')?.[1])];
    if (!layer) continue;
    const poly = child(z, 'polygon');
    const pts = poly ? children(child(poly, 'pts') ?? [], 'xy').map((xy) => ({ x: num(xy[1]), y: num(xy[2]) })) : [];
    if (pts.length >= 3) board.zones.push({ id: newId('z'), layer, net: str(child(z, 'net_name')?.[1]).replace(/^\//, '') || nets.get(num(child(z, 'net')?.[1])) || '', polygon: pts } as Zone);
  }
  // 板框 + 文字
  const edgeSegs: Vec[][] = [];
  const onEdge = (n: SList) => str(child(n, 'layer')?.[1]) === 'Edge.Cuts';
  for (const l of children(root, 'gr_line')) if (onEdge(l)) edgeSegs.push([P(child(l, 'start')), P(child(l, 'end'))]);
  for (const a of children(root, 'gr_arc')) if (onEdge(a)) { const s = child(a, 'start'), m = child(a, 'mid'), e = child(a, 'end'); if (s && m && e) edgeSegs.push(arcPoints(P(s), P(m), P(e))); }
  for (const r of children(root, 'gr_rect')) if (onEdge(r)) { const a = P(child(r, 'start')), b = P(child(r, 'end')); edgeSegs.push([a, { x: b.x, y: a.y }], [{ x: b.x, y: a.y }, b], [b, { x: a.x, y: b.y }], [{ x: a.x, y: b.y }, a]); }
  for (const pl of children(root, 'gr_poly')) if (onEdge(pl)) { const pts = children(child(pl, 'pts') ?? [], 'xy').map((xy) => ({ x: num(xy[1]), y: num(xy[2]) })); if (pts.length >= 3) board.outline = pts; }
  for (const c of children(root, 'gr_circle')) if (onEdge(c) && !board.outline.length) { const ce = P(child(c, 'center')), en = P(child(c, 'end')); const r = dist(ce, en); board.outline = Array.from({ length: 48 }, (_, i) => ({ x: ce.x + r * Math.cos((i / 48) * 2 * Math.PI), y: ce.y + r * Math.sin((i / 48) * 2 * Math.PI) })); }
  if (!board.outline.length) board.outline = chainOutline(edgeSegs);
  if (board.outline.length < 3) {
    // 没有板框：按内容外接框 + 2mm
    const pts: Vec[] = [...board.footprints.map((f) => ({ x: f.x, y: f.y })), ...board.traces.flatMap((t) => t.points)];
    if (pts.length) { const minX = Math.min(...pts.map((p) => p.x)) - 5, minY = Math.min(...pts.map((p) => p.y)) - 5, maxX = Math.max(...pts.map((p) => p.x)) + 5, maxY = Math.max(...pts.map((p) => p.y)) + 5; board.outline = [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }]; }
    else board.outline = emptyBoard().outline;
    warnings.push({ where: 'Edge.Cuts', message: '未找到闭合板框，已按内容生成矩形板框' });
  }
  for (const t of children(root, 'gr_text')) {
    const layer = str(child(t, 'layer')?.[1]);
    if (layer !== 'F.SilkS' && layer !== 'B.SilkS') continue;
    const at = P(child(t, 'at'));
    const font = child(child(t, 'effects') ?? [], 'font'); const size = font ? num(child(font, 'size')?.[1], 1) : 1;
    board.texts.push({ id: newId('x'), layer: layer === 'F.SilkS' ? 'F.Silk' : 'B.Silk', text: str(t[1]), x: at.x, y: at.y, size } as BoardText);
  }
  // 网络类：从走线宽度推断电源类
  const footprints = [...fpDefs.values()];
  registerFootprints(footprints);
  return { board, footprints, warnings };
}

// ---------------- 项目 ----------------

export interface KicadImportInput { name?: string; schematics?: { name: string; text: string }[]; pcb?: string }
export interface KicadImportResult { project: Project; warnings: ImportWarning[] }

/** 汇总多个 .kicad_sch（每个一页）与一个 .kicad_pcb 成项目；按位号关联封装与元件。 */
export function importKicadProject(input: KicadImportInput): KicadImportResult {
  const warnings: ImportWarning[] = [];
  const project = createProject({ name: input.name ?? 'KiCad 导入' });
  const symbols: SymbolDef[] = [];
  const sheets: Sheet[] = [];
  for (const s of input.schematics ?? []) {
    try { const r = importKicadSchematic(s.text, { sheetName: s.name }); sheets.push(r.sheet); symbols.push(...r.symbols); warnings.push(...r.warnings.map((w) => ({ ...w, where: `${s.name}: ${w.where}` }))); }
    catch (e) { warnings.push({ where: s.name, message: (e as Error).message }); }
  }
  if (sheets.length) project.schematic.sheets = sheets;
  // 位号计数器
  const counters: Record<string, number> = {};
  for (const sh of project.schematic.sheets) for (const c of sh.components) { const m = /^([A-Za-z#]+)(\d+)$/.exec(c.ref); if (m) counters[m[1]] = Math.max(counters[m[1]] ?? 1, Number(m[2]) + 1); }
  project.schematic.counters = counters;
  let footprints: FootprintDef[] = [];
  if (input.pcb) {
    try {
      const r = importKicadPcb(input.pcb);
      project.board = r.board; footprints = r.footprints; warnings.push(...r.warnings);
      const byRef = new Map<string, SchComponent>();
      for (const sh of project.schematic.sheets) for (const c of sh.components) if (!getSymbol(c.symbolId).power) byRef.set(c.ref, c);
      for (const f of project.board.footprints) { const c = byRef.get(f.ref); if (c) { f.componentId = c.id; if (!c.footprint || !footprints.some((d) => d.id === c.footprint)) c.footprint = f.footprintId; } }
      // 用原理图网表补全未命名焊盘网络
      if (sheets.length) { const nl = buildSchematicNetlist(project.schematic); for (const f of project.board.footprints) if (f.componentId) for (const k of Object.keys(f.padNets)) if (!f.padNets[k]) f.padNets[k] = nl.pinNet.get(`${f.componentId}:${k}`) ?? ''; }
    } catch (e) { warnings.push({ where: 'pcb', message: (e as Error).message }); }
  }
  project.library = { symbols, footprints };
  registerSymbols(symbols); registerFootprints(footprints);
  return { project, warnings };
}

export const _kicadInternal = { snap, arcPoints, chainOutline, placeInstance };
