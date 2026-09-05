/**
 * 内置自动布线器：网格 A*，状态 (x, y, 层)，支持过孔换层。
 * 面向 2/4 层创客板；结果作为"建议"返回，由壳层决定是否应用。
 */
import type { Board, CopperLayer, Trace, Via } from '../model/board.js';
import { copperLayers } from '../model/board.js';
import type { RuleSet } from '../model/project.js';
import { RULE_SETS } from '../model/project.js';
import { pointSegDist, type Vec } from '../geometry.js';
import { allPads, boardBounds, netClassFor, type WorldPad } from './geometry.js';
import { computeRatsnest, type RatsnestLine } from './ratsnest.js';

export interface AutorouteOptions {
  grid?: number;
  viaCost?: number;
  maxNodes?: number;
  /** 只布这些网络（空 = 全部未布线） */
  nets?: string[];
}

export interface AutorouteResult {
  traces: Omit<Trace, 'id'>[];
  vias: Omit<Via, 'id'>[];
  routed: number;
  failed: { net: string; reason: string }[];
  total: number;
}

const DIRS: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

class MinHeap {
  private a: { f: number; i: number }[] = [];
  push(f: number, i: number) { const a = this.a; a.push({ f, i }); let k = a.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (a[p].f <= a[k].f) break; [a[p], a[k]] = [a[k], a[p]]; k = p; } }
  pop() { const a = this.a; const top = a[0]; const last = a.pop()!; if (a.length) { a[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < a.length && a[l].f < a[m].f) m = l; if (r < a.length && a[r].f < a[m].f) m = r; if (m === k) break; [a[m], a[k]] = [a[k], a[m]]; k = m; } } return top; }
  get size() { return this.a.length; }
}

export function autoroute(board: Board, rules: RuleSet = RULE_SETS[0], opts: AutorouteOptions = {}): AutorouteResult {
  const g = opts.grid ?? 0.25, viaCost = opts.viaCost ?? 12, maxNodes = opts.maxNodes ?? 400000;
  const layers = copperLayers(board.copperCount);
  const L = layers.length;
  const bb = boardBounds(board);
  const W = Math.ceil(bb.w / g) + 1, H = Math.ceil(bb.h / g) + 1;
  const idx = (x: number, y: number, l: number) => (l * H + y) * W + x;
  const toWorld = (x: number, y: number): Vec => ({ x: bb.x + x * g, y: bb.y + y * g });
  const toCell = (p: Vec) => ({ x: Math.round((p.x - bb.x) / g), y: Math.round((p.y - bb.y) / g) });
  const clearance = rules.minClearance;

  // 占用图：每层一份；值 = 占用该格的网络 id（0 = 空，-1 = 硬障碍）
  const occ = new Int32Array(W * H * L);
  const netIds = new Map<string, number>();
  const netId = (n: string) => { if (!n) return -1; let v = netIds.get(n); if (!v) { v = netIds.size + 1; netIds.set(n, v); } return v; };

  const markRect = (x1: number, y1: number, x2: number, y2: number, ls: CopperLayer[], v: number) => {
    const cx1 = Math.max(0, Math.floor((x1 - bb.x) / g)), cx2 = Math.min(W - 1, Math.ceil((x2 - bb.x) / g));
    const cy1 = Math.max(0, Math.floor((y1 - bb.y) / g)), cy2 = Math.min(H - 1, Math.ceil((y2 - bb.y) / g));
    for (const l of ls) { const li = layers.indexOf(l); if (li < 0) continue; for (let y = cy1; y <= cy2; y++) for (let x = cx1; x <= cx2; x++) occ[idx(x, y, li)] = v; }
  };
  const markSeg = (a: Vec, b: Vec, r: number, ls: CopperLayer[], v: number) => {
    const x1 = Math.min(a.x, b.x) - r, x2 = Math.max(a.x, b.x) + r, y1 = Math.min(a.y, b.y) - r, y2 = Math.max(a.y, b.y) + r;
    const cx1 = Math.max(0, Math.floor((x1 - bb.x) / g)), cx2 = Math.min(W - 1, Math.ceil((x2 - bb.x) / g));
    const cy1 = Math.max(0, Math.floor((y1 - bb.y) / g)), cy2 = Math.min(H - 1, Math.ceil((y2 - bb.y) / g));
    for (const l of ls) { const li = layers.indexOf(l); if (li < 0) continue; for (let y = cy1; y <= cy2; y++) for (let x = cx1; x <= cx2; x++) { const p = toWorld(x, y); if (pointSegDist(p, a, b) <= r) occ[idx(x, y, li)] = v; } }
  };

  // 板边留白
  const edge = rules.copperToEdge;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = toWorld(x, y);
    let inside = false;
    for (let i = 0, j = board.outline.length - 1; i < board.outline.length; j = i++) { const a = board.outline[i], b = board.outline[j]; if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside; }
    let near = false;
    if (inside) for (let i = 0; i < board.outline.length; i++) if (pointSegDist(p, board.outline[i], board.outline[(i + 1) % board.outline.length]) < edge) { near = true; break; }
    if (!inside || near) for (let l = 0; l < L; l++) occ[idx(x, y, l)] = -1;
  }

  const pads = allPads(board);
  const padWidthOf = (net: string) => netClassFor(board, net)?.traceWidth ?? 0.25;
  // 障碍：所有焊盘（含本网络，本网络在起终点处放行）、已有走线、过孔
  for (const p of pads) markRect(p.rect.x - clearance, p.rect.y - clearance, p.rect.x + p.rect.w + clearance, p.rect.y + p.rect.h + clearance, p.layers, netId(p.net) || -1);
  for (const t of board.traces) for (let i = 0; i < t.points.length - 1; i++) markSeg(t.points[i], t.points[i + 1], t.width / 2 + clearance, [t.layer], netId(t.net) || -1);
  for (const v of board.vias) markSeg(v, v, v.size / 2 + clearance, layers, netId(v.net) || -1);

  const initial = computeRatsnest(board, rules);
  const netFilter = (l: RatsnestLine) => !opts.nets?.length || opts.nets.includes(l.net);
  const result: AutorouteResult = { traces: [], vias: [], routed: 0, failed: [], total: initial.lines.filter(netFilter).length };
  const skipped = new Set<string>();
  // 每布通一条就重新计算飞线：新走线并入连通组，后续目标自动变成"最近的已连通铜"
  const nextLine = (): RatsnestLine | null => {
    const cur: Board = { ...board, traces: [...board.traces, ...result.traces.map((t, i) => ({ id: `ar${i}`, ...t }))], vias: [...board.vias, ...result.vias.map((v, i) => ({ id: `av${i}`, ...v }))] };
    const ls = computeRatsnest(cur, rules).lines.filter(netFilter).filter((l) => !skipped.has(`${l.net}|${l.a.x},${l.a.y}|${l.b.x},${l.b.y}`));
    if (!ls.length) return null;
    ls.sort((x, y) => Math.hypot(x.a.x - x.b.x, x.a.y - x.b.y) - Math.hypot(y.a.x - y.b.x, y.a.y - y.b.y));
    return ls[0];
  };
  const padAt = (p: Vec): WorldPad | undefined => pads.find((pd) => Math.abs(pd.center.x - p.x) < 1e-6 && Math.abs(pd.center.y - p.y) < 1e-6);

  for (let guard = 0; guard < result.total * 3 + 10; guard++) {
    const line = nextLine();
    if (!line) break;

    const net = line.net, nid = netId(net);
    const width = padWidthOf(net);
    const halfW = width / 2 + clearance;
    const pa = padAt(line.a), pb = padAt(line.b);
    const startLayers = pa ? pa.layers.map((l) => layers.indexOf(l)).filter((i) => i >= 0) : layers.map((_, i) => i);
    const goalLayers = new Set(pb ? pb.layers.map((l) => layers.indexOf(l)).filter((i) => i >= 0) : layers.map((_, i) => i));
    const s = toCell(line.a), t = toCell(line.b);
    // 目标格集合：终点焊盘覆盖的格子
    const goal = new Set<number>();
    if (pb) { const cx1 = Math.floor((pb.rect.x - bb.x) / g), cx2 = Math.ceil((pb.rect.x + pb.rect.w - bb.x) / g), cy1 = Math.floor((pb.rect.y - bb.y) / g), cy2 = Math.ceil((pb.rect.y + pb.rect.h - bb.y) / g); for (let y = cy1; y <= cy2; y++) for (let x = cx1; x <= cx2; x++) for (const l of goalLayers) goal.add(idx(x, y, l)); }
    for (const l of goalLayers) goal.add(idx(t.x, t.y, l));

    // 走线本身需要 halfW 的空间：检查格子周边是否有异网络占用
    const rad = Math.ceil(halfW / g);
    const free = (x: number, y: number, l: number): boolean => {
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        if (dx * dx + dy * dy > rad * rad + 0.5) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) return false;
        const v = occ[idx(xx, yy, l)];
        if (v !== 0 && v !== nid) return false;
      }
      return true;
    };
    const viaRad = Math.ceil(((netClassFor(board, net)?.viaSize ?? 0.6) / 2 + clearance) / g);
    const viaFree = (x: number, y: number): boolean => {
      for (let l = 0; l < L; l++) for (let dy = -viaRad; dy <= viaRad; dy++) for (let dx = -viaRad; dx <= viaRad; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) return false;
        const v = occ[idx(xx, yy, l)]; if (v !== 0 && v !== nid) return false;
      }
      return true;
    };

    const gScore = new Float64Array(W * H * L).fill(Infinity);
    const came = new Int32Array(W * H * L).fill(-1);
    const heap = new MinHeap();
    const h = (x: number, y: number) => Math.hypot(x - t.x, y - t.y);
    for (const l of startLayers) { const i = idx(s.x, s.y, l); gScore[i] = 0; heap.push(h(s.x, s.y), i); }
    let found = -1, expanded = 0;
    while (heap.size) {
      const { i } = heap.pop();
      if (goal.has(i)) { found = i; break; }
      if (++expanded > maxNodes) break;
      const l = Math.floor(i / (W * H)), y = Math.floor((i % (W * H)) / W), x = i % W;
      const gi = gScore[i];
      for (const [dx, dy, c] of DIRS) {
        const nx = x + dx, ny = y + dy;
        const isCenterGoal = nx === t.x && ny === t.y && goalLayers.has(l);
        if (!free(nx, ny, l) && !isCenterGoal) continue;
        // 对角线不能穿过两个相邻占用格
        if (dx && dy && !free(x + dx, y, l) && !free(x, y + dy, l)) continue;
        const ni = idx(nx, ny, l);
        // 转向惩罚（让走线更直）
        const prev = came[i];
        let turn = 0;
        if (prev >= 0) { const px = prev % W, py = Math.floor((prev % (W * H)) / W); if (x - px !== dx || y - py !== dy) turn = 0.8; }
        // 已有同网络铜上再走线（重叠）加代价，鼓励走空地
        const own = occ[idx(nx, ny, l)] === nid && !goal.has(idx(nx, ny, l)) ? 0.6 : 0;
        const ng = gi + c + turn + own;
        if (ng < gScore[ni]) { gScore[ni] = ng; came[ni] = i; heap.push(ng + h(nx, ny), ni); }
      }
      if (L > 1 && viaFree(x, y)) for (let nl = 0; nl < L; nl++) {
        if (nl === l) continue;
        const ni = idx(x, y, nl); const ng = gi + viaCost;
        if (ng < gScore[ni]) { gScore[ni] = ng; came[ni] = i; heap.push(ng + h(x, y), ni); }
      }
    }
    if (found < 0) { skipped.add(`${net}|${line.a.x},${line.a.y}|${line.b.x},${line.b.y}`); result.failed.push({ net, reason: expanded > maxNodes ? '搜索空间过大' : '没有可用路径' }); continue; }

    // 回溯路径
    const path: { x: number; y: number; l: number }[] = [];
    for (let i = found; i >= 0; i = came[i]) path.push({ l: Math.floor(i / (W * H)), y: Math.floor((i % (W * H)) / W), x: i % W });
    path.reverse();
    // 按层切分为多段，层变化处放过孔；合并共线点
    const firstIdx = result.traces.length;
    let seg: Vec[] = [];
    let curL = path[0].l;
    const flush = () => { if (seg.length >= 2) { const pts = simplify(seg); result.traces.push({ layer: layers[curL], net, width, points: pts }); for (let i = 0; i < pts.length - 1; i++) markSeg(pts[i], pts[i + 1], halfW, [layers[curL]], nid); } seg = []; };
    for (const p of path) {
      if (p.l !== curL) {
        const at = toWorld(p.x, p.y);
        flush();
        const nc = netClassFor(board, net);
        result.vias.push({ x: at.x, y: at.y, size: nc?.viaSize ?? 0.6, drill: nc?.viaDrill ?? 0.3, net });
        markSeg(at, at, (nc?.viaSize ?? 0.6) / 2 + clearance, layers, nid);
        curL = p.l;
        seg = [at];
        continue;
      }
      seg.push(toWorld(p.x, p.y));
    }
    flush();
    // 首末点精确落到焊盘中心（连通性判定），用 45° 折线衔接，避免非 45° 短线
    const near = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
    const bend = (a: Vec, b: Vec): Vec | null => { const dx = b.x - a.x, dy = b.y - a.y, ax = Math.abs(dx), ay = Math.abs(dy); if (ax < 1e-9 || ay < 1e-9 || Math.abs(ax - ay) < 1e-9) return null; const d = Math.min(ax, ay); return { x: a.x + Math.sign(dx) * d, y: a.y + Math.sign(dy) * d }; };
    const first = result.traces[firstIdx], last = result.traces[result.traces.length - 1];
    if (first && !near(first.points[0], line.a)) { const m = bend(line.a, first.points[0]); first.points.unshift(...(m ? [{ ...line.a }, m] : [{ ...line.a }])); }
    if (last && !near(last.points[last.points.length - 1], line.b)) { const m = bend(last.points[last.points.length - 1], line.b); last.points.push(...(m ? [m, { ...line.b }] : [{ ...line.b }])); }
    if (first) first.points = simplify(first.points);
    if (last && last !== first) last.points = simplify(last.points);
    if (!first) { // 仅过孔无走线的极端情况：直接连一段
      result.traces.push({ layer: layers[curL], net, width, points: [{ ...line.a }, { ...line.b }] });
    }
    result.routed++;
  }
  return result;
}

function simplify(pts: Vec[]): Vec[] {
  if (pts.length < 3) return pts;
  const out: Vec[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) > 1e-9) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
