import type { Board, BoardFootprint } from '../model/board.js';
import { footprintBody, footprintPads } from './geometry.js';
import { netRules } from './routingModel.js';
import { pointSegDist, rotate, pointInPolygon, segRectDist, type Rect, type Vec } from '../geometry.js';

/** Explicit constraints only. Heuristics must never become hidden mechanical constraints. */
export function placementConstraintErrors(board: Board): string[] {
  const errors: string[] = [];
  for (const f of board.footprints) {
    if (!edgePlacementFits(f, board)) errors.push(f.ref + ': connector edge or mating direction');
    const t = f.placement?.target;
    if (!t) continue;
    const target = board.footprints.find(p => p.id === t.footprintId);
    const pin = target && footprintPads(target, board).find(p => p.number === t.pad && !p.def.npth);
    const mine = footprintPads(f, board).filter(p => !p.def.npth && pin?.net && p.net === pin.net);
    if (!pin || target?.id === f.id || !mine.length) errors.push(f.ref + ': invalid target pad or net');
    else if (Math.min(...mine.map(p => Math.hypot(p.center.x - pin.center.x, p.center.y - pin.center.y))) > t.maxDistance + 1e-6)
      errors.push(f.ref + ': target pad distance');
  }
  return errors;
}

export function edgePlacementFits(f: BoardFootprint, board: Board): boolean {
  const edge = f.placement?.edge;
  if (!edge) return true;
  const a = board.outline[edge.index], b = board.outline[(edge.index + 1) % board.outline.length];
  if (!a || !b || Math.hypot(b.x-a.x,b.y-a.y) < 1e-9) return false;
  const r = footprintBody(f), center = { x:r.x+r.w/2, y:r.y+r.h/2 };
  const v = rotate({x:1,y:0}, edge.direction);
  const direction = rotate({x:f.side === 'B' ? -v.x : v.x, y:v.y}, f.rotation);
  const area = board.outline.reduce((n,p,i) => {const q=board.outline[(i+1)%board.outline.length]; return n+p.x*q.y-q.x*p.y;},0);
  const length = Math.hypot(b.x-a.x,b.y-a.y);
  const outward = {x:(b.y-a.y)/length * Math.sign(area), y:-(b.x-a.x)/length * Math.sign(area)};
  const support = Math.abs(outward.x)*r.w/2 + Math.abs(outward.y)*r.h/2;
  return direction.x*outward.x + direction.y*outward.y >= Math.cos(Math.PI/4)-1e-6
    && pointSegDist(center,a,b) - support <= edge.distance + 1e-6;
}

/** Broad-phase sweep over conservative copper bounds of different components. */
export function placementCopperClear(board: Board, rules: import('../model/project.js').RuleSet): boolean {
  const ps = board.footprints.flatMap(f => footprintPads(f, board)).filter(p => !p.def.npth);
  const clearance = new Map(ps.map(p => [p, netRules(board, rules, p.net).clearance]));
  const maxGap = Math.max(rules.minClearance, ...clearance.values());
  ps.sort((a,b)=>a.rect.x-b.rect.x);
  for(let i=0;i<ps.length;i++) {
    const a=ps[i];
    for(let j=i+1;j<ps.length;j++) {
      const b=ps[j];
      if(b.rect.x > a.rect.x+a.rect.w+maxGap) break;
      if(a.footprintId===b.footprintId || (a.net && a.net===b.net) || !a.layers.some(l=>b.layers.includes(l))) continue;
      const dx=Math.max(0,b.rect.x-a.rect.x-a.rect.w);
      const dy=Math.max(0,b.rect.y-a.rect.y-a.rect.h,a.rect.y-b.rect.y-b.rect.h);
      if(Math.hypot(dx,dy)<Math.max(clearance.get(a)!,clearance.get(b)!)-1e-6) return false;
    }
  }
  return true;
}

/** AABB containment including concave notches: corners alone are insufficient. */
export function bodyInsideOutline(r: Rect, outline: Vec[]): boolean {
  if(outline.length<3)return true;
  if(![{x:r.x,y:r.y},{x:r.x+r.w,y:r.y},{x:r.x+r.w,y:r.y+r.h},{x:r.x,y:r.y+r.h}].every(p=>pointInPolygon(p,outline)))return false;
  const e=1e-5;
  if(r.w<=2*e||r.h<=2*e)return true;
  const interior={x:r.x+e,y:r.y+e,w:r.w-2*e,h:r.h-2*e};
  return !outline.some((a,i)=>segRectDist(a,outline[(i+1)%outline.length],interior)<1e-7);
}
