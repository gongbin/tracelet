import type { SchComponent, SymbolDef, PinDef } from '../model/schematic.js';
import { type Vec, type Rect, rotate, add } from '../geometry.js';
import { getSymbol } from '../library/symbols.js';
import { SCH_GRID, snapTo } from '../units.js';

export interface PinGeom {
  def: PinDef;
  /** 引脚与符号本体相接的点 */
  base: Vec;
  /** 引脚外端点（连线连接处） */
  end: Vec;
  /** 引脚方向：水平或垂直（旋转后） */
  horizontal: boolean;
}

function localToWorld(c: SchComponent, sym: SymbolDef, p: Vec): Vec {
  const cx = sym.width / 2, cy = sym.height / 2;
  let lp = { x: p.x - cx, y: p.y - cy };
  if (c.mirror) lp = { x: -lp.x, y: lp.y };
  const r = rotate(lp, c.rotation);
  return { x: Math.round((r.x + cx + c.x) * 1000) / 1000, y: Math.round((r.y + cy + c.y) * 1000) / 1000 };
}

export function pinLocal(sym: SymbolDef, pin: PinDef): { base: Vec; end: Vec } {
  const L = pin.length;
  if (pin.at) {
    const d = ((pin.dir ?? 0) % 360 + 360) % 360;
    const rad = (d * Math.PI) / 180;
    // dir 为屏幕方向（90 = 向上），y 向下取负
    return { base: { x: pin.at.x + L * Math.cos(rad), y: pin.at.y - L * Math.sin(rad) }, end: { ...pin.at } };
  }
  switch (pin.side) {
    case 'L': return { base: { x: 0, y: pin.offset }, end: { x: -L, y: pin.offset } };
    case 'R': return { base: { x: sym.width, y: pin.offset }, end: { x: sym.width + L, y: pin.offset } };
    case 'T': return { base: { x: pin.offset, y: 0 }, end: { x: pin.offset, y: -L } };
    case 'B': return { base: { x: pin.offset, y: sym.height }, end: { x: pin.offset, y: sym.height + L } };
  }
}

export function pinGeom(c: SchComponent, pin: PinDef, sym: SymbolDef = getSymbol(c.symbolId)): PinGeom {
  const { base, end } = pinLocal(sym, pin);
  const wb = localToWorld(c, sym, base), we = localToWorld(c, sym, end);
  return { def: pin, base: wb, end: we, horizontal: Math.abs(we.x - wb.x) > Math.abs(we.y - wb.y) };
}

export function pinGeoms(c: SchComponent, sym: SymbolDef = getSymbol(c.symbolId)): PinGeom[] {
  return sym.pins.map((p) => pinGeom(c, p, sym));
}

export function findPin(c: SchComponent, pinNumber: string, sym: SymbolDef = getSymbol(c.symbolId)): PinGeom | undefined {
  const p = sym.pins.find((x) => x.number === pinNumber);
  return p ? pinGeom(c, p, sym) : undefined;
}

/** 符号本体外接矩形（含引脚），世界坐标。 */
export function componentBounds(c: SchComponent, sym: SymbolDef = getSymbol(c.symbolId)): Rect {
  const corners = [
    { x: 0, y: 0 }, { x: sym.width, y: 0 }, { x: 0, y: sym.height }, { x: sym.width, y: sym.height }
  ].map((p) => localToWorld(c, sym, p));
  const pts = [...corners, ...pinGeoms(c, sym).map((g) => g.end)];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** 本体矩形（不含引脚），世界坐标。 */
export function componentBody(c: SchComponent, sym: SymbolDef = getSymbol(c.symbolId)): Rect {
  const a = localToWorld(c, sym, { x: 0, y: 0 }), b = localToWorld(c, sym, { x: sym.width, y: sym.height });
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/** 两个引脚端点之间的正交自动走线（3 段）。 */
export function autoRoute(a: PinGeom, b: PinGeom): Vec[] {
  const p = a.end, q = b.end;
  if (p.x === q.x || p.y === q.y) return [p, q];
  if (a.horizontal) {
    const mx = snapTo((p.x + q.x) / 2, SCH_GRID);
    return [p, { x: mx, y: p.y }, { x: mx, y: q.y }, q];
  }
  const my = snapTo((p.y + q.y) / 2, SCH_GRID);
  return [p, { x: p.x, y: my }, { x: q.x, y: my }, q];
}

/** 从引脚端点到自由点的正交预览路径。 */
export function previewRoute(a: PinGeom, m: Vec): Vec[] {
  const p = a.end;
  if (a.horizontal) return [p, { x: m.x, y: p.y }, m];
  return [p, { x: p.x, y: m.y }, m];
}

/**
 * 放置时把符号中心对齐到栅格。内置符号的引脚端点相对中心都是 100mil 的整数倍，
 * 因此无论怎样旋转，引脚端点都落在栅格上。
 */
export function snapComponentOrigin(sym: SymbolDef, center: Vec): Vec {
  return { x: snapTo(center.x, SCH_GRID) - sym.width / 2, y: snapTo(center.y, SCH_GRID) - sym.height / 2 };
}

export const _internal = { localToWorld, add };
