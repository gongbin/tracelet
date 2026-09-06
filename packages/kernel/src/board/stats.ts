import type { Board, CopperLayer } from '../model/board.js';
import type { Vec } from '../geometry.js';

export interface NetLengthStat { net: string; /** 铜走线总长 mm */ length: number; segments: number; vias: number; byLayer: Partial<Record<CopperLayer, number>> }
export interface TraceLengthStats { nets: NetLengthStat[]; /** 全板走线总长 mm */ total: number; traces: number; vias: number; /** 没有网络名的走线长度 */ unassigned: number }

/** 折线长度（mm）。 */
export function polylineLength(points: Vec[]): number {
  let n = 0;
  for (let i = 1; i < points.length; i++) n += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return n;
}

/** 按网络统计走线长度 / 段数 / 过孔数，按长度降序；数值保留 0.01 mm。 */
export function traceLengthStats(board: Board): TraceLengthStats {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const map = new Map<string, NetLengthStat>();
  const get = (net: string) => { let s = map.get(net); if (!s) { s = { net, length: 0, segments: 0, vias: 0, byLayer: {} }; map.set(net, s); } return s; };
  let unassigned = 0;
  for (const t of board.traces) {
    const len = polylineLength(t.points);
    if (!t.net) { unassigned += len; continue; }
    const s = get(t.net); s.length += len; s.segments += Math.max(0, t.points.length - 1); s.byLayer[t.layer] = (s.byLayer[t.layer] ?? 0) + len;
  }
  for (const v of board.vias) if (v.net) get(v.net).vias++;
  const nets = [...map.values()].map((s) => ({ ...s, length: r2(s.length), byLayer: Object.fromEntries(Object.entries(s.byLayer).map(([k, v]) => [k, r2(v!)])) as NetLengthStat['byLayer'] })).sort((a, b) => b.length - a.length || a.net.localeCompare(b.net));
  const total = r2(nets.reduce((n, s) => n + s.length, 0) + unassigned);
  return { nets, total, traces: board.traces.length, vias: board.vias.length, unassigned: r2(unassigned) };
}
