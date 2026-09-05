import type { Vec, Rect } from '../geometry.js';

/** 多边形环（不闭合，最后一点不重复第一点）。 */
export type Ring = Vec[];
/** 多边形 = 外环 + 若干内环（孔）。 */
export type Polygon = Ring[];
export type MultiPolygon = Polygon[];

export function circlePoly(c: Vec, r: number, n = 32): Ring {
  const out: Ring = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) }); }
  return out;
}

/** 线段膨胀成胶囊形（两端半圆）。 */
export function stadiumPoly(a: Vec, b: Vec, r: number, n = 16): Ring {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
  if (L < 1e-9) return circlePoly(a, r, n * 2);
  const ang = Math.atan2(dy, dx);
  const out: Ring = [];
  for (let i = 0; i <= n; i++) { const t = ang - Math.PI / 2 + (i / n) * Math.PI; out.push({ x: b.x + r * Math.cos(t), y: b.y + r * Math.sin(t) }); }
  for (let i = 0; i <= n; i++) { const t = ang + Math.PI / 2 + (i / n) * Math.PI; out.push({ x: a.x + r * Math.cos(t), y: a.y + r * Math.sin(t) }); }
  return out;
}

export function rectPoly(r: Rect): Ring {
  return [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
}

/** 矩形向外膨胀 m，四角圆化（用于焊盘间距）。 */
export function expandedRectPoly(r: Rect, m: number, n = 6): Ring {
  if (m <= 0) return rectPoly(r);
  const out: Ring = [];
  const corners: [Vec, number][] = [
    [{ x: r.x + r.w, y: r.y + r.h }, 0], [{ x: r.x, y: r.y + r.h }, Math.PI / 2], [{ x: r.x, y: r.y }, Math.PI], [{ x: r.x + r.w, y: r.y }, Math.PI * 1.5]
  ];
  for (const [c, start] of corners) for (let i = 0; i <= n; i++) { const t = start + (i / n) * (Math.PI / 2); out.push({ x: c.x + m * Math.cos(t), y: c.y + m * Math.sin(t) }); }
  return out;
}

export function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y);
  return a / 2;
}
