/**
 * 嘉立创 EDA（EasyEDA 标准版）导入：「文件 → 导出 → EasyEDA 源码 / JSON」得到的文档。
 * - docType 1 原理图 → 图纸 + 项目内符号；docType 3 PCB → 板 + 项目内封装；docType 2 / 4 符号 / 封装 → 项目库
 * - 单位：1 单位 = 10 mil（原理图直接 ×10 为 mil；PCB ×0.254 为 mm），y 向下与本模型一致
 * - EasyEDA 专业版（.eprj / .esch / .epcb）为私有格式，暂不支持，请先在专业版里导出为标准版或 KiCad
 */
import type { Sheet, SymbolDef, PinDef, SymbolShape, SchComponent, Wire, NetLabel, Junction, Bus, Graphic, PinType } from '../model/schematic.js';
import { DEFAULT_FRAME } from '../model/schematic.js';
import type { Board, FootprintDef, PadDef, BoardFootprint, Trace, Via, Zone, BoardText, CopperLayer } from '../model/board.js';
import { emptyBoard } from '../model/board.js';
import { createProject, type Project } from '../model/project.js';
import { registerSymbols, registerFootprints } from '../library/registry.js';
import { getSymbol } from '../library/symbols.js';
import { buildSchematicNetlist } from '../schematic/connectivity.js';
import { newId } from '../ids.js';
import type { Vec } from '../geometry.js';
import type { ImportWarning, SchImportResult, PcbImportResult, KicadImportResult } from './kicad.js';
import { _kicadInternal } from './kicad.js';

// ---------------- 通用解析 ----------------
const num = (v: string | undefined, d = 0) => { const n = parseFloat(v ?? ''); return Number.isFinite(n) ? n : d; };
const attrs = (s: string): Record<string, string> => { const parts = s.split('`'); const o: Record<string, string> = {}; for (let i = 0; i + 1 < parts.length; i += 2) o[parts[i]] = parts[i + 1]; return o; };
const r2 = (v: number) => Math.round(v * 100) / 100 + 0;
const r3 = (v: number) => Math.round(v * 1000) / 1000 + 0;
const MIL = 10, MM = 0.254;

/** SVG 路径子集（M L H V Z A，大小写）→ 折线组（原始单位）。 */
export function svgPathToPolylines(d: string, arcSteps = 12): Vec[][] {
  const tokens = d.match(/[MLHVZAmlhvza]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const out: Vec[][] = []; let cur: Vec[] = []; let cmd = 'M'; let x = 0, y = 0, sx = 0, sy = 0; let i = 0;
  const flush = () => { if (cur.length >= 2) out.push(cur); cur = []; };
  const next = () => num(tokens[i++]);
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[a-z]$/i.test(t)) { cmd = t; i++; if (cmd === 'Z' || cmd === 'z') { if (cur.length) cur.push({ x: sx, y: sy }); x = sx; y = sy; flush(); cur = [{ x, y }]; } continue; }
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case 'M': { const nx = next(), ny = next(); x = rel ? x + nx : nx; y = rel ? y + ny : ny; flush(); cur = [{ x, y }]; sx = x; sy = y; cmd = rel ? 'l' : 'L'; break; }
      case 'L': { const nx = next(), ny = next(); x = rel ? x + nx : nx; y = rel ? y + ny : ny; cur.push({ x, y }); break; }
      case 'H': { const nx = next(); x = rel ? x + nx : nx; cur.push({ x, y }); break; }
      case 'V': { const ny = next(); y = rel ? y + ny : ny; cur.push({ x, y }); break; }
      case 'A': {
        const rx = Math.abs(next()), ry = Math.abs(next()), rot = next(), large = next() !== 0, sweep = next() !== 0; const ex0 = next(), ey0 = next();
        const ex = rel ? x + ex0 : ex0, ey = rel ? y + ey0 : ey0;
        cur.push(...arcPoints({ x, y }, { x: ex, y: ey }, rx, ry, rot, large, sweep, arcSteps).slice(1));
        x = ex; y = ey; break;
      }
      default: i++;
    }
  }
  flush();
  return out;
}
/** SVG 椭圆弧端点参数 → 采样点（含起终点）。 */
function arcPoints(p1: Vec, p2: Vec, rx: number, ry: number, rotDeg: number, large: boolean, sweep: boolean, n: number): Vec[] {
  if (rx === 0 || ry === 0) return [p1, p2];
  const phi = (rotDeg * Math.PI) / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (p1.x - p2.x) / 2, dy = (p1.y - p2.y) / 2;
  const x1 = cp * dx + sp * dy, y1 = -sp * dx + cp * dy;
  let l = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry); if (l > 1) { rx *= Math.sqrt(l); ry *= Math.sqrt(l); l = 1; }
  const sign = large === sweep ? -1 : 1;
  const sq = Math.max(0, (rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1) / (rx * rx * y1 * y1 + ry * ry * x1 * x1));
  const coef = sign * Math.sqrt(sq);
  const cx1 = (coef * rx * y1) / ry, cy1 = (-coef * ry * x1) / rx;
  const cx = cp * cx1 - sp * cy1 + (p1.x + p2.x) / 2, cy = sp * cx1 + cp * cy1 + (p1.y + p2.y) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
  const pts: Vec[] = [];
  for (let k = 0; k <= n; k++) { const t = t1 + (dt * k) / n; const ex = rx * Math.cos(t), ey = ry * Math.sin(t); pts.push({ x: cp * ex - sp * ey + cx, y: sp * ex + cp * ey + cy }); }
  pts[0] = p1; pts[pts.length - 1] = p2;
  return pts;
}

interface EdaDoc { head: { docType: string | number; x?: number | string; y?: number | string; c_para?: Record<string, string>; [k: string]: unknown }; canvas?: string; shape: string[]; title?: string; /** title 仅来自文件名（而非工程导出里的图纸标题） */ titleFromFile?: boolean }
/** 从任意 JSON 结构中找出 EasyEDA 文档（支持 dataStr 字符串、schematics/pcbs 数组、单文档）。 */
export function findEasyEdaDocs(json: unknown, titleHint?: string): (EdaDoc & { title?: string })[] {
  const out: (EdaDoc & { title?: string })[] = [];
  const visit = (v: unknown, title?: string, depth = 0) => {
    if (depth > 6 || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) { for (const x of v) visit(x, title, depth + 1); return; }
    const o = v as Record<string, unknown>;
    if (typeof o.dataStr === 'string') { try { visit(JSON.parse(o.dataStr), (o.title as string) ?? title, depth + 1); } catch { /* ignore */ } return; }
    if (o.dataStr && typeof o.dataStr === 'object') { visit(o.dataStr, (o.title as string) ?? title, depth + 1); return; }
    if (o.head && typeof o.head === 'object' && Array.isArray(o.shape)) { const t = title ?? (o.title as string); out.push({ ...(o as unknown as EdaDoc), title: t ?? titleHint, titleFromFile: !t }); return; }
    for (const [k, x] of Object.entries(o)) visit(x, typeof o.title === 'string' ? o.title : k === 'schematics' || k === 'pcbs' ? undefined : title, depth + 1);
  };
  visit(json, undefined);
  return out;
}
const docType = (d: EdaDoc) => String(d.head.docType);
/** 画布原点：CA 串中 unit 之后第一对都 ≥ 500 的数字（典型 4000,3000）；不同版本字段数不一，按模式找更稳。 */
const canvasOrigin = (d: EdaDoc): Vec => {
  const c = (d.canvas ?? '').split('~');
  const start = Math.max(1, c.findIndex((v) => v === 'mil' || v === 'mm' || v === 'pixel'));
  for (let i = start; i + 1 < c.length; i++) { const a = num(c[i], NaN), b = num(c[i + 1], NaN); if (Number.isFinite(a) && Number.isFinite(b) && a >= 500 && b >= 500) return { x: a, y: b }; }
  return { x: 0, y: 0 };
};

// ---------------- 原理图符号（LIB 子形状 → SymbolDef） ----------------
const PIN_TYPES: Record<string, PinType> = { '0': 'passive', '1': 'input', '2': 'output', '3': 'bidirectional', '4': 'power_in' };

interface SymBuild { def: SymbolDef; anchor: Vec; ref?: string; value?: string; package?: string; extras: Record<string, string> }

/** 把一组 EasyEDA 形状（绝对坐标，单位 px）转成局部符号定义，origin 为 LIB 锚点。 */
function buildSymbol(shapes: string[], origin: Vec, name: string, prefix: string): SymBuild {
  const S: SymbolShape[] = []; const pins: (PinDef & { _base: Vec })[] = [];
  let ref: string | undefined, value: string | undefined; const extras: Record<string, string> = {};
  const P = (x: number, y: number): Vec => ({ x: r2((x - origin.x) * MIL), y: r2((y - origin.y) * MIL) });
  const fillOf = (c: string | undefined): 'none' | 'background' => (!c || c === 'none' || c === '' ? 'none' : 'background');
  for (const raw of shapes) {
    const a = raw.split('~'); const k = a[0];
    if (k === 'R') { const x = num(a[1]), y = num(a[2]), w = num(a[5]), h = num(a[6]); S.push({ kind: 'rect', a: P(x, y), b: P(x + w, y + h), fill: fillOf(a[10]), width: 10 }); }
    else if (k === 'E') { const cx = num(a[1]), cy = num(a[2]), rx = num(a[3]), ry = num(a[4]); S.push({ kind: 'circle', c: P(cx, cy), r: r2(((rx + ry) / 2) * MIL), fill: fillOf(a[7]), width: 10 }); }
    else if (k === 'CI') { S.push({ kind: 'circle', c: P(num(a[1]), num(a[2])), r: r2(num(a[3]) * MIL), fill: fillOf(a[6]), width: 10 }); }
    else if (k === 'PL' || k === 'PG') { const pts = pairs(a[1]).map((q) => P(q.x, q.y)); if (pts.length >= 2) S.push({ kind: 'polyline', points: k === 'PG' ? [...pts, pts[0]] : pts, fill: k === 'PG' ? fillOf(a[5]) : 'none', width: 10 }); }
    else if (k === 'PT' || k === 'A') { for (const pl of svgPathToPolylines(a[1])) if (pl.length >= 2) S.push({ kind: 'polyline', points: pl.map((q) => P(q.x, q.y)), fill: 'none', width: 10 }); }
    else if (k === 'T') {
      const mark = a[1], text = a[12] ?? '';
      if (mark === 'P') ref = text; else if (mark === 'N') value = text; else if (text) S.push({ kind: 'text', x: P(num(a[2]), num(a[3])).x, y: P(num(a[2]), num(a[3])).y, text, size: 50 });
      if (mark && mark !== 'P' && mark !== 'N' && mark !== 'L') extras[mark] = text;
    }
    else if (k === 'P') {
      const secs = raw.split('^^'); const c = secs[0].split('~');
      const ex = num(c[4]), ey = num(c[5]);
      const path = (secs[2] ?? '').split('~')[0];
      const pl = svgPathToPolylines(path)[0] ?? [{ x: ex, y: ey }, { x: ex, y: ey }];
      const start = pl[0], endp = pl[pl.length - 1];
      // 路径从端点画向本体（或反之）：离连接点远的一端是本体侧
      const dEnd = Math.hypot(endp.x - ex, endp.y - ey), dStart = Math.hypot(start.x - ex, start.y - ey);
      const body = dEnd >= dStart ? endp : start;
      const dx = body.x - ex, dy = body.y - ey;
      const dir = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 0 : 180) : (dy >= 0 ? 270 : 90);
      const length = Math.max(0, r2(Math.hypot(dx, dy) * MIL));
      const nm = (secs[3] ?? '').split('~'), nb = (secs[4] ?? '').split('~');
      const number = (nb[4] ?? '').trim() || String(pins.length + 1);
      const pname = (nm[4] ?? '').trim() || number;
      const hidden = c[1] === '0' || c[1] === 'hide';
      pins.push({ number, name: pname, side: dir === 0 ? 'L' : dir === 180 ? 'R' : dir === 90 ? 'B' : 'T', offset: 0, length, type: PIN_TYPES[c[2]] ?? 'passive', at: P(ex, ey), dir, hidden, _base: P(body.x, body.y) });
    }
  }
  const pts: Vec[] = [];
  for (const s of S) { if (s.kind === 'polyline') pts.push(...s.points); else if (s.kind === 'rect') pts.push(s.a, s.b); else if (s.kind === 'circle') pts.push({ x: s.c.x - s.r, y: s.c.y - s.r }, { x: s.c.x + s.r, y: s.c.y + s.r }); else if (s.kind === 'arc') pts.push(s.start, s.mid, s.end); else pts.push({ x: s.x, y: s.y }); }
  for (const p of pins) pts.push(p.at!, p._base);
  if (!pts.length) pts.push({ x: -100, y: -100 }, { x: 100, y: 100 });
  const minX = Math.min(...pts.map((p) => p.x)), minY = Math.min(...pts.map((p) => p.y)), maxX = Math.max(...pts.map((p) => p.x)), maxY = Math.max(...pts.map((p) => p.y));
  const sh = (p: Vec): Vec => ({ x: r2(p.x - minX), y: r2(p.y - minY) });
  const shapes2: SymbolShape[] = S.map((s) => s.kind === 'polyline' ? { ...s, points: s.points.map(sh) } : s.kind === 'rect' ? { ...s, a: sh(s.a), b: sh(s.b) } : s.kind === 'circle' ? { ...s, c: sh(s.c) } : s.kind === 'arc' ? { ...s, start: sh(s.start), mid: sh(s.mid), end: sh(s.end) } : { ...s, ...sh({ x: s.x, y: s.y }) });
  const sig = JSON.stringify([shapes2, pins.map(({ _base, ...p }) => ({ ...p, at: sh(p.at!) }))]);
  const id = `sym:easyeda:${name.replace(/[^\w.+-]+/g, '_')}#${hash(sig)}`;
  const def: SymbolDef = {
    id, name, kind: '导入', prefix: prefix || 'U', width: Math.max(1, r2(maxX - minX)), height: Math.max(1, r2(maxY - minY)), graphic: 'shapes', shapes: shapes2,
    pins: pins.map(({ _base, ...p }) => ({ ...p, at: sh(p.at!) })), showPinNames: true, power: false, defaultValue: value ?? '', defaultFootprint: '', description: '', source: `easyeda:${name}`
  };
  return { def, anchor: sh({ x: 0, y: 0 }), ref, value, extras };
}
function pairs(s: string): Vec[] { const n = (s ?? '').trim().split(/[\s,]+/).map(Number).filter((v) => Number.isFinite(v)); const out: Vec[] = []; for (let i = 0; i + 1 < n.length; i += 2) out.push({ x: n[i], y: n[i + 1] }); return out; }
function hash(s: string): string { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
const GND_RE = /^(gnd|vss|agnd|dgnd|pgnd|earth)/i;

// ---------------- 原理图 ----------------
export function importEasyEdaSchematic(doc: EdaDoc, opts: { sheetName?: string } = {}): SchImportResult {
  const warnings: ImportWarning[] = [];
  const symbols = new Map<string, SymbolDef>();
  const components: SchComponent[] = [], wires: Wire[] = [], labels: NetLabel[] = [], junctions: Junction[] = [], buses: Bus[] = [], graphics: Graphic[] = [];
  const P = (x: number, y: number): Vec => ({ x: r2(x * MIL), y: r2(y * MIL) });
  let netCount = 0;
  for (const raw of doc.shape) {
    const [headStr, ...children] = raw.split('#@$');
    const a = headStr.split('~'); const k = a[0];
    try {
      if (k === 'LIB') {
        const origin = { x: num(a[1]), y: num(a[2]) }, at = attrs(a[3]), rotation = ((num(a[4]) % 360) + 360) % 360;
        const pkg = at.package ?? '';
        const b = buildSymbol(children, origin, at.name || pkg || at.spicePre || 'Part', (at.spicePre || at.pre || (b0(children) ?? 'U?')).replace(/[?\d]+$/, ''));
        const existing = symbols.get(b.def.id); const def = existing ?? b.def; if (!existing) symbols.set(def.id, def);
        const placed = _kicadInternal.placeInstance(def, b.anchor, P(origin.x, origin.y), -rotation, null);
        const ref = b.ref ?? `${def.prefix}?`;
        components.push({ id: newId('c'), ref, symbolId: def.id, value: b.value ?? def.defaultValue, footprint: pkg ? `fp:easyeda:${pkg.replace(/[^\w.+-]+/g, '_')}` : '', x: placed.x, y: placed.y, rotation: placed.rotation, mirror: false, props: { ...(pkg ? { easyedaPackage: pkg } : {}), ...(at.Manufacturer_Part ? { mpn: at.Manufacturer_Part } : {}), ...(at['Supplier Part'] || at.LCSC ? { lcsc: at['Supplier Part'] ?? at.LCSC } : {}) } });
      } else if (k === 'W') { const pts = pairs(a[1]).map((q) => P(q.x, q.y)); if (pts.length >= 2) wires.push({ id: newId('w'), points: pts }); }
      else if (k === 'B') { const pts = pairs(a[1]).map((q) => P(q.x, q.y)); if (pts.length >= 2) buses.push({ id: newId('b'), points: pts }); }
      else if (k === 'BE') { const pts = pairs(a[1] ?? '').map((q) => P(q.x, q.y)); if (pts.length >= 2) wires.push({ id: newId('w'), points: pts }); }
      else if (k === 'N') { const name = a[5] ?? ''; if (name) labels.push({ id: newId('l'), text: name, ...P(num(a[1]), num(a[2])) }); netCount++; }
      else if (k === 'J') junctions.push({ id: newId('j'), ...P(num(a[1]), num(a[2])) });
      else if (k === 'F') {
        // 网络标志（电源 / 地）：连接点 (x,y)，名称在子文本中
        const tip = P(num(a[2]), num(a[3]));
        const t = children.map((c) => c.split('~')).find((c) => c[0] === 'T');
        const name = (t?.[12] ?? (/gnd/i.test(a[1]) ? 'GND' : 'VCC')).trim();
        if (GND_RE.test(name)) components.push({ id: newId('c'), ref: `#GND${components.length + 1}`, symbolId: 'sym:GND', value: 'GND', footprint: '', x: tip.x - 150, y: tip.y + 200, rotation: 0, mirror: false, props: {} });
        else components.push({ id: newId('c'), ref: `#PWR${components.length + 1}`, symbolId: 'sym:PWR', value: name, footprint: '', x: tip.x - 200, y: tip.y - 400, rotation: 0, mirror: false, props: {} });
        // 电源符号只在正上 / 正下方向连接；其余方向补一段短线保证连通
        wires.push({ id: newId('w'), points: [tip, tip] });
      }
      else if (k === 'T') { const text = a[12] ?? ''; if (text) graphics.push({ id: newId('g'), kind: 'text', ...P(num(a[2]), num(a[3])), text, size: 100 }); }
      else if (k === 'R') { const x = num(a[1]), y = num(a[2]), w = num(a[5]), h = num(a[6]); graphics.push({ id: newId('g'), kind: 'rect', a: P(x, y), b: P(x + w, y + h) }); }
      else if (k === 'PL' || k === 'PT') { const pls = k === 'PL' ? [pairs(a[1])] : svgPathToPolylines(a[1]); for (const pl of pls) if (pl.length >= 2) graphics.push({ id: newId('g'), kind: 'line', points: pl.map((q) => P(q.x, q.y)) }); }
    } catch (e) { warnings.push({ where: k, message: (e as Error).message }); }
  }
  // 去掉零长度占位线
  const cleanWires = wires.filter((w) => !(w.points.length === 2 && w.points[0].x === w.points[1].x && w.points[0].y === w.points[1].y));
  const counters: Record<string, number> = {};
  for (const c of components) { const m = /^([A-Za-z#]+)(\d+)$/.exec(c.ref); if (m) counters[m[1]] = Math.max(counters[m[1]] ?? 1, Number(m[2]) + 1); }
  const symbolList = [...symbols.values()];
  registerSymbols(symbolList);
  const title = doc.head.c_para?.title || undefined;
  const sheet: Sheet = { id: newId('sheet'), name: opts.sheetName ?? title ?? doc.title ?? '主图', frame: { ...DEFAULT_FRAME, size: 'A3', title: title ?? '' }, components, wires: cleanWires, labels, junctions, buses, graphics };
  void netCount;
  return { sheet, symbols: symbolList, warnings };
}
function b0(children: string[]): string | undefined { for (const c of children) { const a = c.split('~'); if (a[0] === 'T' && a[1] === 'P') return a[12]; } return undefined; }

// ---------------- PCB ----------------
const LAYER: Record<string, CopperLayer> = { '1': 'F.Cu', '2': 'B.Cu', '21': 'In1.Cu', '22': 'In2.Cu' };
function rot(p: Vec, deg: number): Vec { const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return { x: p.x * c - p.y * s, y: p.x * s + p.y * c }; }

interface FpBuild { def: FootprintDef; padNets: Record<string, string>; ref?: string; value?: string }
/** 把 PCB 内 LIB 子形状（绝对坐标，已按 rotation 变换）转成局部封装定义（mm，相对 LIB 原点，未旋转）。 */
function buildFootprint(shapes: string[], origin: Vec, rotation: number, name: string): FpBuild {
  const pads: PadDef[] = []; const padNets: Record<string, string> = {}; const outline: Vec[] = []; let ref: string | undefined, value: string | undefined;
  const L = (x: number, y: number): Vec => { const r = rot({ x: (x - origin.x) * MM, y: (y - origin.y) * MM }, -rotation); return { x: r3(r.x), y: r3(r.y) }; };
  const seen = new Map<string, number>();
  for (const raw of shapes) {
    const a = raw.split('~'); const k = a[0];
    if (k === 'PAD') {
      const shape = a[1], c = L(num(a[2]), num(a[3])); let w = num(a[4]) * MM, h = num(a[5]) * MM; const layer = a[6], net = a[7] ?? ''; let number = a[8] ?? ''; const holeR = num(a[9]) * MM; const padRot = num(a[11]); const holeLen = num(a[13]) * MM; const plated = (a[15] ?? 'Y').toUpperCase() !== 'N';
      const rel = (((padRot - rotation) % 180) + 180) % 180; if (Math.abs(rel - 90) < 1) [w, h] = [h, w];
      if (shape === 'POLYGON' && a[10]) { const pts = pairs(a[10]); if (pts.length) { const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y); w = (Math.max(...xs) - Math.min(...xs)) * MM; h = (Math.max(...ys) - Math.min(...ys)) * MM; } }
      const through = layer === '11' || holeR > 0;
      if (!number) number = through && !plated ? `NPTH${pads.length + 1}` : `P${pads.length + 1}`;
      seen.set(number, (seen.get(number) ?? 0) + 1);
      const drill = through ? r3(holeLen > 0 ? Math.max(holeR * 2, holeLen) : holeR * 2) : 0;
      pads.push({ number, x: c.x, y: c.y, w: r3(Math.max(w, 0.05)), h: r3(Math.max(h, 0.05)), shape: shape === 'ELLIPSE' ? (Math.abs(w - h) < 1e-6 ? 'circle' : 'oval') : shape === 'OVAL' ? 'oval' : 'rect', drill, npth: through && !plated });
      if (!(number in padNets) || (net && !padNets[number])) padNets[number] = net;
    } else if (k === 'TRACK' && (a[2] === '3' || a[2] === '4' || a[2] === '13' || a[2] === '14' || a[2] === '99')) { for (const q of pairs(a[4])) outline.push(L(q.x, q.y)); }
    else if (k === 'CIRCLE' && (a[3] === '3' || a[3] === '4')) { const c = L(num(a[1]), num(a[2])), r = num(a[3 + 1 - 1]) * 0; void c; void r; }
    else if (k === 'TEXT') { if (a[1] === 'P') ref = a[10]; else if (a[1] === 'N') value = a[10]; }
  }
  const xs = [...outline.map((p) => p.x), ...pads.map((p) => p.x - p.w / 2), ...pads.map((p) => p.x + p.w / 2)], ys = [...outline.map((p) => p.y), ...pads.map((p) => p.y - p.h / 2), ...pads.map((p) => p.y + p.h / 2)];
  const body = xs.length ? { w: r3(Math.max(...xs) - Math.min(...xs) + 0.2), h: r3(Math.max(...ys) - Math.min(...ys) + 0.2) } : { w: 2, h: 2 };
  const sig = JSON.stringify(pads.map((p) => [p.number, p.x, p.y, p.w, p.h, p.shape, p.drill]));
  const short = name.replace(/[^\w.+-]+/g, '_') || 'Footprint';
  const def: FootprintDef = { id: `fp:easyeda:${short}#${hash(sig)}`, name, body, pads, height: pads.some((p) => p.drill > 0 && !p.npth) ? 4 : 1, description: `EasyEDA ${name}` };
  return { def, padNets, ref, value };
}

export function importEasyEdaPcb(doc: EdaDoc): PcbImportResult {
  const warnings: ImportWarning[] = [];
  const board: Board = { ...emptyBoard(), outline: [], footprints: [], traces: [], vias: [], zones: [], texts: [] };
  const o = canvasOrigin(doc);
  const P = (x: number, y: number): Vec => ({ x: r3((x - o.x) * MM), y: r3((y - o.y) * MM) });
  const fpDefs = new Map<string, FootprintDef>();
  const edge: Vec[][] = [];
  let inner = false;
  for (const raw of doc.shape) {
    const [headStr, ...children] = raw.split('#@$');
    const a = headStr.split('~'); const k = a[0];
    try {
      if (k === 'LIB') {
        const origin = { x: num(a[1]), y: num(a[2]) }, at = attrs(a[3]), rotation = num(a[4]);
        const name = at.package || 'Footprint';
        const b = buildFootprint(children, origin, rotation, name);
        if (!fpDefs.has(b.def.id)) fpDefs.set(b.def.id, b.def);
        const side: 'F' | 'B' = children.some((c) => { const p = c.split('~'); return p[0] === 'PAD' && p[6] === '2'; }) && !children.some((c) => { const p = c.split('~'); return p[0] === 'PAD' && p[6] === '1'; }) ? 'B' : 'F';
        board.footprints.push({ id: newId('fp'), ref: b.ref ?? at.pre ?? 'REF?', footprintId: b.def.id, value: b.value ?? at.name ?? '', x: P(origin.x, origin.y).x, y: P(origin.x, origin.y).y, rotation: ((rotation % 360) + 360) % 360, side, padNets: b.padNets, locked: a[7] === '1' });
      } else if (k === 'TRACK') {
        const layer = LAYER[a[2]]; const pts = pairs(a[4]).map((q) => P(q.x, q.y));
        if (a[2] === '10') { for (let i = 0; i + 1 < pts.length; i++) edge.push([pts[i], pts[i + 1]]); }
        else if (layer && pts.length >= 2) { if (layer.startsWith('In')) inner = true; board.traces.push({ id: newId('t'), layer, points: pts, width: r3(num(a[1]) * MM) || 0.25, net: a[3] ?? '' } as Trace); }
        else if ((a[2] === '3' || a[2] === '4') && pts.length >= 2) { /* 顶层丝印线暂不导入 */ }
      } else if (k === 'VIA') {
        const c = P(num(a[1]), num(a[2]));
        board.vias.push({ id: newId('v'), x: c.x, y: c.y, size: r3(num(a[3]) * MM) || 0.6, drill: r3(num(a[5]) * 2 * MM) || 0.3, net: a[4] ?? '' } as Via);
      } else if (k === 'COPPERAREA') {
        const layer = LAYER[a[2]]; if (!layer) continue;
        const poly = svgPathToPolylines(a[4])[0]?.map((q) => P(q.x, q.y)) ?? [];
        if (poly.length >= 3) { if (layer.startsWith('In')) inner = true; board.zones.push({ id: newId('z'), layer, net: a[3] ?? '', polygon: poly, clearance: r3(num(a[5]) * MM) } as Zone); }
      } else if (k === 'ARC' && a[2] === '10') { for (const pl of svgPathToPolylines(a[4], 16)) for (let i = 0; i + 1 < pl.length; i++) edge.push([P(pl[i].x, pl[i].y), P(pl[i + 1].x, pl[i + 1].y)]); }
      else if (k === 'RECT' && a[5] === '10') { const x = num(a[1]), y = num(a[2]), w = num(a[3]), h = num(a[4]); const c = [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)]; for (let i = 0; i < 4; i++) edge.push([c[i], c[(i + 1) % 4]]); }
      else if (k === 'HOLE') {
        const c = P(num(a[1]), num(a[2])), d = r3(num(a[3]) * 2 * MM);
        const id = `fp:easyeda:Hole_${d}mm`;
        if (!fpDefs.has(id)) fpDefs.set(id, { id, name: `Hole_${d}mm`, body: { w: d + 1, h: d + 1 }, pads: [{ number: '1', x: 0, y: 0, w: d, h: d, shape: 'circle', drill: d, npth: true }], height: 0, description: '非金属化孔' });
        board.footprints.push({ id: newId('fp'), ref: `H${board.footprints.filter((f) => f.ref.startsWith('H')).length + 1}`, footprintId: id, value: `${d}mm`, x: c.x, y: c.y, rotation: 0, side: 'F', padNets: { '1': '' } });
      } else if (k === 'TEXT') {
        const layer = a[7]; if (layer !== '3' && layer !== '4') continue;
        const c = P(num(a[2]), num(a[3]));
        board.texts.push({ id: newId('x'), layer: layer === '3' ? 'F.Silk' : 'B.Silk', text: a[10] ?? '', x: c.x, y: c.y, size: r3(num(a[9]) * MM) || 1 } as BoardText);
      }
    } catch (e) { warnings.push({ where: k, message: (e as Error).message }); }
  }
  board.copperCount = inner ? 4 : 2;
  board.outline = _kicadInternal.chainOutline(edge);
  if (board.outline.length < 3) {
    const pts: Vec[] = [...board.footprints.map((f) => ({ x: f.x, y: f.y })), ...board.traces.flatMap((t) => t.points)];
    if (pts.length) { const minX = Math.min(...pts.map((p) => p.x)) - 5, minY = Math.min(...pts.map((p) => p.y)) - 5, maxX = Math.max(...pts.map((p) => p.x)) + 5, maxY = Math.max(...pts.map((p) => p.y)) + 5; board.outline = [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }]; }
    else board.outline = emptyBoard().outline;
    warnings.push({ where: 'BoardOutline', message: '未找到闭合板框，已按内容生成矩形板框' });
  }
  const footprints = [...fpDefs.values()];
  registerFootprints(footprints);
  return { board, footprints, warnings };
}

// ---------------- 库文档（docType 2 符号 / 4 封装） ----------------
export function importEasyEdaSymbolDoc(doc: EdaDoc): SymbolDef {
  const origin = { x: num(String(doc.head.x ?? 0)), y: num(String(doc.head.y ?? 0)) };
  const cp = doc.head.c_para ?? {};
  const b = buildSymbol(doc.shape, origin, cp.name || doc.title || 'Symbol', (cp.pre ?? 'U?').replace(/[?\d]+$/, ''));
  const def = { ...b.def, defaultFootprint: cp.package ? `fp:easyeda:${cp.package.replace(/[^\w.+-]+/g, '_')}` : '', description: cp.Manufacturer_Part ? `${cp.Manufacturer ?? ''} ${cp.Manufacturer_Part}`.trim() : '' };
  registerSymbols([def]);
  return def;
}
export function importEasyEdaFootprintDoc(doc: EdaDoc): FootprintDef {
  const origin = { x: num(String(doc.head.x ?? 0)), y: num(String(doc.head.y ?? 0)) };
  const cp = doc.head.c_para ?? {};
  const name = cp.package || doc.title || 'Footprint';
  const b = buildFootprint(doc.shape, origin, 0, name);
  const def = { ...b.def, id: `fp:easyeda:${name.replace(/[^\w.+-]+/g, '_')}` };
  registerFootprints([def]);
  return def;
}

// ---------------- 工程 ----------------
export interface EasyEdaImportInput { name?: string; files: { name: string; text: string }[] }
/** 多个 EasyEDA JSON（原理图 / PCB / 库文档，或含 schematics/pcbs 的工程导出）→ 项目。 */
export function importEasyEdaProject(input: EasyEdaImportInput): KicadImportResult {
  const warnings: ImportWarning[] = [];
  const project = createProject({ name: input.name ?? 'EasyEDA 导入' });
  const docs: (EdaDoc & { title?: string })[] = [];
  for (const f of input.files) {
    try { docs.push(...findEasyEdaDocs(JSON.parse(f.text), f.name.replace(/\.json$/i, ''))); }
    catch (e) { warnings.push({ where: f.name, message: `不是有效的 JSON：${(e as Error).message}` }); }
  }
  if (!docs.length) throw new Error('没有找到 EasyEDA 文档（请用「文件 → 导出 → EasyEDA 源码 / JSON」导出标准版文件；专业版 .eprj 暂不支持）');
  const symbols: SymbolDef[] = [], footprints: FootprintDef[] = [], sheets: Sheet[] = [];
  let pcbDoc: EdaDoc | undefined;
  for (const d of docs) {
    const t = docType(d);
    if (t === '1' || t === '5') { const r = importEasyEdaSchematic(d, { sheetName: d.titleFromFile ? undefined : d.title }); sheets.push(r.sheet); symbols.push(...r.symbols); warnings.push(...r.warnings); }
    else if (t === '3') { if (pcbDoc) warnings.push({ where: 'pcb', message: '多个 PCB 文档，只导入第一个' }); else pcbDoc = d; }
    else if (t === '2') symbols.push(importEasyEdaSymbolDoc(d));
    else if (t === '4') footprints.push(importEasyEdaFootprintDoc(d));
    else warnings.push({ where: `docType ${t}`, message: '暂不支持的文档类型，已跳过' });
  }
  if (sheets.length) project.schematic.sheets = sheets;
  const counters: Record<string, number> = {};
  for (const sh of project.schematic.sheets) for (const c of sh.components) { const m = /^([A-Za-z#]+)(\d+)$/.exec(c.ref); if (m) counters[m[1]] = Math.max(counters[m[1]] ?? 1, Number(m[2]) + 1); }
  project.schematic.counters = counters;
  if (pcbDoc) {
    const r = importEasyEdaPcb(pcbDoc);
    project.board = r.board; footprints.push(...r.footprints); warnings.push(...r.warnings);
    const byRef = new Map<string, SchComponent>();
    for (const sh of project.schematic.sheets) for (const c of sh.components) if (!getSymbol(c.symbolId).power) byRef.set(c.ref, c);
    for (const f of project.board.footprints) { const c = byRef.get(f.ref); if (c) { f.componentId = c.id; c.footprint = f.footprintId; } }
    if (sheets.length) {
      const nl = buildSchematicNetlist(project.schematic);
      for (const f of project.board.footprints) { if (!f.componentId) continue; for (const k of Object.keys(f.padNets)) if (!f.padNets[k]) { const n = nl.pinNet.get(`${f.componentId}:${k}`); if (n) f.padNets[k] = n; } }
    }
  }
  // 原理图元件引用的封装名 → 已导入的封装（按 package 名）
  for (const sh of project.schematic.sheets) for (const c of sh.components) {
    if (!c.footprint || footprints.some((d) => d.id === c.footprint)) continue;
    const pkg = c.props.easyedaPackage; const hit = pkg ? footprints.find((d) => d.name === pkg) : undefined;
    if (hit) c.footprint = hit.id;
  }
  project.library = { symbols, footprints };
  registerSymbols(symbols); registerFootprints(footprints);
  return { project, warnings };
}

/** 文本是否像 EasyEDA 标准版 JSON。 */
export function looksLikeEasyEda(text: string): boolean {
  const head = text.slice(0, 4000);
  return /"docType"\s*:\s*"?[1-8]"?/.test(head) || /"schematics"\s*:\s*\[/.test(head) || /"dataStr"\s*:/.test(head);
}
