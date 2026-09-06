/**
 * 符号 / 元件的矢量几何（与 Web 端 SymbolGlyph 同一套画法），供 PDF / SVG 导出与缩略图使用。
 * 单位 mil；文字位置与画布一致。
 */
import type { SchComponent, SymbolDef, SymbolShape, NetLabel, Sheet, Schematic } from '../model/schematic.js';
import { getSymbol } from '../library/symbols.js';
import { componentBody, pinGeoms, _internal } from './geometry.js';
import type { Vec } from '../geometry.js';

/** 标准原理图配色（OrCAD / 数据手册风格）：符号蓝、导线暗红、网络标签红、引脚号 / 电源名黑。 */
export const SCH_COLORS = { symbol: '#1A1AE6', wire: '#800000', bus: '#2C5AA0', netLabel: '#D40000', text: '#201E1D', pinNumber: '#333333', junction: '#800000', fill: '#FFFFFF' } as const;

export interface StrokeText { x: number; y: number; text: string; size: number; anchor: 'start' | 'middle' | 'end'; bold?: boolean; color?: string }
export interface StrokeSet { lines: { points: Vec[]; width: number; fill?: boolean }[]; circles: { c: Vec; r: number; width: number; fill?: boolean }[]; texts: StrokeText[] }

const SW = 16;

/** 三点弧 → 折线采样。 */
export function arcToPolyline(a: SymbolShape & { kind: 'arc' }, n = 16): Vec[] {
  const { start: s, mid: m, end: e } = a;
  const d = 2 * (s.x * (m.y - e.y) + m.x * (e.y - s.y) + e.x * (s.y - m.y));
  if (Math.abs(d) < 1e-9) return [s, e];
  const ux = ((s.x ** 2 + s.y ** 2) * (m.y - e.y) + (m.x ** 2 + m.y ** 2) * (e.y - s.y) + (e.x ** 2 + e.y ** 2) * (s.y - m.y)) / d;
  const uy = ((s.x ** 2 + s.y ** 2) * (e.x - m.x) + (m.x ** 2 + m.y ** 2) * (s.x - e.x) + (e.x ** 2 + e.y ** 2) * (m.x - s.x)) / d;
  const r = Math.hypot(s.x - ux, s.y - uy);
  const cross = (m.x - s.x) * (e.y - s.y) - (m.y - s.y) * (e.x - s.x);
  const a0 = Math.atan2(s.y - uy, s.x - ux), a1 = Math.atan2(e.y - uy, e.x - ux);
  let delta = a1 - a0;
  if (cross > 0) { while (delta < 0) delta += 2 * Math.PI; } else { while (delta > 0) delta -= 2 * Math.PI; }
  return Array.from({ length: n + 1 }, (_, i) => ({ x: ux + r * Math.cos(a0 + (delta * i) / n), y: uy + r * Math.sin(a0 + (delta * i) / n) }));
}

/** 出现在多张图纸上的标签名（这些标签默认画成跨页端口）。 */
export function crossSheetLabelNames(schematic: Schematic): Set<string> {
  const count = new Map<string, Set<string>>();
  for (const sh of schematic.sheets) for (const l of sh.labels) { if (!count.has(l.text)) count.set(l.text, new Set()); count.get(l.text)!.add(sh.id); }
  return new Set([...count].filter(([, sheets]) => sheets.size > 1).map(([n]) => n));
}
export const GND_NET_RE = /^(?:[ADP]?GND[A-Z0-9_]*|VSS[A-Z0-9_]*|GROUND|EARTH|0V)$/i;
export const POWER_NET_RE = /^(?:[+-]?\d+(?:\.\d+)?V\d*[A-Z0-9_]*|V(?:CC|DD|EE|BUS|BAT|IN|OUT|SYS|PP|REF|AUX|IO)[A-Z0-9_]*|\+?[0-9]V[0-9]+[A-Z0-9_]*)$/i;
export type NetLabelGlyph = 'text' | 'gnd' | 'power';
export interface NetLabelLayout { glyph: NetLabelGlyph; text: { x: number; y: number; anchor: 'start' | 'middle' | 'end' }; lines: Vec[][]; circles: { c: Vec; r: number }[] }
/**
 * 网络标签布局：
 * - 普通网络：红色纯文字贴在导线末端（芯片引脚引出一根线 + 文字），文字顺着导线方向排。
 * - 地网络（GND / AGND / VSS…）：在锚点画标准地符号（短竖线 + 3 条渐短横线），GND 文字居中在远端；方向背离导线（导线在上就朝下）。
 * - 电源网络（+5V / +3V3 / VCC / VDD…）：短竖线 + 末端空心圆，文字在圆外侧；方向同样背离导线，默认朝上。
 */
export function netLabelLayout(sheet: Sheet, label: NetLabel, _crossSheet?: Set<string>): NetLabelLayout {
  void _crossSheet;
  let dir: 'up' | 'down' | 'left' | 'right' | null = null; // 导线相对锚点的方向
  for (const w of sheet.wires) {
    const n = w.points.length; if (n < 2) continue;
    const ends: [Vec, Vec][] = [[w.points[0], w.points[1]], [w.points[n - 1], w.points[n - 2]]];
    for (const [e, q] of ends) if (Math.abs(e.x - label.x) < 1e-6 && Math.abs(e.y - label.y) < 1e-6) { const dx = q.x - e.x, dy = q.y - e.y; dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'); }
    if (dir) break;
  }
  const { x, y } = label;
  const glyph: NetLabelGlyph = label.kind === 'net' ? 'text' : GND_NET_RE.test(label.text) ? 'gnd' : POWER_NET_RE.test(label.text) ? 'power' : 'text';
  if (glyph === 'gnd') {
    const sgn = dir === 'down' ? -1 : 1; // 导线在下方 → 地符号朝上；其余朝下
    const lines: Vec[][] = [[{ x, y }, { x, y: y + sgn * 100 }]];
    GND_BARS.forEach((f, k) => lines.push([{ x: x - 150 * f, y: y + sgn * (100 + k * 50) }, { x: x + 150 * f, y: y + sgn * (100 + k * 50) }]));
    return { glyph, lines, circles: [], text: { x, y: sgn > 0 ? y + 100 + 100 + 120 : y - 100 - 100 - 50, anchor: 'middle' } };
  }
  if (glyph === 'power') {
    const sgn = dir === 'up' ? 1 : -1; // 导线在上方 → 端口朝下；其余朝上
    const c = { x, y: y + sgn * 140 };
    return { glyph, lines: [[{ x, y }, { x, y: y + sgn * 100 }]], circles: [{ c, r: 40 }], text: { x, y: sgn < 0 ? c.y - 40 - 50 : c.y + 40 + 110, anchor: 'middle' } };
  }
  const text = dir === 'left' ? { x: x - 20, y: y - 40, anchor: 'end' as const }
    : dir === 'down' ? { x, y: y - 40, anchor: 'middle' as const }
    : dir === 'up' ? { x, y: y + 110, anchor: 'middle' as const }
    : { x: x + 20, y: y - 40, anchor: 'start' as const };
  return { glyph, text, lines: [], circles: [] };
}
/** 地符号 4 条横线的相对宽度（从接线端起）。 */
export const GND_BARS = [1, 0.66, 0.33];
/** 电阻折线（竖直方向，6 个半周期）。 */
export function resistorZigzag(w: number, h: number): Vec[] {
  const y0 = h * 0.08, y1 = h * 0.92, s = (y1 - y0) / 6;
  const pts: Vec[] = [{ x: w / 2, y: 0 }, { x: w / 2, y: y0 }];
  for (let k = 0; k < 6; k++) pts.push({ x: k % 2 === 0 ? w : 0, y: y0 + s * (k + 0.5) });
  pts.push({ x: w / 2, y: y1 }, { x: w / 2, y: h });
  return pts;
}
/** 位号 / 值的标准位置：电源端口文字在圆点外侧（朝上时居上、朝下时居下），地符号文字居下，其余在右侧或大器件上方。 */
export function symbolTextPositions(comp: SchComponent, sym: SymbolDef): { ref: { x: number; y: number; anchor: 'start' | 'middle' }; value: { x: number; y: number; anchor: 'start' | 'middle' } } {
  const b = componentBody(comp, sym);
  const big = sym.graphic === 'box' && sym.width >= 1000;
  const cx = b.x + b.w / 2;
  const rot = ((comp.rotation % 360) + 360) % 360;
  let ref = { x: b.x + b.w + 80, y: b.y + b.h / 2 - 20, anchor: 'start' as 'start' | 'middle' };
  let value = { x: b.x + b.w + 80, y: b.y + b.h / 2 + 110, anchor: 'start' as 'start' | 'middle' };
  if (big) { ref = { x: cx, y: b.y - 80, anchor: 'middle' }; value = { x: cx, y: b.y + b.h / 2 + 40, anchor: 'middle' }; }
  if (sym.graphic === 'power') {
    const up = rot === 0; // 圆点朝上：文字居上；朝下：文字居下
    value = rot === 90 || rot === 270 ? { x: b.x + b.w + 60, y: b.y + b.h / 2 + 40, anchor: 'start' } : up ? { x: cx, y: b.y - 50, anchor: 'middle' } : { x: cx, y: b.y + b.h + 120, anchor: 'middle' };
  }
  if (sym.graphic === 'gnd') value = rot === 90 || rot === 270 ? { x: cx, y: b.y + b.h + 120, anchor: 'middle' } : rot === 180 ? { x: cx, y: b.y - 50, anchor: 'middle' } : { x: cx, y: b.y + b.h + 120, anchor: 'middle' }; // 地：GND 文字居中放在远离导线的一侧（朝下在下方，朝上在上方）
  return { ref, value };
}
/** 符号本体（局部坐标，不含引脚）。 */
export function symbolLocalStrokes(sym: SymbolDef): StrokeSet {
  const out: StrokeSet = { lines: [], circles: [], texts: [] };
  const w = sym.width, h = sym.height;
  const rect = (x: number, y: number, rw: number, rh: number, width = SW, fill = false) => out.lines.push({ points: [{ x, y }, { x: x + rw, y }, { x: x + rw, y: y + rh }, { x, y: y + rh }, { x, y }], width, fill });
  if (sym.graphic === 'shapes') {
    for (const sh of sym.shapes ?? []) {
      const width = Math.max(sh.kind === 'text' ? 0 : sh.width, 10);
      if (sh.kind === 'polyline') out.lines.push({ points: sh.fill !== 'none' ? [...sh.points, sh.points[0]] : sh.points, width, fill: sh.fill !== 'none' });
      else if (sh.kind === 'rect') rect(Math.min(sh.a.x, sh.b.x), Math.min(sh.a.y, sh.b.y), Math.abs(sh.b.x - sh.a.x), Math.abs(sh.b.y - sh.a.y), width, sh.fill !== 'none');
      else if (sh.kind === 'circle') out.circles.push({ c: sh.c, r: sh.r, width, fill: sh.fill !== 'none' });
      else if (sh.kind === 'arc') out.lines.push({ points: arcToPolyline(sh), width });
      else out.texts.push({ x: sh.x, y: sh.y, text: sh.text, size: sh.size, anchor: 'middle' });
    }
    return out;
  }
  switch (sym.graphic) {
    case 'box': rect(0, 0, w, h, SW, true); break;
    case 'resistor': out.lines.push({ points: resistorZigzag(w, h), width: SW }); break;
    case 'capacitor':
      out.lines.push({ points: [{ x: w / 2, y: 0 }, { x: w / 2, y: h * 0.35 }], width: SW }, { points: [{ x: 0, y: h * 0.35 }, { x: w, y: h * 0.35 }], width: SW }, { points: [{ x: 0, y: h * 0.65 }, { x: w, y: h * 0.65 }], width: SW }, { points: [{ x: w / 2, y: h * 0.65 }, { x: w / 2, y: h }], width: SW });
      break;
    case 'led':
      out.lines.push({ points: [{ x: 0, y: h / 2 }, { x: w * 0.2, y: h / 2 }], width: SW }, { points: [{ x: w * 0.2, y: h * 0.1 }, { x: w * 0.75, y: h / 2 }, { x: w * 0.2, y: h * 0.9 }, { x: w * 0.2, y: h * 0.1 }], width: SW, fill: true }, { points: [{ x: w * 0.75, y: h * 0.1 }, { x: w * 0.75, y: h * 0.9 }], width: SW }, { points: [{ x: w * 0.75, y: h / 2 }, { x: w, y: h / 2 }], width: SW });
      out.lines.push({ points: [{ x: w * 0.55, y: h * 0.05 }, { x: w * 0.55 + 60, y: h * 0.05 - 70 }], width: SW * 0.7 }, { points: [{ x: w * 0.7, y: h * 0.12 }, { x: w * 0.7 + 60, y: h * 0.12 - 70 }], width: SW * 0.7 });
      break;
    case 'gnd':
      // 标准地符号：3 条横线一条比一条短，接在导线末端（旋转 180° 即朝上）
      for (const [k, f] of GND_BARS.entries()) out.lines.push({ points: [{ x: (w * (1 - f)) / 2, y: k * 50 }, { x: (w * (1 + f)) / 2, y: k * 50 }], width: SW });
      break;
    case 'power':
      // 标准电源端口：末端空心圆 + 短竖线（旋转 180° 即朝下）
      out.circles.push({ c: { x: w / 2, y: 40 }, r: 40, width: SW, fill: true });
      out.lines.push({ points: [{ x: w / 2, y: 80 }, { x: w / 2, y: h }], width: SW });
      break;
  }
  return out;
}

/** 元件在世界坐标下的全部几何：本体、引脚、引脚名 / 号、位号与值。 */
export function componentStrokes(comp: SchComponent, sym: SymbolDef = getSymbol(comp.symbolId)): StrokeSet {
  const local = symbolLocalStrokes(sym);
  const T = (p: Vec) => _internal.localToWorld(comp, sym, p);
  const out: StrokeSet = {
    lines: local.lines.map((l) => ({ ...l, points: l.points.map(T) })),
    circles: local.circles.map((c) => ({ ...c, c: T(c.c) })),
    texts: local.texts.map((t) => ({ ...t, ...T({ x: t.x, y: t.y }) }))
  };
  const pins = pinGeoms(comp, sym);
  for (const g of pins) {
    if (g.def.hidden) continue;
    out.lines.push({ points: [g.base, g.end], width: SW });
    if (sym.showPinNames && g.def.name !== g.def.number) {
      const dx = g.base.x - g.end.x, dy = g.base.y - g.end.y;
      const horiz = Math.abs(dx) >= Math.abs(dy);
      const tx = horiz ? g.base.x + Math.sign(dx || 1) * 50 : g.base.x, ty = horiz ? g.base.y + 35 : g.base.y + Math.sign(dy || 1) * 60 + (dy > 0 ? 60 : 0);
      out.texts.push({ x: tx, y: ty, text: g.def.name, size: sym.graphic === 'shapes' ? 90 : 100, anchor: horiz ? (dx >= 0 ? 'start' : 'end') : 'middle', color: '#4A4A4A' });
    }
    if (sym.graphic === 'shapes') out.texts.push({ x: (g.base.x + g.end.x) / 2, y: (g.base.y + g.end.y) / 2 - 25, text: g.def.number, size: 70, anchor: 'middle' });
  }
  const tp = symbolTextPositions(comp, sym);
  if (!sym.power) out.texts.push({ x: tp.ref.x, y: tp.ref.y, text: comp.ref, size: 120, anchor: tp.ref.anchor, bold: true, color: SCH_COLORS.symbol });
  out.texts.push({ x: tp.value.x, y: tp.value.y, text: comp.value, size: sym.power ? 100 : 110, anchor: tp.value.anchor, color: sym.power ? SCH_COLORS.text : SCH_COLORS.symbol });
  return out;
}
