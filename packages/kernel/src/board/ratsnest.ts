import { viaLayers } from './via.js';
import type { Board, CopperLayer } from '../model/board.js';
import { UnionFind, dist, rectRectDist, segRectDist, segSegDist, pointSegDist, type Vec } from '../geometry.js';
import { allPads, type WorldPad } from './geometry.js';
import { copperLayers } from '../model/board.js';
import { zoneFills, pointInFill, traceTouchesPolygon, type ZoneFill } from './zones.js';
import type { RuleSet } from '../model/project.js';
import { RULE_SETS } from '../model/project.js';

export interface RatsnestLine { net: string; a: Vec; b: Vec }

export interface RatsnestResult {
  lines: RatsnestLine[];
  /** Electrically connected copper anchors for multi-source routing. */
  components?: { net: string; pads: Vec[]; anchors: { point: Vec; layers: CopperLayer[] }[] }[];
  /** 总连接数（每个网络 焊盘数-1） */
  total: number;
  unrouted: number;
}

/** 计算铜连通性，返回未布线的飞线（每网络最小生成树的缺失边）。 */
export function computeRatsnest(board: Board, rules: RuleSet = RULE_SETS[0], fills?: ZoneFill[]): RatsnestResult {
  const pads = allPads(board).filter((p) => p.net && !p.def.npth);
  const uf = new UnionFind();
  const padId = (p: WorldPad, i: number) => `pad:${i}`;
  pads.forEach((p, i) => uf.find(padId(p, i)));

  const traceNode = (ti: number, pi: number) => `tr:${ti}:${pi}`;
  const viaNode = (vi: number) => `via:${vi}`;
  const tol = 1e-6;
  const sameNet = (a: string, b: string) => !!a && a === b;
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
    if (!fill.zone.net) return;
    // Each disconnected copper island is its own electrical node.
    fill.polygons.forEach((poly, pi) => {
      const island = { zone: fill.zone, polygons: [poly] };
      const node = `zone:${zi}:${pi}`;
      pads.forEach((p, i) => { if (!p.def.npth && p.net === fill.zone.net && p.layers.includes(fill.zone.layer) && pointInFill(island, p.center)) uf.union(node, padId(p, i)); });
      board.vias.forEach((v, vi) => { if (viaLayers(board,v).includes(fill.zone.layer) && v.net === fill.zone.net && pointInFill(island, v)) uf.union(node, viaNode(vi)); });
      board.traces.forEach((t, ti) => { if (t.net === fill.zone.net && t.layer === fill.zone.layer && traceTouchesPolygon(t, poly)) uf.union(node, traceNode(ti, 0)); });
    });
  });

  const byNet = new Map<string, { pad: WorldPad; node: string }[]>();
  pads.forEach((p, i) => { if (!byNet.has(p.net)) byNet.set(p.net, []); byNet.get(p.net)!.push({ pad: p, node: padId(p, i) }); });

  const lines: RatsnestLine[] = [];
  let total = 0;
  for (const [net, list] of byNet) {
    if (list.length < 2) continue;
    total += list.length - 1;
    // Kruskal：在已连通的组之间加最短边
    const edges: { a: number; b: number; d: number }[] = [];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) edges.push({ a: i, b: j, d: dist(list[i].pad.center, list[j].pad.center) });
    edges.sort((x, y) => x.d - y.d);
    const local = new UnionFind();
    list.forEach((x, i) => local.union(`n${i}`, uf.find(x.node)));
    for (const e of edges) {
      if (local.find(`n${e.a}`) === local.find(`n${e.b}`)) continue;
      local.union(`n${e.a}`, `n${e.b}`);
      lines.push({ net, a: list[e.a].pad.center, b: list[e.b].pad.center });
    }
  }
  const components = new Map<string, { net: string; pads: Vec[]; anchors: { point: Vec; layers: CopperLayer[] }[] }>();
  pads.forEach((p, i) => {
    const root = uf.find(padId(p, i)); let c = components.get(root);
    if (!c) { c = { net: p.net, pads: [], anchors: [] }; components.set(root, c); }
    c.pads.push(p.center); c.anchors.push({ point: p.center, layers: p.layers });
  });
  board.traces.forEach((t, i) => { const c = components.get(uf.find(traceNode(i, 0))); if (c) for (const point of t.points) c.anchors.push({ point, layers: [t.layer] }); });
  board.vias.forEach((v, i) => { const c = components.get(uf.find(viaNode(i))); if (c) c.anchors.push({ point: v, layers: viaLayers(board,v) }); });
  return { lines, total, unrouted: lines.length, components: [...components.values()] };
}
