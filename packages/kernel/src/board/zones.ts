import { viaLayers, backdrillLayers } from './via.js';
import pc from 'polygon-clipping';
import type { Board, Zone, Trace } from '../model/board.js';
import type { RuleSet } from '../model/project.js';
import { RULE_SETS } from '../model/project.js';
import { pointInPolygon, segSegDist, type Vec } from '../geometry.js';
import { allPads, netClassFor } from './geometry.js';
import { circlePoly, stadiumPoly, expandedRectPoly, rectPoly, type MultiPolygon, type Polygon, type Ring } from './shapes.js';

type PcRing = [number, number][];
type PcMulti = PcRing[][];
const toPc = (r: Ring): PcRing => r.map((p) => [p.x, p.y]);
const fromPc = (m: PcMulti): MultiPolygon => m.map((poly) => poly.map((ring) => ring.slice(0, -1).map(([x, y]) => ({ x, y }))));
const closed = (r: PcRing): PcRing => (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) ? [...r, r[0]] : r);

export interface ZoneFill { zone: Zone; polygons: MultiPolygon }

/**
 * 铺铜填充：区域 ∩ 板内区域 − 异网络铜（焊盘/走线/过孔）膨胀间距 − 板边留白，然后移除不与本网络相连的孤岛。
 * 支持实心 / 热焊盘连接；孤岛可通过同层同网络走线连接。
 */
export function fillZone(board: Board, zone: Zone, rules: RuleSet): MultiPolygon {
  return fillPreparedZone(board, zone, rules, allPads(board), boardInterior(board, rules));
}

function boardInterior(board: Board, rules: RuleSet): PcMulti {
  if (board.outline.length < 3) return [];
  const outline = closed(toPc(board.outline));
  if (rules.copperToEdge <= 0) return [[outline]];
  const bands: PcMulti = board.outline.map((a, i) => [closed(toPc(stadiumPoly(a, board.outline[(i + 1) % board.outline.length], rules.copperToEdge)))]);
  try { return pc.difference([[outline]], bands); } catch { return []; }
}

function fillPreparedZone(board: Board, zone: Zone, rules: RuleSet, pads: ReturnType<typeof allPads>, inside: PcMulti): MultiPolygon {
  if (zone.polygon.length < 3 || !inside.length) return [];
  const nc = netClassFor(board, zone.net);
  const clearance = Math.max(rules.minClearance, zone.clearance ?? 0, nc?.clearance ?? 0.2);

  const ring = zone.polygon.filter((p, i, a) => !i || Math.hypot(p.x - a[i - 1].x, p.y - a[i - 1].y) > 1e-9);
  if (ring.length < 3) return [];
  const zonePoly: PcMulti = [[closed(toPc(ring))]];
  let area: PcMulti;
  try {
    area = pc.intersection(zonePoly, inside);
  } catch { return []; }
  if (area.length === 0) return [];

  const obstacles: PcMulti = [];
  for (const p of pads) {
    if (!p.layers.includes(zone.layer)) continue;
    if (!p.def.npth && p.net && p.net === zone.net) {
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
    obstacles.push([closed(toPc(expandedRectPoly(p.rect, Math.max(clearance, netClassFor(board, p.net)?.clearance ?? 0))))]);
  }
  for (const t of board.traces) {
    if (t.layer !== zone.layer || (t.net && t.net === zone.net)) continue;
    for (let i = 0; i < t.points.length - 1; i++) if (Math.hypot(t.points[i + 1].x - t.points[i].x, t.points[i + 1].y - t.points[i].y) > 1e-9) obstacles.push([closed(toPc(stadiumPoly(t.points[i], t.points[i + 1], t.width / 2 + Math.max(clearance, netClassFor(board, t.net)?.clearance ?? 0))))]);
  }
  for (const v of board.vias) {
    if (backdrillLayers(board,v).includes(zone.layer)) { obstacles.push([closed(toPc(circlePoly(v, v.backdrill!.diameter / 2 + clearance)))]); continue; }
    if (!viaLayers(board,v).includes(zone.layer)) continue;
    if (v.net && v.net === zone.net) continue;
    obstacles.push([closed(toPc(circlePoly(v, v.size / 2 + Math.max(clearance, netClassFor(board, v.net)?.clearance ?? 0))))]);
  }

  let fill: PcMulti;
  try { fill = obstacles.length ? pc.difference(area, obstacles) : area; }
  catch {
    // 多边形裁剪库偶尔在近乎重合的边上失败（导入的板常见重叠走线）：退化为分批 / 逐个相减，跳过出错的障碍
    fill = area;
    const CH = 64;
    for (let i = 0; i < obstacles.length; i += CH) {
      const batch = obstacles.slice(i, i + CH);
      try { fill = pc.difference(fill, batch); }
      catch { for (const ob of batch) { try { fill = pc.difference(fill, [ob]); } catch { /* 跳过 */ } } }
      if (!fill.length) break;
    }
  }
  const result = fromPc(fill);
  if (!zone.net) return result;

  // 孤岛移除：保留连接同网络焊盘、过孔或同层走线的铜块
  const anchors: Vec[] = [
    ...pads.filter((p) => !p.def.npth && p.net === zone.net && p.layers.includes(zone.layer)).map((p) => p.center),
    ...board.vias.filter((v) => v.net === zone.net && viaLayers(board,v).includes(zone.layer)).map((v) => ({ x: v.x, y: v.y }))
  ];
  const traces = board.traces.filter((t) => t.net === zone.net && t.layer === zone.layer);
  return result.filter((poly) => anchors.some((a) => pointInCopper(poly, a)) || traces.some((t) => traceTouchesPolygon(t, poly)));
}

const cache = new WeakMap<Board, Map<string, ZoneFill[]>>();

export function zoneFills(board: Board, rules: RuleSet = RULE_SETS[0]): ZoneFill[] {
  let m = cache.get(board);
  if (!m) { m = new Map(); cache.set(board, m); }
  // Rule IDs remain stable while users edit their actual constraints.
  const key = `${rules.minClearance}|${rules.copperToEdge}`;
  const hit = m.get(key);
  if (hit) return hit;
  if (!board.zones.length) { m.set(key, []); return m.get(key)!; }
  const pads = allPads(board), inside = boardInterior(board, rules);
  const fills = board.zones.map((zone) => ({ zone, polygons: fillPreparedZone(board, zone, rules, pads, inside) }));
  m.set(key, fills);
  return fills;
}

/** 点是否落在某个网络的铺铜实铜上（用于连通性）。 */
export function pointInFill(fill: ZoneFill, p: Vec): boolean {
  return fill.polygons.some((poly) => pointInCopper(poly, p));
}

function pointInCopper(poly: Polygon, p: Vec): boolean {
  return pointInPolygon(p, poly[0]) && !poly.slice(1).some((hole) => pointInPolygon(p, hole));
}

/** Includes contact along the segment body, even if both endpoints lie outside the zone. */
export function traceTouchesPolygon(trace: Pick<Trace, 'points' | 'width'>, poly: Polygon): boolean {
  if (trace.points.some((p) => pointInCopper(poly, p))) return true;
  for (let i = 1; i < trace.points.length; i++) {
    for (const ring of poly) for (let j = 0; j < ring.length; j++) {
      if (segSegDist(trace.points[i - 1], trace.points[i], ring[j], ring[(j + 1) % ring.length]) <= trace.width / 2 + 1e-9) return true;
    }
  }
  return false;
}
