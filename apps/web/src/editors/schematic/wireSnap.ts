import { snapTo, type Vec, type Wire } from '@tracelet/kernel';

/** Pick exact electrical geometry within a screen-sized radius before falling back to the grid. */
export function wireSnap(raw: Vec, pins: Vec[], wires: Wire[], grid: number, radius: number): { point: Vec; attached: boolean } {
  let best: Vec | undefined, distance = radius;
  const consider = (p: Vec) => { const d = Math.hypot(raw.x - p.x, raw.y - p.y); if (d <= distance) { best = p; distance = d; } };
  for (const pin of pins) consider(pin);
  if (best) return { point: best, attached: true };
  for (const w of wires) for (const p of w.points) consider(p);
  if (best) return { point: best, attached: true };
  for (const w of wires) for (let i = 1; i < w.points.length; i++) {
    const a = w.points[i - 1], b = w.points[i], dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (!len2) continue;
    const t = Math.max(0, Math.min(1, ((raw.x - a.x) * dx + (raw.y - a.y) * dy) / len2));
    const p = { x: a.x + t * dx, y: a.y + t * dy };
    // Preserve the wire's off-grid axis, but use grid positions along orthogonal segments.
    if (dy === 0) p.x = Math.max(Math.min(a.x, b.x), Math.min(Math.max(a.x, b.x), snapTo(p.x, grid)));
    if (dx === 0) p.y = Math.max(Math.min(a.y, b.y), Math.min(Math.max(a.y, b.y), snapTo(p.y, grid)));
    consider(p);
  }
  return best ? { point: best, attached: true } : { point: { x: snapTo(raw.x, grid), y: snapTo(raw.y, grid) }, attached: false };
}
