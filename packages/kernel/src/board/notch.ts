import { dist, segSegDist, type Vec } from '../geometry.js';

/** Insert a rectangular recess in one straight outline edge, measured from its first vertex. */
export function notchOutline(outline: Vec[], edge: number, offset: number, width: number, depth: number): Vec[] {
  const eps = 1e-7;
  if (outline.length < 3 || !Number.isInteger(edge) || edge < 0 || edge >= outline.length ||
      ![offset, width, depth].every(Number.isFinite) || offset <= eps || width <= eps || depth <= eps) throw new Error('Invalid notch dimensions');
  const a = outline[edge], b = outline[(edge + 1) % outline.length], length = dist(a, b);
  if (offset + width >= length - eps) throw new Error('Notch must fit within the selected edge');
  const area = outline.reduce((sum, p, i) => { const q = outline[(i + 1) % outline.length]; return sum + p.x * q.y - q.x * p.y; }, 0);
  if (Math.abs(area) < eps) throw new Error('Invalid outline');
  const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length, sign = Math.sign(area);
  const start = { x: a.x + ux * offset, y: a.y + uy * offset };
  const end = { x: start.x + ux * width, y: start.y + uy * width };
  const inset = (p: Vec) => ({ x: p.x - uy * depth * sign, y: p.y + ux * depth * sign });
  const result = [...outline.slice(0, edge + 1), start, inset(start), inset(end), end, ...outline.slice(edge + 1)];
  // Refuse a cut crossing another edge (including existing recesses) or splitting the board.
  for (let i = 0; i < result.length; i++) for (let j = i + 1; j < result.length; j++) {
    if (j === i + 1 || (i === 0 && j === result.length - 1)) continue;
    if (segSegDist(result[i], result[(i + 1) % result.length], result[j], result[(j + 1) % result.length]) <= eps) throw new Error('Notch crosses another outline edge');
  }
  return result;
}
