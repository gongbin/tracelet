import type { Board, BoardFootprint } from '../model/board.js';
import type { RuleSet } from '../model/project.js';
import { footprintBody, footprintPads, allPads, netClassFor } from './geometry.js';
import { pointInPolygon, pointSegDist, rectRectDist, segRectDist } from '../geometry.js';

export interface RoutingMove { id: string; x: number; y: number; ref: string; from: { x: number; y: number } }
/** Small, translation-only proposals. Never relocate connectors, holes, locked or already wired parts. */
export function suggestRoutingMoves(board: Board, rules: RuleSet, nets: string[]): RoutingMove[] {
  const wanted = new Set(nets), moves: RoutingMove[] = [];
  let current = board;
  const candidates = board.footprints.filter(fp => !fp.locked && !/^(J|P|H|MH)\d/i.test(fp.ref) && Object.values(fp.padNets).some(n => wanted.has(n))).sort((a,b)=>Object.values(b.padNets).filter(n=>wanted.has(n)).length-Object.values(a.padNets).filter(n=>wanted.has(n)).length);
  for (const original of candidates) {
    if (moves.length >= 6) break;
    const own = footprintPads(original, current);
    if (own.some(p => p.def.npth || p.through)) continue;
    if (own.some(p => board.traces.some(t => p.layers.includes(t.layer) && t.points.slice(1).some((b, i) => segRectDist(t.points[i], b, p.rect) <= t.width / 2 + 1e-6)) || board.vias.some(v => segRectDist(v, v, p.rect) <= v.size / 2 + 1e-6))) continue;
    // Existing zone connections also count as wired; don't move them silently.
    if (board.zones.length) continue;
    const others = current.footprints.filter(f => f.id !== original.id);
    const otherPads = allPads({ ...current, footprints: others });
    const score = (fp: BoardFootprint) => {
      const body = footprintBody(fp);
      const corners = [{ x: body.x, y: body.y }, { x: body.x + body.w, y: body.y }, { x: body.x + body.w, y: body.y + body.h }, { x: body.x, y: body.y + body.h }];
      if (!corners.every(p => pointInPolygon(p, board.outline))) return Infinity;
      let penalty = 0;
      for (const other of others) if (other.side === fp.side) {
        const b = footprintBody(other);
        const overlap = Math.max(0, Math.min(body.x + body.w, b.x + b.w) - Math.max(body.x, b.x)) * Math.max(0, Math.min(body.y + body.h, b.y + b.h) - Math.max(body.y, b.y));
        penalty += overlap * 100;
      }
      for (const p of footprintPads(fp, current)) for (const q of otherPads) {
        if (!p.layers.some(l => q.layers.includes(l)) || (p.net && p.net === q.net)) continue;
        const gap = Math.max(rules.minClearance, netClassFor(board, p.net)?.clearance ?? 0, netClassFor(board, q.net)?.clearance ?? 0);
        const distance = rectRectDist(p.rect, q.rect);
        penalty += Math.max(0, gap + .35 - distance) * 20;
      }
      return penalty;
    };
    const initial = score(original);
    if (!(initial > 0)) continue;
    let best = original, bestScore = initial;
    for (let radius = .5; radius <= 2; radius += .5) for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI / 8;
      const fp = { ...original, x: original.x + Math.round(radius * Math.cos(angle) * 4) / 4, y: original.y + Math.round(radius * Math.sin(angle) * 4) / 4 };
      if (Math.hypot(fp.x-original.x,fp.y-original.y)>2+1e-6) continue;
      const value = score(fp) + Math.hypot(fp.x - original.x, fp.y - original.y) * .1;
      if (value < bestScore - 1e-6) { best = fp; bestScore = value; }
    }
    if (best !== original) {
      // Reject any candidate introducing a pad clearance violation; a suggestion must be reviewable as-is.
      const safe = footprintPads(best, current).every(p => otherPads.every(q => !p.layers.some(l => q.layers.includes(l)) || (p.net && p.net === q.net) || rectRectDist(p.rect, q.rect) >= Math.max(rules.minClearance, netClassFor(board, p.net)?.clearance ?? 0, netClassFor(board, q.net)?.clearance ?? 0) - 1e-6));
      const newBody = footprintBody(best), oldBody = footprintBody(original);
      const noNewOverlap = others.every(fp => fp.side !== best.side || rectRectDist(oldBody,footprintBody(fp)) === 0 || rectRectDist(newBody,footprintBody(fp)) > 0);
      const edgeSafe = footprintPads(best,current).every(p => {
        const r=p.rect; const corners=[{x:r.x,y:r.y},{x:r.x+r.w,y:r.y},{x:r.x+r.w,y:r.y+r.h},{x:r.x,y:r.y+r.h}];
        return corners.every(q=>pointInPolygon(q,board.outline)&&board.outline.every((a,i)=>pointSegDist(q,a,board.outline[(i+1)%board.outline.length])>=rules.copperToEdge-1e-6));
      });
      if (!safe || !noNewOverlap || !edgeSafe) continue;
      moves.push({ id: best.id, ref: best.ref, x: best.x, y: best.y, from: { x: original.x, y: original.y } });
      current = { ...current, footprints: current.footprints.map(f => f.id === best.id ? best : f) };
    }
  }
  return moves;
}
