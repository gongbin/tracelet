/** Independent net-agnostic copper grouping; shares the kernel pad geometry approximation.
 * Anonymous copper participates, so an unassigned bridge cannot hide a short.
 */
import {viaLayers} from './via.js';
import type {Board} from '../model/board.js';
import {UnionFind,dist,rectRectDist,segRectDist,segSegDist,pointSegDist} from '../geometry.js';
import {allPads,type WorldPad} from './geometry.js';
import {zoneFills,pointInFill,traceTouchesPolygon,type ZoneFill} from './zones.js';
import type {RuleSet} from '../model/project.js';
import type {CheckItem} from '../schematic/erc.js';
export function copperShorts(board:Board,rules:RuleSet,fills?:ZoneFill[]):Omit<CheckItem,'id'>[]{
  const pads = allPads(board).filter((p) => !p.def.npth);
  const uf = new UnionFind();
  const padId = (p: WorldPad, i: number) => `pad:${i}`;
  pads.forEach((p, i) => uf.find(padId(p, i)));

  const traceNode = (ti: number, pi: number) => `tr:${ti}:${pi}`;
  const viaNode = (vi: number) => `via:${vi}`;
  const tol = 1e-6;
  const sameNet = (_a: string, _b: string) => true; // Physical contact is independent of net labels.
  // Overlapping duplicate pads (e.g. USB-C A/B contacts) are already connected copper.
  for (let i = 0; i < pads.length; i++) for (let j = i + 1; j < pads.length; j++) {
    const a = pads[i], b = pads[j];
    if (sameNet(a.net, b.net) && a.layers.some(l => b.layers.includes(l)) && rectRectDist(a.rect, b.rect) <= tol) uf.union(padId(a, i), padId(b, j));
  }
  board.traces.forEach((t, ti) => {
    const node = traceNode(ti, 0);
    uf.find(node);
    for (let i = 1; i < t.points.length; i++) {
      const a = t.points[i - 1], b = t.points[i];
      pads.forEach((p, pi) => { if (sameNet(p.net, t.net) && p.layers.includes(t.layer) && segRectDist(a, b, p.rect) <= t.width / 2 + tol) uf.union(node, padId(p, pi)); });
      board.vias.forEach((v, vi) => { if (viaLayers(board,v).includes(t.layer) && sameNet(v.net, t.net) && pointSegDist(v, a, b) <= (t.width + v.size) / 2 + tol) uf.union(node, viaNode(vi)); });
    }
    for (let tj = 0; tj < ti; tj++) {
      const other = board.traces[tj], target = traceNode(tj, 0);
      if (!sameNet(t.net, other.net) || t.layer !== other.layer || uf.find(node) === uf.find(target)) continue;
      let touches = false;
      for (let i = 1; !touches && i < t.points.length; i++) for (let j = 1; j < other.points.length; j++) {
        if (segSegDist(t.points[i - 1], t.points[i], other.points[j - 1], other.points[j]) <= (t.width + other.width) / 2 + tol) { touches = true; break; }
      }
      if (touches) uf.union(node, target);
    }
  });
  board.vias.forEach((v, vi) => {
    pads.forEach((p, pi) => { if (p.layers.some(l=>viaLayers(board,v).includes(l)) && sameNet(v.net, p.net) && segRectDist(v, v, p.rect) <= v.size / 2 + tol) uf.union(viaNode(vi), padId(p, pi)); });
    for (let j = 0; j < vi; j++) if (viaLayers(board,v).some(l=>viaLayers(board,board.vias[j]).includes(l)) && sameNet(v.net, board.vias[j].net) && dist(v, board.vias[j]) <= (v.size + board.vias[j].size) / 2 + tol) uf.union(viaNode(vi), viaNode(j));
  });
  // 铺铜：落在实铜内的同网络焊盘/过孔互相连通
  (fills ?? zoneFills(board, rules)).forEach((fill, zi) => {

    // Each disconnected copper island is its own electrical node.
    fill.polygons.forEach((poly, pi) => {
      const island = { zone: fill.zone, polygons: [poly] };
      const node = `zone:${zi}:${pi}`;
      pads.forEach((p, i) => { if (!p.def.npth && p.layers.includes(fill.zone.layer) && pointInFill(island, p.center)) uf.union(node, padId(p, i)); });
      board.vias.forEach((v, vi) => { if (viaLayers(board,v).includes(fill.zone.layer) && pointInFill(island, v)) uf.union(node, viaNode(vi)); });
      board.traces.forEach((t, ti) => { if (t.layer === fill.zone.layer && traceTouchesPolygon(t, poly)) uf.union(node, traceNode(ti, 0)); });
    });
  });

  const groups=new Map<string,{nets:Set<string>;ids:Set<string>}>();
  const add=(node:string,net:string,id:string)=>{const key=uf.find(node);let g=groups.get(key);if(!g){g={nets:new Set(),ids:new Set()};groups.set(key,g);}if(net)g.nets.add(net);g.ids.add(id);};
  pads.forEach((p,i)=>add(padId(p,i),p.net,p.footprintId));
  board.traces.forEach((t,i)=>add(traceNode(i,0),t.net,t.id));
  board.vias.forEach((v,i)=>add(viaNode(i),v.net,v.id));
  (fills??zoneFills(board,rules)).forEach((f,i)=>f.polygons.forEach((_,j)=>add(`zone:${i}:${j}`,f.zone.net,f.zone.id)));
  return [...groups.values()].filter(g=>g.nets.size>1).map(g=>({rule:'copper-short',severity:'error' as const,message:'Physical copper connects different nets: '+[...g.nets].sort().join(', '),why:'Connectivity is checked without filtering contact by net names.',refs:[...g.nets].sort(),objectIds:[...g.ids]}));
}
