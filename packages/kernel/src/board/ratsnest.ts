import type { Board } from '../model/board.js';
import { UnionFind, dist, pointInRect, type Vec } from '../geometry.js';
import { allPads, type WorldPad } from './geometry.js';
import { zoneFills, pointInFill } from './zones.js';
import type { RuleSet } from '../model/project.js';
import { RULE_SETS } from '../model/project.js';

export interface RatsnestLine { net: string; a: Vec; b: Vec }

export interface RatsnestResult {
  lines: RatsnestLine[];
  /** 总连接数（每个网络 焊盘数-1） */
  total: number;
  unrouted: number;
}

/** 计算铜连通性，返回未布线的飞线（每网络最小生成树的缺失边）。 */
export function computeRatsnest(board: Board, rules: RuleSet = RULE_SETS[0]): RatsnestResult {
  const pads = allPads(board).filter((p) => p.net);
  const uf = new UnionFind();
  const padId = (p: WorldPad, i: number) => `pad:${i}`;
  pads.forEach((p, i) => uf.find(padId(p, i)));

  const traceNode = (ti: number, pi: number) => `tr:${ti}:${pi}`;
  const viaNode = (vi: number) => `via:${vi}`;
  const tol = 0.05;

  board.traces.forEach((t, ti) => {
    for (let i = 0; i < t.points.length - 1; i++) uf.union(traceNode(ti, i), traceNode(ti, i + 1));
    t.points.forEach((pt, i) => {
      const node = traceNode(ti, i);
      pads.forEach((p, pi) => { if (p.layers.includes(t.layer) && (pointInRect(pt, p.rect) || dist(pt, p.center) <= tol)) uf.union(node, padId(p, pi)); });
      board.vias.forEach((v, vi) => { if (dist(pt, v) <= v.size / 2 + tol) uf.union(node, viaNode(vi)); });
      board.traces.forEach((t2, tj) => {
        if (tj === ti || t2.layer !== t.layer) return;
        t2.points.forEach((pt2, j) => { if (dist(pt, pt2) <= tol) uf.union(node, traceNode(tj, j)); });
      });
    });
  });
  board.vias.forEach((v, vi) => pads.forEach((p, pi) => { if (dist(v, p.center) <= tol) uf.union(viaNode(vi), padId(p, pi)); }));
  // 铺铜：落在实铜内的同网络焊盘/过孔互相连通
  zoneFills(board, rules).forEach((fill, zi) => {
    if (!fill.zone.net) return;
    const node = `zone:${zi}`;
    pads.forEach((p, pi) => { if (p.net === fill.zone.net && p.layers.includes(fill.zone.layer) && pointInFill(fill, p.center)) uf.union(node, padId(p, pi)); });
    board.vias.forEach((v, vi) => { if (v.net === fill.zone.net && pointInFill(fill, v)) uf.union(node, viaNode(vi)); });
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
  return { lines, total, unrouted: lines.length };
}
