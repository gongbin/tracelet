export interface Vec { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }

export const vec = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const eq = (a: Vec, b: Vec, eps = 1e-6): boolean => Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
export const key = (p: Vec, digits = 3): string => `${p.x.toFixed(digits)},${p.y.toFixed(digits)}`;

/** 旋转点（角度制，绕原点）。 */
export function rotate(p: Vec, deg: number): Vec {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

export function pointInRect(p: Vec, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function expandRect(r: Rect, m: number): Rect {
  return { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m };
}

export function rectCenter(r: Rect): Vec {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** 点到线段距离。 */
export function pointSegDist(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** 点是否落在线段上（含容差）。 */
export function pointOnSeg(p: Vec, a: Vec, b: Vec, eps = 1e-3): boolean {
  return pointSegDist(p, a, b) <= eps;
}

function orient(a: Vec, b: Vec, c: Vec): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

export function segsIntersect(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
  const eps = 1e-9;
  if (Math.abs(o1) < eps && pointOnSeg(c, a, b, eps)) return true;
  if (Math.abs(o2) < eps && pointOnSeg(d, a, b, eps)) return true;
  if (Math.abs(o3) < eps && pointOnSeg(a, c, d, eps)) return true;
  if (Math.abs(o4) < eps && pointOnSeg(b, c, d, eps)) return true;
  return false;
}

/** 线段到线段距离。 */
export function segSegDist(a: Vec, b: Vec, c: Vec, d: Vec): number {
  if (segsIntersect(a, b, c, d)) return 0;
  return Math.min(pointSegDist(a, c, d), pointSegDist(b, c, d), pointSegDist(c, a, b), pointSegDist(d, a, b));
}

/** 线段到轴对齐矩形的距离；线段穿过矩形则为 0。 */
/** 点到矩形的距离（矩形内为 0）。 */
export function pointRectDist(p: Vec, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w)), dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}
export function segRectDist(a: Vec, b: Vec, r: Rect): number {
  if (a.x === b.x && a.y === b.y) return pointRectDist(a, r);
  if (pointInRect(a, r) || pointInRect(b, r)) return 0;
  const p1 = { x: r.x, y: r.y }, p2 = { x: r.x + r.w, y: r.y }, p3 = { x: r.x + r.w, y: r.y + r.h }, p4 = { x: r.x, y: r.y + r.h };
  return Math.min(segSegDist(a, b, p1, p2), segSegDist(a, b, p2, p3), segSegDist(a, b, p3, p4), segSegDist(a, b, p4, p1));
}

export function rectRectDist(a: Rect, b: Rect): number {
  const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), 0);
  const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h), 0);
  return Math.hypot(dx, dy);
}

export function polygonBounds(pts: Vec[]): Rect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  if (!isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function pointInPolygon(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** 并查集。 */
export class UnionFind {
  private parent = new Map<string, string>();
  find(a: string): string {
    if (!this.parent.has(a)) this.parent.set(a, a);
    let r = a;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    let c = a;
    while (this.parent.get(c) !== r) { const n = this.parent.get(c)!; this.parent.set(c, r); c = n; }
    return r;
  }
  union(a: string, b: string): void {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
  has(a: string): boolean { return this.parent.has(a); }
  groups(): Map<string, string[]> {
    const g = new Map<string, string[]>();
    for (const k of this.parent.keys()) {
      const r = this.find(k);
      if (!g.has(r)) g.set(r, []);
      g.get(r)!.push(k);
    }
    return g;
  }
}
