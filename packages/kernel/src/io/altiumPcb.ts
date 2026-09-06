/**
 * Altium Designer .PcbDoc 导入（二进制，OLE 容器）。
 * 格式知识来自公开的社区解析实现（KiCad altium 插件、altium2kicad、python-altium）；代码为独立实现。
 * 单位：Altium 内部长度单位为 1/10000 mil，y 轴向上；这里统一换算成 mm、y 轴向下（与本工程一致）。
 */
import { CfbFile } from './cfb.js';
import { emptyBoard, type Board, type CopperLayer, type FootprintDef, type PadDef, type Trace, type Via, type Zone, type BoardText, type BoardFootprint, type Layer } from '../model/board.js';
import { newId } from '../ids.js';
import { rotate, type Vec } from '../geometry.js';
import type { ImportWarning } from './kicad.js';

const UNIT = 2.54e-6; // 1/10000 mil → mm

// ---------- 二进制读取 ----------
class Bin {
  pos = 0; end: number;
  private dv: DataView;
  constructor(private b: Uint8Array) { this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength); this.end = b.length; }
  get remaining() { return this.b.length - this.pos; }
  u8() { return this.dv.getUint8(this.pos++); }
  i8() { return this.dv.getInt8(this.pos++); }
  u16() { const v = this.dv.getUint16(this.pos, true); this.pos += 2; return v; }
  i16() { const v = this.dv.getInt16(this.pos, true); this.pos += 2; return v; }
  u32() { const v = this.dv.getUint32(this.pos, true); this.pos += 4; return v; }
  i32() { const v = this.dv.getInt32(this.pos, true); this.pos += 4; return v; }
  f64() { const v = this.dv.getFloat64(this.pos, true); this.pos += 8; return v; }
  skip(n: number) { this.pos += n; }
  /** 读子记录长度并记下它的结束位置 */
  sub(): number { const n = this.u32(); this.end = this.pos + n; return n; }
  endSub() { this.pos = this.end; }
  unit() { return this.i32() * UNIT; }
  pos2(): Vec { const x = this.i32() * UNIT, y = -this.i32() * UNIT; return { x, y }; }
  size2(): Vec { return { x: this.i32() * UNIT, y: this.i32() * UNIT }; }
  pascal(): string { const n = this.u8(); const s = latin1(this.b.subarray(this.pos, this.pos + n)); this.pos += n; return s; }
  bytes(n: number): Uint8Array { const s = this.b.subarray(this.pos, this.pos + n); this.pos += n; return s; }
}
const latin1 = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; };
const utf8 = (b: Uint8Array) => { try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return new TextDecoder('gb18030').decode(b); } };

/** 属性列表流（Board6 / Nets6 / Components6 / Polygons6 …）：每条 = u32 长度 + "|KEY=VALUE|…" */
export function readPropertyRecords(data: Uint8Array): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  const r = new Bin(data);
  while (r.remaining >= 4) {
    const len = r.u32() & 0x00ffffff; if (len === 0 || len > r.remaining) break;
    const raw = r.bytes(len);
    let text = utf8(raw); const nul = text.indexOf('\0'); if (nul >= 0) text = text.slice(0, nul);
    out.push(parseProps(text));
  }
  return out;
}
export function parseProps(text: string): Record<string, string> {
  const props: Record<string, string> = {};
  for (const part of text.split('|')) { const eq = part.indexOf('='); if (eq > 0) props[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1); }
  return props;
}
/** "1234.5mil" / "12.3mm" / "3500" → mm（无单位按 mil） */
export function lengthProp(v: string | undefined, fallback = 0): number {
  if (v === undefined || v === '') return fallback;
  const m = /^\s*(-?[\d.]+(?:e-?\d+)?)\s*(mil|mm|in|um)?/i.exec(v); if (!m) return fallback;
  const n = Number(m[1]); const u = (m[2] ?? 'mil').toLowerCase();
  return u === 'mm' ? n : u === 'in' ? n * 25.4 : u === 'um' ? n / 1000 : n * 0.0254;
}

// ---------- 层 ----------
const L = { TOP: 1, BOTTOM: 32, TOP_OVERLAY: 33, BOTTOM_OVERLAY: 34, KEEPOUT: 56, MECH1: 57, MULTI: 74 } as const;
const isCopperNum = (l: number) => (l >= 1 && l <= 32) || (l >= 39 && l <= 54);

export interface AltiumPcbResult { board: Board; footprints: FootprintDef[]; warnings: ImportWarning[]; stats: Record<string, number> }

export function importAltiumPcb(data: Uint8Array): AltiumPcbResult {
  const cfb = new CfbFile(data);
  const warnings: ImportWarning[] = [];
  const stream = (name: string) => cfb.read(`${name}/Data`) ?? cfb.read(name);
  const header = cfb.read('FileHeader');
  if (!header || !cfb.has('Board6/Data')) throw new Error('不是 Altium PCB 文件（缺少 Board6 流）');

  // ---- 网络 / 元件 / 板框 属性 ----
  const nets = readPropertyRecords(stream('Nets6') ?? new Uint8Array()).map((p) => p.NAME ?? '');
  const netName = (i: number) => (i === 0xffff || i < 0 || i >= nets.length ? '' : nets[i]);
  const comps = readPropertyRecords(stream('Components6') ?? new Uint8Array());
  const boardProps = readPropertyRecords(stream('Board6') ?? new Uint8Array())[0] ?? {};

  // 铜层：先看用了哪些层号，决定 2 / 4 层
  const usedCopper = new Set<number>();
  const layerMap = (l: number): CopperLayer | null => {
    if (l === L.TOP) return 'F.Cu'; if (l === L.BOTTOM) return 'B.Cu';
    if (l >= 2 && l <= 31) return l === 2 ? 'In1.Cu' : l === 3 ? 'In2.Cu' : null;
    if (l >= 39 && l <= 54) return l === 39 ? 'In1.Cu' : l === 40 ? 'In2.Cu' : null;
    return null;
  };
  const silkMap = (l: number): 'F.Silk' | 'B.Silk' | null => (l === L.TOP_OVERLAY ? 'F.Silk' : l === L.BOTTOM_OVERLAY ? 'B.Silk' : null);

  // ---- 二进制记录 ----
  interface RawPad { name: string; layer: number; net: number; component: number; pos: Vec; size: Vec; hole: number; shape: number; rotation: number; plated: boolean; mode: number; botSize?: Vec }
  interface RawTrack { layer: number; net: number; component: number; a: Vec; b: Vec; width: number; keepout: boolean }
  interface RawArc { layer: number; net: number; component: number; c: Vec; r: number; sa: number; ea: number; width: number; keepout: boolean }
  interface RawVia { net: number; pos: Vec; size: number; hole: number }
  interface RawText { layer: number; component: number; pos: Vec; height: number; rotation: number; mirrored: boolean; text: string; designator: boolean; comment: boolean }
  interface RawFill { layer: number; net: number; component: number; a: Vec; b: Vec; rotation: number; keepout: boolean }
  const pads: RawPad[] = [], tracks: RawTrack[] = [], arcs: RawArc[] = [], vias: RawVia[] = [], texts: RawText[] = [], fills: RawFill[] = [];
  const stats: Record<string, number> = {};
  const bump = (k: string) => { stats[k] = (stats[k] ?? 0) + 1; };

  const each = (name: string, expectType: number, fn: (r: Bin) => void) => {
    const d = stream(name); if (!d) return;
    const r = new Bin(d);
    let guard = 0;
    while (r.remaining >= 5 && guard++ < 5e6) {
      const type = r.u8();
      if (type !== expectType) { warnings.push({ where: name, message: `记录类型 ${type} 与预期 ${expectType} 不符，已停止解析该流` }); break; }
      const start = r.pos;
      try { fn(r); } catch (e) { warnings.push({ where: name, message: `记录解析失败：${(e as Error).message}` }); break; }
      if (r.pos <= start) break;
    }
  };

  each('Tracks6', 4, (r) => {
    const n = r.sub(); void n;
    const layer = r.u8(); const flags1 = r.u8(); void flags1; const flags2 = r.u8();
    const net = r.u16(); r.u16(); const component = r.u16(); r.skip(4);
    const a = r.pos2(), b = r.pos2(); const width = r.unit();
    r.endSub();
    tracks.push({ layer, net, component, a, b, width, keepout: flags2 === 2 }); bump('tracks');
    if (isCopperNum(layer)) usedCopper.add(layer);
  });
  each('Arcs6', 1, (r) => {
    r.sub();
    const layer = r.u8(); r.u8(); const flags2 = r.u8();
    const net = r.u16(); r.u16(); const component = r.u16(); r.skip(4);
    const c = r.pos2(); const rad = r.unit(); const sa = r.f64(), ea = r.f64(); const width = r.unit();
    r.endSub();
    arcs.push({ layer, net, component, c, r: rad, sa, ea, width, keepout: flags2 === 2 }); bump('arcs');
    if (isCopperNum(layer)) usedCopper.add(layer);
  });
  each('Vias6', 3, (r) => {
    r.sub();
    r.u8(); r.u8(); r.u8();
    const net = r.u16(); r.skip(8);
    const pos = r.pos2(); const size = r.unit(); const hole = r.unit();
    r.endSub();
    vias.push({ net, pos, size, hole }); bump('vias');
  });
  each('Pads6', 2, (r) => {
    r.sub(); const name = r.pascal(); r.endSub();
    r.sub(); r.endSub(); r.sub(); r.endSub(); r.sub(); r.endSub();
    const n5 = r.sub();
    const layer = r.u8(); r.u8(); r.u8();
    const net = r.u16(); r.skip(2); const component = r.u16(); r.skip(4);
    const pos = r.pos2(); const top = r.size2(); r.size2(); const bot = r.size2(); const hole = r.unit();
    const topShape = r.u8(); r.u8(); r.u8();
    const rotation = r.f64(); const plated = r.u8() !== 0; r.skip(1); const mode = r.u8();
    void n5; r.endSub();
    // 子记录 6（每层尺寸 / 槽孔）：存在则跳过
    if (r.remaining >= 4) { const save = r.pos; const n6 = r.u32(); if (n6 > 0 && n6 <= r.remaining) r.skip(n6); else r.pos = save + 4; }
    pads.push({ name, layer, net, component, pos, size: top, botSize: bot, hole, shape: topShape, rotation, plated, mode }); bump('pads');
    if (isCopperNum(layer)) usedCopper.add(layer);
  });
  each('Texts6', 5, (r) => {
    const n1 = r.sub();
    const layer = r.u8(); r.skip(6); const component = r.u16(); r.skip(4);
    const pos = r.pos2(); const height = r.unit(); r.skip(2); const rotation = r.f64(); const mirrored = r.u8() !== 0; r.unit();
    let designator = false, comment = false;
    if (n1 >= 123) { comment = r.u8() !== 0; designator = r.u8() !== 0; }
    r.endSub();
    r.sub(); const text = r.pascal(); r.endSub();
    texts.push({ layer, component, pos, height, rotation, mirrored, text, designator, comment }); bump('texts');
  });
  each('Fills6', 6, (r) => {
    r.sub();
    const layer = r.u8(); r.u8(); const flags2 = r.u8();
    const net = r.u16(); r.skip(2); const component = r.u16(); r.skip(4);
    const a = r.pos2(), b = r.pos2(); const rotation = r.f64();
    r.endSub();
    fills.push({ layer, net, component, a, b, rotation, keepout: flags2 === 2 }); bump('fills');
  });
  interface RawRegion { layer: number; net: number; component: number; subpoly: number; keepout: boolean; props: Record<string, string>; outline: Vec[] }
  const regions: RawRegion[] = [];
  each('Regions6', 11, (r) => {
    const n1 = r.sub();
    const layer = r.u8(); r.u8(); const flags2 = r.u8();
    const net = r.u16(); const subpoly = r.u16(); const component = r.u16(); r.skip(5); r.u16(); r.skip(2);
    const plen = r.u32(); const props = plen > 0 && plen < n1 ? parseProps(latin1(r.bytes(plen)).replace(/\0.*$/, '')) : {};
    const count = r.u32();
    const outline: Vec[] = [];
    if (count > 0 && count < 200000 && count * 16 <= r.end - r.pos) for (let i = 0; i < count; i++) { const x = r.f64() * UNIT, y = -r.f64() * UNIT; if (Math.abs(x) < 1e4 && Math.abs(y) < 1e4) outline.push({ x, y }); }
    r.endSub();
    regions.push({ layer, net, component, subpoly, keepout: flags2 === 2, props, outline }); bump('regions');
  });
  // 形状区域（ShapeBasedRegions6）：内电层分割区 / 自由铜形状也会存在这里，记录格式与 Regions6 相同
  each('ShapeBasedRegions6', 11, (r) => {
    const n1 = r.sub();
    const layer = r.u8(); r.u8(); const flags2 = r.u8();
    const net = r.u16(); const subpoly = r.u16(); const component = r.u16(); r.skip(5); r.u16(); r.skip(2);
    const plen = r.u32(); const props = plen > 0 && plen < n1 ? parseProps(latin1(r.bytes(plen)).replace(/\0.*$/, '')) : {};
    const count = r.u32();
    const outline: Vec[] = [];
    if (count > 0 && count < 200000 && count * 16 <= r.end - r.pos) for (let i = 0; i < count; i++) { const x = r.f64() * UNIT, y = -r.f64() * UNIT; if (Math.abs(x) < 1e4 && Math.abs(y) < 1e4) outline.push({ x, y }); }
    r.endSub();
    regions.push({ layer, net, component, subpoly, keepout: flags2 === 2, props, outline }); bump('shapeRegions');
  });
  const polygons = readPropertyRecords(stream('Polygons6') ?? new Uint8Array());

  // ---- 板框 ----
  const board: Board = { ...emptyBoard(), outline: [], footprints: [], traces: [], vias: [], zones: [], texts: [] };
  const outline: Vec[] = [];
  for (let i = 0; ; i++) {
    const vx = boardProps[`VX${i}`]; if (vx === undefined) break;
    const p = { x: lengthProp(vx), y: -lengthProp(boardProps[`VY${i}`]) };
    const kind = Number(boardProps[`KIND${i}`] ?? 0);
    outline.push(p);
    if (kind === 1 && boardProps[`CX${i}`] !== undefined && boardProps[`VX${i + 1}`] !== undefined) {
      // 圆弧段：本顶点 → 下一顶点沿圆弧走；SA/EA 只给出角度跨度，方向按两端点实际角度判断
      const c = { x: lengthProp(boardProps[`CX${i}`]), y: -lengthProp(boardProps[`CY${i}`]) };
      const rad = lengthProp(boardProps[`R${i}`]);
      const q = { x: lengthProp(boardProps[`VX${i + 1}`]), y: -lengthProp(boardProps[`VY${i + 1}`]) };
      const ang = (v: Vec) => Math.atan2(-(v.y - c.y), v.x - c.x); // y 向上的角度
      const a0 = ang(p), a1 = ang(q);
      const span = (((Number(boardProps[`EA${i}`] ?? 0) - Number(boardProps[`SA${i}`] ?? 0)) % 360) + 360) % 360 || 360;
      let ccw = a1 - a0; while (ccw <= 0) ccw += Math.PI * 2; // 逆时针跨度
      const cw = Math.PI * 2 - ccw;
      const useCcw = Math.abs(ccw - (span * Math.PI) / 180) <= Math.abs(cw - (span * Math.PI) / 180);
      const sweep = useCcw ? ccw : -cw;
      const n = Math.max(3, Math.ceil(Math.abs(sweep) / (Math.PI / 18)));
      for (let k = 1; k < n; k++) { const a = a0 + (sweep * k) / n; outline.push({ x: c.x + rad * Math.cos(a), y: c.y - rad * Math.sin(a) }); }
    }
  }
  while (outline.length > 1 && Math.hypot(outline[0].x - outline[outline.length - 1].x, outline[0].y - outline[outline.length - 1].y) < 1e-6) outline.pop();
  const usedTop = new Set([...usedCopper]);
  // 4 层判断：出现内层 / 内电层
  const inner = [...usedTop].filter((l) => (l >= 2 && l <= 31) || (l >= 39 && l <= 54));
  board.copperCount = inner.length ? 4 : 2;
  const cuLayers: CopperLayer[] = board.copperCount === 4 ? ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu'] : ['F.Cu', 'B.Cu'];
  if (inner.length > 2) warnings.push({ where: 'layers', message: `板子有 ${inner.length} 个内层，仅前两个内层被导入（本工程最多 4 层）` });

  // ---- 元件与封装：把属于同一元件的焊盘按元件原点 / 旋转 / 面还原成封装局部坐标 ----
  const compFp = new Map<number, { fp: BoardFootprint; def: FootprintDef }>();
  const defs = new Map<string, FootprintDef>();
  const shapeOf = (s: number, w: number, h: number): PadDef['shape'] => (s === 1 ? (Math.abs(w - h) < 1e-6 ? 'circle' : 'oval') : s === 3 || s === 9 ? 'roundrect' : 'rect');
  comps.forEach((c, idx) => {
    const x = lengthProp(c.X), y = -lengthProp(c.Y);
    const rotA = Number(c.ROTATION ?? 0);
    const side: 'F' | 'B' = /BOTTOM/i.test(c.LAYER ?? '') ? 'B' : 'F';
    const rotation = ((-rotA % 360) + 360) % 360;
    const pattern = c.PATTERN || `Component${idx}`;
    const myPads = pads.filter((p) => p.component === idx);
    const toLocal = (w: Vec): Vec => { const d = rotate({ x: w.x - x, y: w.y - y }, -rotation); return side === 'B' ? { x: -d.x, y: d.y } : d; };
    const padDefs: PadDef[] = myPads.map((p) => {
      const l = toLocal(p.pos);
      const through = p.hole > 0 && p.layer === L.MULTI;
      // 焊盘旋转相对于板：减去元件旋转后判断是否交换宽高（只支持 90° 倍数）
      let rel = ((p.rotation - rotA) % 360 + 360) % 360; if (side === 'B') rel = (360 - rel) % 360;
      const swap = Math.abs(((rel % 180) + 180) % 180 - 90) < 1;
      const w = swap ? p.size.y : p.size.x, h = swap ? p.size.x : p.size.y;
      return { number: p.name || String(myPads.indexOf(p) + 1), x: r3(l.x), y: r3(l.y), w: r3(w), h: r3(h), shape: shapeOf(p.shape, w, h), drill: through || p.hole > 0 ? r3(p.hole) : 0, npth: p.hole > 0 && !p.plated };
    });
    // 本体：元件自己的丝印线 / 圆弧包围盒，没有就用焊盘包围盒
    const own = [...tracks.filter((t) => t.component === idx && (t.layer === L.TOP_OVERLAY || t.layer === L.BOTTOM_OVERLAY || t.layer >= L.MECH1)), ...arcs.filter((a) => a.component === idx && (a.layer === L.TOP_OVERLAY || a.layer === L.BOTTOM_OVERLAY || a.layer >= L.MECH1))];
    const pts: Vec[] = [];
    for (const t of tracks.filter((t) => own.includes(t))) pts.push(toLocal(t.a), toLocal(t.b));
    for (const a of arcs.filter((a) => own.includes(a))) { const c = toLocal(a.c); pts.push({ x: c.x - a.r, y: c.y - a.r }, { x: c.x + a.r, y: c.y + a.r }); }
    for (const p of padDefs) pts.push({ x: p.x - p.w / 2, y: p.y - p.h / 2 }, { x: p.x + p.w / 2, y: p.y + p.h / 2 }); // 本体至少包住焊盘
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const body = pts.length ? { w: r3(Math.max(...xs) - Math.min(...xs) || 1), h: r3(Math.max(...ys) - Math.min(...ys) || 1), x: r3((Math.max(...xs) + Math.min(...xs)) / 2), y: r3((Math.max(...ys) + Math.min(...ys)) / 2) } : { w: 2, h: 2 };
    // 同名封装：几何相同则复用，否则加序号
    const sig = JSON.stringify({ pads: padDefs, body });
    let key = `fp:altium:${pattern}`; let n = 2;
    while (defs.has(key) && JSON.stringify({ pads: defs.get(key)!.pads, body: defs.get(key)!.body }) !== sig) key = `fp:altium:${pattern}#${n++}`;
    if (!defs.has(key)) defs.set(key, { id: key, name: pattern + (n > 2 ? `#${n - 1}` : ''), body, pads: padDefs, height: padDefs.some((p) => p.drill > 0 && !p.npth) ? 4 : 1, description: `Altium ${c.SOURCEFOOTPRINTLIBRARY ?? ''}`.trim() });
    const padNets: Record<string, string> = {};
    myPads.forEach((p, i) => { const nn = netName(p.net); if (nn) padNets[padDefs[i].number] = nn; });
    const fp: BoardFootprint = { id: newId('fp'), ref: c.SOURCEDESIGNATOR || c.DESIGNATOR || `U${idx + 1}`, footprintId: key, value: c.COMMENT ?? c.SOURCECOMPONENTLIBRARY ?? '', x: r3(x), y: r3(y), rotation, side, padNets, locked: c.LOCKED === 'TRUE' };
    compFp.set(idx, { fp, def: defs.get(key)! });
    board.footprints.push(fp);
  });
  // 元件注释 / 位号文字：取 Comment 作为 value（Texts6 里 .Comment 的实际文本在元件属性 COMMENT 中）

  // ---- 自由焊盘（不属于元件）：做成单焊盘封装，保留网络 ----
  // 无网络、无孔的自由焊盘多是用焊盘拼出来的 Logo / 图案，不导入
  const freePads = pads.filter((p) => p.component === 0xffff && (p.hole > 0 || netName(p.net)));
  for (const p of freePads) {
    const through = p.hole > 0;
    const key = `fp:altium:Pad_${r3(p.size.x)}x${r3(p.size.y)}${through ? `_D${r3(p.hole)}` : ''}`;
    if (!defs.has(key)) defs.set(key, { id: key, name: key.slice(10), body: { w: r3(p.size.x), h: r3(p.size.y) }, pads: [{ number: '1', x: 0, y: 0, w: r3(p.size.x), h: r3(p.size.y), shape: shapeOf(p.shape, p.size.x, p.size.y), drill: through ? r3(p.hole) : 0, npth: through && !p.plated }], height: 0.1, description: 'Altium 自由焊盘' });
    const nn = netName(p.net);
    board.footprints.push({ id: newId('fp'), ref: `PAD${board.footprints.length + 1}`, footprintId: key, value: '', x: r3(p.pos.x), y: r3(p.pos.y), rotation: ((-p.rotation % 360) + 360) % 360, side: p.layer === L.BOTTOM ? 'B' : 'F', padNets: nn ? { '1': nn } : {} });
  }

  // ---- 走线 / 圆弧 / 过孔 ----
  const isPlane = (l: number) => l >= 39 && l <= 54; // 内电层是负片：上面的线是分割线，不是铜
  for (const t of tracks) {
    if (isPlane(t.layer)) continue;
    if (t.component !== 0xffff && !isCopperNum(t.layer)) continue; // 元件丝印线已并入本体
    const layer = layerMap(t.layer);
    if (layer) { if (!cuLayers.includes(layer) || Math.hypot(t.a.x - t.b.x, t.a.y - t.b.y) < 1e-6 || !(t.width > 0)) continue; board.traces.push({ id: newId('t'), layer, net: netName(t.net), width: r3(t.width), points: [rv(t.a), rv(t.b)] } as Trace); continue; }
    if (t.layer === L.KEEPOUT && !outline.length) bump('keepoutTracks');
  }
  for (const a of arcs) {
    if (isPlane(a.layer)) continue;
    if (a.component !== 0xffff && !isCopperNum(a.layer)) continue;
    const layer = layerMap(a.layer); if (!layer || !cuLayers.includes(layer)) continue;
    board.traces.push({ id: newId('t'), layer, net: netName(a.net), width: r3(a.width), points: arcPts(a.c, a.r, a.sa, a.ea) } as Trace);
  }
  for (const v of vias) board.vias.push({ id: newId('v'), x: r3(v.pos.x), y: r3(v.pos.y), size: r3(v.size), drill: r3(v.hole), net: netName(v.net) } as Via);

  // ---- 铺铜：Polygons6 轮廓 + 铜层矩形填充 ----
  for (const p of polygons) {
    const lnum = layerNumFromName(p.LAYER); const layer = lnum !== null ? layerMap(lnum) : null;
    if (!layer || !cuLayers.includes(layer)) continue;
    const pts: Vec[] = [];
    for (let i = 0; p[`VX${i}`] !== undefined; i++) pts.push({ x: lengthProp(p[`VX${i}`]), y: -lengthProp(p[`VY${i}`]) });
    const zn = /^\d+$/.test(p.NET ?? '') ? netName(Number(p.NET)) : (p.NET ?? ''); // Polygons6 的 NET 是网络序号
    const ring = cleanRing(pts.map(rv));
    if (ring.length >= 3) board.zones.push({ id: newId('z'), layer, net: zn, polygon: ring, thermal: 'relief', thermalGap: 0.3, spokeWidth: 0.4, clearance: 0 } as Zone);
  }
  for (const f of fills) {
    if (f.keepout) continue;
    const layer = layerMap(f.layer); if (!layer || !cuLayers.includes(layer)) continue;
    const c = { x: (f.a.x + f.b.x) / 2, y: (f.a.y + f.b.y) / 2 };
    const hw = Math.abs(f.b.x - f.a.x) / 2, hh = Math.abs(f.b.y - f.a.y) / 2;
    const corners = [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }].map((q) => { const rr = rotate(q, -f.rotation); return rv({ x: c.x + rr.x, y: c.y + rr.y }); });
    board.zones.push({ id: newId('z'), layer, net: netName(f.net), polygon: corners, thermal: 'solid', thermalGap: 0.3, spokeWidth: 0.4, clearance: 0 } as Zone);
  }

  // ---- 区域（Region）：内电层分割区 / 自由铜形状 → 铺铜；铺铜的填充碎片（属于 Polygon）跳过 ----
  const seenRegion = new Set<string>();
  for (const rg of regions) {
    if (rg.keepout || rg.subpoly !== 0xffff || rg.component !== 0xffff || rg.outline.length < 3) continue;
    const sig = `${rg.layer}|${rg.net}|${rg.outline.length}|${rg.outline[0].x.toFixed(3)},${rg.outline[0].y.toFixed(3)}`; if (seenRegion.has(sig)) continue; seenRegion.add(sig); // Regions6 与 ShapeBasedRegions6 常重复
    if ((rg.props.ISBOARDCUTOUT ?? '').toUpperCase() === 'TRUE' || Number(rg.props.KIND ?? 0) !== 0) continue;
    const layer = layerMap(rg.layer); if (!layer || !cuLayers.includes(layer)) continue;
    const nn = netName(rg.net); if (!nn && rg.layer >= 39) continue;
    const ring = cleanRing(rg.outline.map(rv)); if (ring.length < 3) continue;
    board.zones.push({ id: newId('z'), layer, net: nn, polygon: ring, thermal: 'relief', thermalGap: 0.3, spokeWidth: 0.4, clearance: 0 } as Zone);
  }
  // ---- 内电层（负片整层 = 一个网络）：整板铺铜 ----
  for (let i = 1; i <= 16; i++) {
    const nn = (boardProps[`PLANE${i}NETNAME`] ?? '').trim();
    if (!nn || /^\(/.test(nn)) continue; // (No Net) / (Multiple Nets)
    const layer = layerMap(38 + i); if (!layer || !cuLayers.includes(layer) || !outline.length) continue;
    board.zones.push({ id: newId('z'), layer, net: nn, polygon: cleanRing(outline.map(rv)), thermal: 'relief', thermalGap: 0.3, spokeWidth: 0.4, clearance: 0 } as Zone);
  }

  // ---- 自由文字（丝印）；元件的位号 / 注释文字由本工程自动绘制 ----
  for (const t of texts) {
    if (t.component !== 0xffff || t.designator || t.comment || /^'?\./.test(t.text)) continue; // .Designator / '.Layer_Name' 这类特殊字符串
    const layer = silkMap(t.layer); if (!layer) continue;
    const size = Math.max(0.5, r3(t.height));
    const w = t.text.length * size * 0.65;
    const ang = (t.rotation * Math.PI) / 180;
    board.texts.push({ id: newId('x'), layer, text: t.text, x: r3(t.pos.x + (Math.cos(ang) * w) / 2), y: r3(t.pos.y - (Math.sin(ang) * w) / 2), size } as BoardText);
  }

  // ---- 板框兜底：Keep-out 层的线段 / 圆弧闭合成多边形，再不行用全部内容的包围盒 ----
  if (outline.length >= 3) board.outline = outline.map(rv);
  else {
    const segs = tracks.filter((t) => t.layer === L.KEEPOUT || t.layer === L.MECH1).map((t) => [t.a, t.b] as [Vec, Vec]);
    const chained = chain(segs);
    if (chained.length >= 3) board.outline = chained.map(rv);
    else {
      const all = [...board.footprints.map((f) => ({ x: f.x, y: f.y })), ...board.traces.flatMap((t) => t.points), ...board.vias];
      if (all.length) { const xs = all.map((p) => p.x), ys = all.map((p) => p.y); const m = 3; board.outline = [{ x: Math.min(...xs) - m, y: Math.min(...ys) - m }, { x: Math.max(...xs) + m, y: Math.min(...ys) - m }, { x: Math.max(...xs) + m, y: Math.max(...ys) + m }, { x: Math.min(...xs) - m, y: Math.max(...ys) + m }].map(rv); }
      else board.outline = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 30 }, { x: 0, y: 30 }];
      warnings.push({ where: 'board', message: '没有找到板框（Board Shape / Keep-Out），已用内容包围盒代替' });
    }
  }
  board.thickness = 1.6;
  // 网络类默认值取自板上最常见的线宽 / 过孔，避免导入后满屏"低于网络类宽度"警告
  const mode = (vals: number[], fb: number) => { const m = new Map<number, number>(); for (const v of vals) m.set(v, (m.get(v) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fb; };
  const tw = mode(board.traces.map((t) => t.width), 0.25), vs = mode(board.vias.map((v) => v.size), 0.6), vd = mode(board.vias.filter((v) => v.size === vs).map((v) => v.drill), 0.3);
  board.netClasses = board.netClasses.map((nc) => nc.name === 'Default' ? { ...nc, traceWidth: tw, viaSize: vs, viaDrill: vd } : nc.name === 'Power' ? { ...nc, traceWidth: Math.max(tw, mode(board.traces.filter((t) => /GND|VCC|VDD|\dV/i.test(t.net)).map((t) => t.width), tw)), viaSize: Math.max(vs, nc.viaSize > vs ? vs : nc.viaSize), viaDrill: vd, nets: nc.nets.filter((n) => nets.includes(n)) } : nc);
  // 归零：把板框左上角移到 (0,0)
  const xs = board.outline.map((p) => p.x), ys = board.outline.map((p) => p.y);
  const dx = -Math.min(...xs), dy = -Math.min(...ys);
  if (dx || dy) {
    const sh = (p: Vec) => ({ x: r3(p.x + dx), y: r3(p.y + dy) });
    board.outline = board.outline.map(sh);
    for (const f of board.footprints) { f.x = r3(f.x + dx); f.y = r3(f.y + dy); }
    for (const t of board.traces) t.points = t.points.map(sh);
    for (const v of board.vias) { v.x = r3(v.x + dx); v.y = r3(v.y + dy); }
    for (const z of board.zones) z.polygon = z.polygon.map(sh);
    for (const t of board.texts) { t.x = r3(t.x + dx); t.y = r3(t.y + dy); }
  }
  stats.components = comps.length; stats.nets = nets.length; stats.polygons = polygons.length;
  return { board, footprints: [...defs.values()], warnings, stats };
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** 去掉相邻重复点与首尾重复点 */
function cleanRing(pts: Vec[]): Vec[] {
  const out: Vec[] = [];
  for (const p of pts) if (!out.length || Math.hypot(p.x - out[out.length - 1].x, p.y - out[out.length - 1].y) > 1e-6) out.push(p);
  while (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= 1e-6) out.pop();
  return out;
}
const rv = (p: Vec): Vec => ({ x: r3(p.x), y: r3(p.y) });
function arcPts(c: Vec, r: number, sa: number, ea: number): Vec[] {
  let a0 = sa, a1 = ea; if (a1 <= a0) a1 += 360;
  const n = Math.max(2, Math.ceil((a1 - a0) / 15));
  const out: Vec[] = [];
  for (let k = 0; k <= n; k++) { const a = ((a0 + ((a1 - a0) * k) / n) * Math.PI) / 180; out.push(rv({ x: c.x + r * Math.cos(a), y: c.y - r * Math.sin(a) })); }
  return out;
}
function layerNumFromName(name: string | undefined): number | null {
  if (!name) return null;
  const n = name.toUpperCase();
  if (n === 'TOP') return 1; if (n === 'BOTTOM') return 32;
  const mid = /^MID(?:LAYER)?(\d+)$/.exec(n); if (mid) return 1 + Number(mid[1]);
  const plane = /^(?:INTERNAL)?PLANE(\d+)$/.exec(n); if (plane) return 38 + Number(plane[1]);
  if (n === 'TOPOVERLAY') return 33; if (n === 'BOTTOMOVERLAY') return 34;
  if (n === 'KEEPOUT' || n === 'KEEPOUTLAYER') return 56;
  if (/^\d+$/.test(n)) return Number(n);
  return null;
}
/** 把线段串成闭合多边形（首尾相接，容差 0.01mm） */
function chain(segs: [Vec, Vec][]): Vec[] {
  if (!segs.length) return [];
  const rest = segs.slice(); const out: Vec[] = [rest[0][0], rest[0][1]]; rest.shift();
  const near = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y) < 0.02;
  let guard = 0;
  while (rest.length && guard++ < 10000) {
    const last = out[out.length - 1];
    const i = rest.findIndex(([a, b]) => near(a, last) || near(b, last));
    if (i < 0) break;
    const [a, b] = rest.splice(i, 1)[0];
    out.push(near(a, last) ? b : a);
  }
  if (out.length > 3 && near(out[0], out[out.length - 1])) out.pop();
  return out.length >= 3 ? out : [];
}
export type { Layer as _AltiumLayer };
