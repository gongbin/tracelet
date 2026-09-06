/** Shared, explicit engineering recommendations. Missing values are never guessed. */
import type { Board, CopperLayer, Trace } from '../model/board.js';
import { copperLayers } from '../model/board.js';
import { netClassFor } from './geometry.js';
import { pointSegDist, segSegDist, type Vec } from '../geometry.js';
import { pointInFill, type ZoneFill } from './zones.js';

export function engineeringRules(board: Board, net: string) {
  const nc = netClassFor(board, net);
  return { ...nc?.engineering, referenceLayer: nc?.referenceLayer, referenceNet: nc?.referenceNet };
}
export function isPairPartner(board: Board, a: string, b: string) {
  return (board.differentialPairs ?? []).some(p => p.positive === a && p.negative === b || p.negative === a && p.positive === b);
}
/** Continuous segment coverage within ONE copper island; reject intersections with holes/edges. */
export function referenceSupports(board: Board, fills: ZoneFill[], net: string, layer: CopperLayer, a: Vec, b: Vec, halfWidth: number): boolean {
  const r = engineeringRules(board, net), layers = copperLayers(board.copperCount);
  if (!r.referenceLayer || !r.referenceNet || Math.abs(layers.indexOf(layer)-layers.indexOf(r.referenceLayer)) !== 1) return false;
  const margin = halfWidth + (r.referenceMargin ?? 0);
  return fills.some(fill => fill.zone.layer === r.referenceLayer && fill.zone.net === r.referenceNet && fill.polygons.some(poly => {
    const island = {zone:fill.zone,polygons:[poly]};
    if (!pointInFill(island,a) || !pointInFill(island,b)) return false;
    return poly.every(ring => ring.every((p,i) => segSegDist(a,b,p,ring[(i+1)%ring.length]) > margin + 1e-6));
  }));
}
/** Length of overlapping projections for nearly parallel segments within recommended copper-edge spacing. */
export function closeParallelLength(a: Vec,b: Vec,c: Vec,d: Vec, distance: number): number {
  const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy),ex=d.x-c.x,ey=d.y-c.y,other=Math.hypot(ex,ey);
  if(len<1e-9||other<1e-9||Math.abs(dx*ey-dy*ex)>len*other*.01)return 0;
  if(segSegDist(a,b,c,d)>=distance-1e-6)return 0;
  const u=((c.x-a.x)*dx+(c.y-a.y)*dy)/len,v=((d.x-a.x)*dx+(d.y-a.y)*dy)/len;
  return Math.max(0,Math.min(len,Math.max(u,v))-Math.max(0,Math.min(u,v)));
}
/** Soft cost against existing copper; hard clearances remain the router's responsibility. */
export function neighborCost(board: Board, net: string, layer: CopperLayer, p: Vec, width: number, traces: readonly Trace[]): number {
  const own=engineeringRules(board,net).preferredClearance;
  let cost=0;
  for(const t of traces){
    if(t.net===net||t.layer!==layer||isPairPartner(board,net,t.net))continue;
    const preferred=Math.max(own??0,engineeringRules(board,t.net).preferredClearance??0);
    if(!preferred)continue;
    for(let i=1;i<t.points.length;i++){
      const gap=pointSegDist(p,t.points[i-1],t.points[i])-(width+t.width)/2;
      cost=Math.max(cost,Math.max(0,1-gap/preferred)*2);
    }
  }
  return cost;
}
