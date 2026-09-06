/**
 * Altium Designer .SchDoc 导入（OLE 容器里的 FileHeader / Additional 流，属性列表记录 + 二进制引脚记录）。
 * 坐标：Altium 原理图单位 1/100 in（10 mil），y 轴向上；转换成本工程的 mil、y 向下。
 * 元件子图元（引脚 / 线 / 矩形 …）在文件里已是图纸绝对坐标，这里按元件位置 / 旋转 / 镜像还原成符号局部坐标。
 */
import { CfbFile } from './cfb.js';
import { newId } from '../ids.js';
import { rotate, type Vec } from '../geometry.js';
import { DEFAULT_FRAME, type Sheet, type SymbolDef, type SymbolShape, type PinDef, type PinType, type PinSide, type SchComponent, type Wire, type NetLabel, type Junction, type Bus, type Graphic } from '../model/schematic.js';
import { BUILTIN_SYMBOLS } from '../library/symbols.js';
import { pinGeoms } from '../schematic/geometry.js';
import type { ImportWarning } from './kicad.js';
import { parseProps } from './altiumPcb.js';

export interface AltiumSchResult { sheet: Sheet; symbols: SymbolDef[]; warnings: ImportWarning[]; stats: Record<string, number> }

type Rec = Record<string, string>; // _index：记录在流中的序号（字符串），OWNERINDEX 引用它
const REC = { COMPONENT: 1, PIN: 2, LABEL: 4, BEZIER: 5, POLYLINE: 6, POLYGON: 7, ELLIPSE: 8, ROUNDRECT: 10, ELLIPTICAL_ARC: 11, ARC: 12, LINE: 13, RECT: 14, SHEET_SYMBOL: 15, SHEET_ENTRY: 16, POWER_PORT: 17, PORT: 18, NO_ERC: 22, NET_LABEL: 25, BUS: 26, WIRE: 27, TEXT_FRAME: 28, JUNCTION: 29, IMAGE: 30, SHEET: 31, SHEET_NAME: 32, FILE_NAME: 33, DESIGNATOR: 34, BUS_ENTRY: 37, TEMPLATE: 39, PARAMETER: 41, IMPL_LIST: 44, IMPL: 45 } as const;
// 图纸尺寸（10 mil 单位）：SHEETSTYLE 0..17
const SHEET_SIZES: [number, number][] = [[1150, 760], [1550, 1110], [2230, 1570], [3150, 2230], [4460, 3150], [950, 750], [1500, 950], [2000, 1500], [3200, 2000], [4200, 3200], [1100, 760], [1400, 760], [1700, 1100], [990, 790], [1540, 990], [2060, 1560], [3260, 2060], [4280, 3280]];
const ELECTRICAL: Record<string, PinType> = { '0': 'input', '1': 'bidirectional', '2': 'output', '3': 'open_collector', '4': 'passive', '5': 'tri_state' as PinType, '6': 'open_collector', '7': 'power_in' };

const latin1 = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; };
const decode = (b: Uint8Array) => { try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return new TextDecoder('gb18030').decode(b); } };

/** 读 FileHeader / Additional 流里的记录：u32 头（低 24 位长度，高 8 位非 0 表示二进制记录） */
function readRecords(data: Uint8Array, startIndex: number, warnings: ImportWarning[]): Rec[] {
  const out: Rec[] = [];
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 0, index = startIndex;
  while (pos + 4 <= data.length) {
    const head = dv.getUint32(pos, true); pos += 4;
    const len = head & 0x00ffffff, binary = (head >>> 24) !== 0;
    if (len === 0 || pos + len > data.length) break;
    const raw = data.subarray(pos, pos + len); pos += len;
    if (binary) { const r = parseBinaryPin(raw, warnings); if (r) out.push({ ...r, _index: String(index) }); index++; continue; }
    let text = decode(raw); const nul = text.indexOf('\0'); if (nul >= 0) text = text.slice(0, nul);
    const props = parseProps(text);
    if (props.HEADER !== undefined && out.length === 0 && index === startIndex) continue; // 文件头不占索引
    out.push({ ...props, _index: String(index) }); index++;
  }
  return out;
}
/** 二进制引脚记录（新版 Altium 把引脚存成二进制） */
function parseBinaryPin(b: Uint8Array, warnings: ImportWarning[]): Record<string, string> | null {
  try {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); let p = 0;
    const i8 = () => dv.getInt8(p++), i16 = () => { const v = dv.getInt16(p, true); p += 2; return v; }, i32 = () => { const v = dv.getInt32(p, true); p += 4; return v; };
    const pas = () => { const n = dv.getUint8(p++); const s = latin1(b.subarray(p, p + n)); p += n; return s; };
    const recordId = i32(); if (recordId !== REC.PIN) return null;
    p += 1; const ownerPart = i16(); p += 1;
    i8(); i8(); i8(); i8(); // symbol inner/outer edge, inner, outer
    const description = pas(); p += 1;
    const electrical = i8(); const conglomerate = dv.getUint8(p++); const length = i16(); const x = i16(), y = i16(); i32();
    const name = pas(), designator = pas();
    return { RECORD: '2', OWNERPARTID: String(ownerPart), DESCRIPTION: description, ELECTRICAL: String(electrical), PINCONGLOMERATE: String(conglomerate), PINLENGTH: String(length), 'LOCATION.X': String(x), 'LOCATION.Y': String(y), NAME: name, DESIGNATOR: designator, _BINARY: '1' };
  } catch (e) { warnings.push({ where: 'pin', message: `二进制引脚解析失败：${(e as Error).message}` }); return null; }
}

const num = (v: string | undefined, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
/** 10 mil 单位 + _FRAC（1/100000 in）→ mil */
const milOf = (r: Record<string, string>, key: string) => num(r[key]) * 10 + num(r[`${key}_FRAC`]) / 10000;
const snap100 = (v: number) => Math.round(v / 100) * 100;

export function importAltiumSch(data: Uint8Array, opts: { sheetName?: string; sheetId?: string } = {}): AltiumSchResult {
  const cfb = new CfbFile(data);
  const warnings: ImportWarning[] = [];
  const fh = cfb.read('FileHeader'); if (!fh) throw new Error('不是 Altium 原理图文件（缺少 FileHeader 流）');
  const header = decode(fh.subarray(4, Math.min(fh.length, 200)));
  if (!/Schematic/i.test(header)) throw new Error('不是 Altium 原理图文件（FileHeader 不是 Schematic Capture 格式）');
  const records = readRecords(fh, 0, warnings);
  const add = cfb.read('Additional'); if (add && add.length > 4) records.push(...readRecords(add, records.length, warnings));
  const stats: Record<string, number> = {};
  for (const r of records) stats[`rec${r.RECORD}`] = (stats[`rec${r.RECORD}`] ?? 0) + 1;

  // 图纸尺寸 → y 翻转基准
  const sheetRec = records.find((r) => r.RECORD === String(REC.SHEET));
  let sheetH = 7600, sheetW = 11500;
  if (sheetRec) {
    const style = num(sheetRec.SHEETSTYLE, 0);
    const sz = SHEET_SIZES[style] ?? SHEET_SIZES[0];
    sheetW = sz[0] * 10; sheetH = sz[1] * 10;
    if (sheetRec.USECUSTOMSHEET === 'T') { sheetW = num(sheetRec.CUSTOMX, sz[0]) * 10; sheetH = num(sheetRec.CUSTOMY, sz[1]) * 10; }
  }
  const P = (r: Record<string, string>, kx = 'LOCATION.X', ky = 'LOCATION.Y'): Vec => ({ x: milOf(r, kx), y: sheetH - milOf(r, ky) });
  const Pn = (r: Record<string, string>, i: number): Vec => ({ x: milOf(r, `X${i}`), y: sheetH - milOf(r, `Y${i}`) });

  const byIndex = new Map<number, Rec>(); for (const r of records) byIndex.set(num(r._index), r);
  const children = new Map<number, Rec[]>();
  for (const r of records) { const o = num(r.OWNERINDEX, -1); if (o >= 0) { if (!children.has(o)) children.set(o, []); children.get(o)!.push(r); } }

  const symbols: SymbolDef[] = []; const defByKey = new Map<string, SymbolDef & { anchor?: Vec }>();
  const components: SchComponent[] = [];
  const wires: Wire[] = [], labels: NetLabel[] = [], junctions: Junction[] = [], buses: Bus[] = [], graphics: Graphic[] = [];
  const gnd = BUILTIN_SYMBOLS.find((s) => s.id === 'sym:GND')!, pwr = BUILTIN_SYMBOLS.find((s) => s.id === 'sym:PWR')!;

  // ---- 元件 ----
  for (const c of records.filter((r) => r.RECORD === String(REC.COMPONENT))) {
    const loc = P(c);
    const orient = num(c.ORIENTATION, 0) % 4; const mirrored = c.ISMIRRORED === 'T';
    const partId = num(c.CURRENTPARTID, 1), dispMode = num(c.DISPLAYMODE, 0);
    const kids = (children.get(num(c._index)) ?? []).filter((k) => { const op = num(k.OWNERPARTID, -1); const dm = num(k.OWNERPARTDISPLAYMODE, 0); return (op === -1 || op === partId) && dm === dispMode; });
    // 绝对 → 局部：先减位置，再逆旋转（Altium 逆时针 90n，在 y 向下坐标里等于 rotate(-90n)），再镜像
    const toLocal = (w: Vec): Vec => { const d = rotate({ x: w.x - loc.x, y: w.y - loc.y }, 90 * orient); return mirrored ? { x: -d.x, y: d.y } : d; };
    const shapes: SymbolShape[] = []; const pins: (PinDef & { _base: Vec })[] = [];
    let ref = '', value = '', footprint = '', description = c.COMPONENTDESCRIPTION ?? '';
    const params: Record<string, string> = {};
    for (const k of kids) {
      const rec = num(k.RECORD);
      const lw = Math.max(10, num(k.LINEWIDTH, 1) * 10);
      if (rec === REC.PIN) {
        const base = toLocal(P(k));
        const length = num(k.PINLENGTH) * 10;
        const congl = num(k.PINCONGLOMERATE);
        let o = congl & 3; // 0 右 1 上 2 左 3 下（引脚从本体向外的方向）
        // 旋转 / 镜像后方向在局部坐标系里的表现：把绝对方向转到局部
        const dirVecAbs = o === 0 ? { x: 1, y: 0 } : o === 1 ? { x: 0, y: -1 } : o === 2 ? { x: -1, y: 0 } : { x: 0, y: 1 };
        const dl = rotate(dirVecAbs, 90 * orient); const dv = mirrored ? { x: -dl.x, y: dl.y } : dl;
        o = Math.abs(dv.x) > Math.abs(dv.y) ? (dv.x > 0 ? 0 : 2) : (dv.y < 0 ? 1 : 3);
        const end = { x: base.x + (o === 0 ? length : o === 2 ? -length : 0), y: base.y + (o === 3 ? length : o === 1 ? -length : 0) };
        const side: PinSide = o === 0 ? 'R' : o === 2 ? 'L' : o === 1 ? 'T' : 'B';
        const dir = o === 0 ? 180 : o === 2 ? 0 : o === 1 ? 270 : 90;
        const hidden = (congl & 0x04) !== 0 ? false : false;
        pins.push({ number: k.DESIGNATOR || String(pins.length + 1), name: k.NAME || k.DESIGNATOR || String(pins.length + 1), side, offset: 0, length, type: ELECTRICAL[k.ELECTRICAL ?? '4'] ?? 'passive', at: end, dir, hidden, _base: base } as PinDef & { _base: Vec });
      } else if (rec === REC.LINE) shapes.push({ kind: 'polyline', points: [toLocal(P(k)), toLocal(P(k, 'CORNER.X', 'CORNER.Y'))], fill: 'none', width: lw });
      else if (rec === REC.RECT || rec === REC.ROUNDRECT) shapes.push({ kind: 'rect', a: toLocal(P(k)), b: toLocal(P(k, 'CORNER.X', 'CORNER.Y')), fill: k.ISSOLID === 'T' ? 'background' : 'none', width: lw });
      else if (rec === REC.POLYLINE || rec === REC.POLYGON) { const n = num(k.LOCATIONCOUNT); const pts: Vec[] = []; for (let i = 1; i <= n; i++) pts.push(toLocal(Pn(k, i))); if (pts.length >= 2) shapes.push({ kind: 'polyline', points: pts, fill: rec === REC.POLYGON ? (k.ISSOLID === 'T' ? 'background' : 'none') : 'none', width: lw }); }
      else if (rec === REC.ELLIPSE) { const cc = toLocal(P(k)); shapes.push({ kind: 'circle', c: cc, r: num(k.RADIUS) * 10 + num(k.RADIUS_FRAC) / 10000, fill: k.ISSOLID === 'T' ? 'background' : 'none', width: lw }); }
      else if (rec === REC.ARC || rec === REC.ELLIPTICAL_ARC) {
        const cAbs = P(k); const r = num(k.RADIUS) * 10 + num(k.RADIUS_FRAC) / 10000; let sa = num(k.STARTANGLE), ea = num(k.ENDANGLE); if (ea <= sa) ea += 360;
        if (Math.abs(ea - sa - 360) < 1e-6) shapes.push({ kind: 'circle', c: toLocal(cAbs), r, fill: 'none', width: lw });
        else { const at = (a: number) => toLocal({ x: cAbs.x + r * Math.cos((a * Math.PI) / 180), y: cAbs.y - r * Math.sin((a * Math.PI) / 180) }); shapes.push({ kind: 'arc', start: at(sa), mid: at((sa + ea) / 2), end: at(ea), width: lw }); }
      } else if (rec === REC.LABEL) { if (k.TEXT) shapes.push({ kind: 'text', x: toLocal(P(k)).x, y: toLocal(P(k)).y, text: k.TEXT, size: 80 }); }
      else if (rec === REC.DESIGNATOR) ref = k.TEXT ?? ref;
      else if (rec === REC.PARAMETER) { const n = (k.NAME ?? '').toLowerCase(); if (k.TEXT && !k.TEXT.startsWith('=')) { params[k.NAME ?? ''] = k.TEXT; if (n === 'comment' || n === 'value') value = value || k.TEXT; } }
      else if (rec === REC.IMPL_LIST) { for (const impl of children.get(num(k._index)) ?? []) if (impl.RECORD === String(REC.IMPL) && /PCBLIB/i.test(impl.MODELTYPE ?? '') && (impl.ISCURRENT === 'T' || !footprint)) footprint = impl.MODELNAME ?? ''; }
    }
    if (!ref) ref = c.DESIGNATOR ?? `U${components.length + 1}`;
    if (!value) value = params.Comment ?? params.Value ?? c.LIBREFERENCE ?? '';
    if (value.startsWith('=')) value = c.LIBREFERENCE ?? '';
    // 外接框 → 局部左上为原点
    const pts: Vec[] = [];
    for (const s of shapes) { if (s.kind === 'polyline') pts.push(...s.points); else if (s.kind === 'rect') pts.push(s.a, s.b); else if (s.kind === 'circle') pts.push({ x: s.c.x - s.r, y: s.c.y - s.r }, { x: s.c.x + s.r, y: s.c.y + s.r }); else if (s.kind === 'arc') pts.push(s.start, s.mid, s.end); else pts.push({ x: s.x, y: s.y }); }
    for (const p of pins) pts.push(p.at!, p._base);
    if (!pts.length) pts.push({ x: -100, y: -100 }, { x: 100, y: 100 });
    const minX = Math.min(...pts.map((p) => p.x)), minY = Math.min(...pts.map((p) => p.y)), maxX = Math.max(...pts.map((p) => p.x)), maxY = Math.max(...pts.map((p) => p.y));
    const sh = (p: Vec): Vec => ({ x: Math.round((p.x - minX) * 100) / 100, y: Math.round((p.y - minY) * 100) / 100 });
    const shapes2: SymbolShape[] = shapes.map((s) => s.kind === 'polyline' ? { ...s, points: s.points.map(sh) } : s.kind === 'rect' ? { ...s, a: sh(s.a), b: sh(s.b) } : s.kind === 'circle' ? { ...s, c: sh(s.c) } : s.kind === 'arc' ? { ...s, start: sh(s.start), mid: sh(s.mid), end: sh(s.end) } : { ...s, ...sh({ x: s.x, y: s.y }) });
    const pins2 = pins.map(({ _base, ...p }) => ({ ...p, at: sh(p.at!) }));
    const libName = (c.LIBREFERENCE || 'Part').replace(/[|]/g, '_');
    const isPower = /^(GND|VCC|VDD|VSS|\+?\d+V\d*)$/i.test(libName) && pins2.length === 1;
    const sig = JSON.stringify({ shapes: shapes2, pins: pins2.map((p) => [p.number, p.name, p.at, p.dir]) });
    let key = `sym:altium:${libName}`, n = 2;
    while (defByKey.has(key) && (defByKey.get(key) as unknown as { _sig: string })._sig !== sig) key = `sym:altium:${libName}#${n++}`;
    let def = defByKey.get(key);
    if (!def) {
      const prefix = ref.replace(/[?\d]+$/, '') || 'U';
      def = { id: key, name: libName + (n > 2 ? `#${n - 1}` : ''), kind: isPower ? '电源' : '导入', prefix: isPower ? '#PWR' : prefix, width: Math.max(1, Math.round((maxX - minX) * 100) / 100), height: Math.max(1, Math.round((maxY - minY) * 100) / 100), graphic: 'shapes', shapes: shapes2, pins: pins2, showPinNames: !(pins2.length <= 2 && /^[RCLD]/.test(prefix)), power: isPower, defaultValue: value, defaultFootprint: footprint ? `fp:altium:${footprint}` : '', description, source: `altium:${libName}`, anchor: sh({ x: 0, y: 0 }) };
      (def as unknown as { _sig: string })._sig = sig;
      defByKey.set(key, def); symbols.push(def);
    }
    const anchor = def.anchor ?? { x: 0, y: 0 };
    // 放置：世界 = 中心 + R(rot)·M·(局部 − 中心)；rot = −90·orient
    const rotation = ((-90 * orient) % 360 + 360) % 360;
    const C = { x: def.width / 2, y: def.height / 2 };
    let lp = { x: anchor.x - C.x, y: anchor.y - C.y }; if (mirrored) lp = { x: -lp.x, y: lp.y };
    const rp = rotate(lp, rotation);
    components.push({ id: newId('c'), ref, symbolId: key, value, footprint: footprint ? `fp:altium:${footprint}` : '', x: Math.round(loc.x - C.x - rp.x), y: Math.round(loc.y - C.y - rp.y), rotation, mirror: mirrored, props: { ...(footprint ? { altiumFootprint: footprint } : {}), ...(params.Description ? { description: params.Description } : {}), ...(params['Manufacturer Part Number'] || params.MPN ? { mpn: params['Manufacturer Part Number'] ?? params.MPN } : {}) } });
  }

  // ---- 电源端口 → 内置 GND / 电源符号，引脚末端落在端口位置 ----
  const placePower = (sym: SymbolDef, at: Vec, rotation: number, value: string) => {
    const probe: SchComponent = { id: 'probe', ref: '#PWR', symbolId: sym.id, value, footprint: '', x: 0, y: 0, rotation, mirror: false, props: {} };
    const g = pinGeoms(probe, sym)[0];
    components.push({ ...probe, id: newId('c'), ref: `#PWR${components.length + 1}`, x: Math.round(at.x - g.end.x), y: Math.round(at.y - g.end.y) });
  };
  for (const r of records.filter((x) => x.RECORD === String(REC.POWER_PORT))) {
    const at = P(r); const text = r.TEXT ?? 'GND'; const style = num(r.STYLE, 0); const o = num(r.ORIENTATION, 0) % 4;
    const isGnd = style >= 4 && style <= 6 || /^(A|D|P)?GND|VSS/i.test(text);
    if (isGnd) placePower(gnd, at, o === 1 ? 180 : o === 0 ? 90 : o === 2 ? 270 : 0, text); // 默认朝下（o=3）
    else placePower(pwr, at, o === 3 ? 180 : o === 0 ? 90 : o === 2 ? 270 : 0, text); // 默认朝上（o=1）
  }

  // ---- 导线 / 总线 / 结点 / 标签 / 端口 ----
  for (const r of records) {
    const rec = num(r.RECORD);
    if (rec === REC.WIRE || rec === REC.BUS) { const n = num(r.LOCATIONCOUNT); const pts: Vec[] = []; for (let i = 1; i <= n; i++) { const p = Pn(r, i); pts.push({ x: Math.round(p.x), y: Math.round(p.y) }); } if (pts.length >= 2) { if (rec === REC.WIRE) wires.push({ id: newId('w'), points: pts }); else buses.push({ id: newId('b'), points: pts }); } }
    else if (rec === REC.JUNCTION) { const p = P(r); junctions.push({ id: newId('j'), x: Math.round(p.x), y: Math.round(p.y) }); }
    else if (rec === REC.NET_LABEL || rec === REC.PORT) { const p = P(r); if (r.TEXT) labels.push({ id: newId('l'), text: r.TEXT.replace(/\\/g, ''), x: Math.round(p.x), y: Math.round(p.y) }); }
    else if (rec === REC.BUS_ENTRY) { const a = P(r), b = P(r, 'CORNER.X', 'CORNER.Y'); wires.push({ id: newId('w'), points: [a, b].map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })) }); }
    else if (num(r.OWNERINDEX, -1) >= 0 && byIndex.get(num(r.OWNERINDEX))?.RECORD === String(REC.COMPONENT)) continue; // 元件子图元已处理
    else if (rec === REC.LINE) graphics.push({ id: newId('g'), kind: 'line', points: [P(r), P(r, 'CORNER.X', 'CORNER.Y')] } as Graphic);
    else if (rec === REC.POLYLINE) { const n = num(r.LOCATIONCOUNT); const pts: Vec[] = []; for (let i = 1; i <= n; i++) pts.push(Pn(r, i)); if (pts.length >= 2) graphics.push({ id: newId('g'), kind: 'line', points: pts } as Graphic); }
    else if (rec === REC.RECT || rec === REC.SHEET_SYMBOL) { const a = P(r); const b = rec === REC.SHEET_SYMBOL ? { x: a.x + milOf(r, 'XSIZE'), y: a.y + milOf(r, 'YSIZE') } : P(r, 'CORNER.X', 'CORNER.Y'); graphics.push({ id: newId('g'), kind: 'rect', a, b } as Graphic); if (rec === REC.SHEET_SYMBOL) { const nm = (children.get(num(r._index)) ?? []).find((k) => k.RECORD === String(REC.SHEET_NAME)); if (nm?.TEXT) graphics.push({ id: newId('g'), kind: 'text', x: a.x, y: a.y - 40, text: nm.TEXT, size: 100 } as Graphic); } }
    else if (rec === REC.SHEET_ENTRY) { const owner = byIndex.get(num(r.OWNERINDEX)); if (owner && r.NAME) { const a = P(owner); const side = num(r.SIDE, 0); const d = num(r.DISTANCEFROMTOP) * 10; const w = milOf(owner, 'XSIZE'), h = milOf(owner, 'YSIZE'); const p = side === 0 ? { x: a.x, y: a.y + d } : side === 1 ? { x: a.x + w, y: a.y + d } : side === 2 ? { x: a.x + d, y: a.y } : { x: a.x + d, y: a.y + h }; labels.push({ id: newId('l'), text: r.NAME, x: Math.round(p.x), y: Math.round(p.y) }); } }
    else if (rec === REC.LABEL || rec === REC.TEXT_FRAME) { if (r.TEXT && num(r.OWNERINDEX, -1) < 0) { const p = P(r); graphics.push({ id: newId('g'), kind: 'text', x: p.x, y: p.y, text: r.TEXT.replace(/~1/g, '\n').split('\n')[0], size: 100 } as Graphic); } }
  }
  void snap100;
  const sheet: Sheet = { id: opts.sheetId ?? newId('sheet'), name: opts.sheetName ?? '导入', frame: { ...DEFAULT_FRAME, size: sheetW >= 15000 ? 'A3' : 'A4', landscape: true }, components, wires, labels, junctions, buses, graphics };
  stats.components = components.length; stats.wires = wires.length; stats.labels = labels.length; stats.symbols = symbols.length;
  return { sheet, symbols, warnings, stats };
}
