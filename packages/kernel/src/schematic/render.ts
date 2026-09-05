/**
 * 符号 / 元件的矢量几何（与 Web 端 SymbolGlyph 同一套画法），供 PDF / SVG 导出与缩略图使用。
 * 单位 mil；文字位置与画布一致。
 */
import type { SchComponent, SymbolDef, SymbolShape } from '../model/schematic.js';
import { getSymbol } from '../library/symbols.js';
import { componentBody, pinGeoms, _internal } from './geometry.js';
import type { Vec } from '../geometry.js';

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
    case 'box': case 'resistor': rect(0, 0, w, h, SW, true); break;
    case 'capacitor':
      out.lines.push({ points: [{ x: w / 2, y: 0 }, { x: w / 2, y: h * 0.35 }], width: SW }, { points: [{ x: 0, y: h * 0.35 }, { x: w, y: h * 0.35 }], width: SW }, { points: [{ x: 0, y: h * 0.65 }, { x: w, y: h * 0.65 }], width: SW }, { points: [{ x: w / 2, y: h * 0.65 }, { x: w / 2, y: h }], width: SW });
      break;
    case 'led':
      out.lines.push({ points: [{ x: 0, y: h / 2 }, { x: w * 0.2, y: h / 2 }], width: SW }, { points: [{ x: w * 0.2, y: h * 0.1 }, { x: w * 0.75, y: h / 2 }, { x: w * 0.2, y: h * 0.9 }, { x: w * 0.2, y: h * 0.1 }], width: SW, fill: true }, { points: [{ x: w * 0.75, y: h * 0.1 }, { x: w * 0.75, y: h * 0.9 }], width: SW }, { points: [{ x: w * 0.75, y: h / 2 }, { x: w, y: h / 2 }], width: SW });
      out.lines.push({ points: [{ x: w * 0.55, y: h * 0.05 }, { x: w * 0.55 + 60, y: h * 0.05 - 70 }], width: SW * 0.7 }, { points: [{ x: w * 0.7, y: h * 0.12 }, { x: w * 0.7 + 60, y: h * 0.12 - 70 }], width: SW * 0.7 });
      break;
    case 'gnd':
      out.lines.push({ points: [{ x: 0, y: 0 }, { x: w, y: 0 }], width: SW }, { points: [{ x: w / 6, y: 60 }, { x: (w * 5) / 6, y: 60 }], width: SW }, { points: [{ x: w / 3, y: 120 }, { x: (w * 2) / 3, y: 120 }], width: SW });
      break;
    case 'power':
      out.lines.push({ points: [{ x: w / 4, y: h }, { x: (w * 3) / 4, y: h }], width: SW * 1.4 });
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
  const b = componentBody(comp, sym);
  const big = sym.graphic === 'box' && sym.width >= 1000;
  const cx = b.x + b.w / 2;
  let refPos = { x: b.x + b.w + 80, y: b.y + b.h / 2 - 20 }, valPos = { x: b.x + b.w + 80, y: b.y + b.h / 2 + 110 };
  if (big) { refPos = { x: cx, y: b.y - 80 }; valPos = { x: cx, y: b.y + b.h / 2 + 40 }; }
  if (sym.graphic === 'power') valPos = { x: cx, y: b.y + b.h - 60 };
  if (sym.graphic === 'gnd') valPos = { x: b.x + b.w + 60, y: b.y + 120 };
  const mid = big || sym.graphic === 'power';
  if (!sym.power) out.texts.push({ ...refPos, text: comp.ref, size: 120, anchor: mid ? 'middle' : 'start', bold: true, color: '#201E1D' });
  out.texts.push({ ...valPos, text: comp.value, size: sym.graphic === 'gnd' ? 100 : 110, anchor: mid ? 'middle' : 'start', color: sym.color ?? '#4A4A4A' });
  return out;
}
