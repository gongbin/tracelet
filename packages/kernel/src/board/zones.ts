import pc from 'polygon-clipping';
import type { Board, Zone } from '../model/board.js';
import type { RuleSet } from '../model/project.js';
import { RULE_SETS } from '../model/project.js';
import { pointInPolygon, type Vec } from '../geometry.js';
import { allPads, netClassFor } from './geometry.js';
import { circlePoly, stadiumPoly, expandedRectPoly, rectPoly, type MultiPolygon, type Ring } from './shapes.js';

type PcRing = [number, number][];
type PcMulti = PcRing[][];
const toPc = (r: Ring): PcRing => r.map((p) => [p.x, p.y]);
const fromPc = (m: PcMulti): MultiPolygon => m.map((poly) => poly.map((ring) => ring.slice(0, -1).map(([x, y]) => ({ x, y }))));
const closed = (r: PcRing): PcRing => (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) ? [...r, r[0]] : r);

export interface ZoneFill { zone: Zone; polygons: MultiPolygon }

/**
 * 铺铜填充：区域 ∩ 板内区域 − 异网络铜（焊盘/走线/过孔）膨胀间距 − 板边留白，然后移除不与本网络相连的孤岛。
 * 同网络焊盘直接实心连接（热焊盘在后续里程碑）。
 */
export function fillZone(board: Board, zone: Zone, rules: RuleSet): MultiPolygon {
  const nc = netClassFor(board, zone.net);
  const clearance = zone.clearance && zone.clearance > 0 ? Math.max(rules.minClearance, zone.clearance) : Math.max(rules.minClearance, nc?.clearance ?? 0.2);
  const pads = allPads(board);

  const zonePoly: PcMulti = [[closed(toPc(zone.polygon))]];
  const outline = closed(toPc(board.outline));
  const edgeBands: PcMulti = [];
  for (let i = 0; i < board.outline.length; i++) edgeBands.push([closed(toPc(stadiumPoly(board.outline[i], board.outline[(i + 1) % board.outline.length], rules.copperToEdge)))]);
  let area: PcMulti;
  try {
    const inside = edgeBands.length ? pc.difference([[outline]], ...edgeBands) : [[outline]];
    area = pc.intersection(zonePoly, inside);
  } catch { return []; }
  if (area.length === 0) return [];

  const obstacles: PcMulti = [];
  for (const p of pads) {
    if (!p.layers.includes(zone.layer)) continue;
    if (p.net && p.net === zone.net) {
      // 热焊盘：焊盘外围留 gap 环，只保留 4 条辐条连接
      if ((zone.thermal ?? 'relief') === 'relief') {
        const gap = zone.thermalGap ?? 0.3, sw = zone.spokeWidth ?? 0.4;
        const ring: PcMulti = [[closed(toPc(expandedRectPoly(p.rect, gap)))]];
        const L = Math.max(p.rect.w, p.rect.h) / 2 + gap + 0.05;
        const spokes: PcMulti = [
          [closed(toPc(rectPoly({ x: p.center.x - L, y: p.center.y - sw / 2, w: 2 * L, h: sw })))],
          [closed(toPc(rectPoly({ x: p.center.x - sw / 2, y: p.center.y - L, w: sw, h: 2 * L })))]
        ];
        try { const relief = pc.difference(ring, ...spokes); for (const poly of relief) obstacles.push(poly); } catch { /* 忽略退化情况 */ }
      }
      continue;
    }
    obstacles.push([closed(toPc(expandedRectPoly(p.rect, clearance)))]);
  }
  for (const t of board.traces) {
    if (t.layer !== zone.layer || (t.net && t.net === zone.net)) continue;
    for (let i = 0; i < t.points.length - 1; i++) obstacles.push([closed(toPc(stadiumPoly(t.points[i], t.points[i + 1], t.width / 2 + clearance)))]);
  }
  for (const v of board.vias) {
    if (v.net && v.net === zone.net) continue;
    obstacles.push([closed(toPc(circlePoly(v, v.size / 2 + clearance)))]);
  }

  let fill: PcMulti;
  try { fill = obstacles.length ? pc.difference(area, ...obstacles) : area; } catch { return []; }
  const result = fromPc(fill);
  if (!zone.net) return result;

  // 孤岛移除：保留包含同网络焊盘/过孔的多边形
  const anchors: Vec[] = [
    ...pads.filter((p) => p.net === zone.net && p.layers.includes(zone.layer)).map((p) => p.center),
    ...board.vias.filter((v) => v.net === zone.net).map((v) => ({ x: v.x, y: v.y }))
  ];
  return result.filter((poly) => anchors.some((a) => pointInPolygon(a, poly[0]) && !poly.slice(1).some((hole) => pointInPolygon(a, hole))));
}

const cache = new WeakMap<Board, Map<string, ZoneFill[]>>();

export function zoneFills(board: Board, rules: RuleSet = RULE_SETS[0]): ZoneFill[] {
  let m = cache.get(board);
  if (!m) { m = new Map(); cache.set(board, m); }
  const hit = m.get(rules.id);
  if (hit) return hit;
  const fills = board.zones.map((zone) => ({ zone, polygons: fillZone(board, zone, rules) }));
  m.set(rules.id, fills);
  return fills;
}

/** 点是否落在某个网络的铺铜实铜上（用于连通性）。 */
export function pointInFill(fill: ZoneFill, p: Vec): boolean {
  return fill.polygons.some((poly) => pointInPolygon(p, poly[0]) && !poly.slice(1).some((hole) => pointInPolygon(p, hole)));
}
