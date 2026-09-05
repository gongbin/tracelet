/**
 * 内置自动布线器：网格 A*，状态 (x, y, 层)，支持过孔换层。
 * - 空间索引检查真实铜几何，细间距焊盘预留出线通道，必要时局部收窄至焊盘宽度
 * - 每布通一条就重新计算飞线：新走线并入连通组，后续目标自动变成最近的已连通铜
 * - 结果作为"建议"返回，由壳层决定是否应用
 */
import type { Board, CopperLayer, Trace, Via } from '../model/board.js';
import { copperLayers } from '../model/board.js';
import type { RuleSet } from '../model/project.js';
import { RULE_SETS } from '../model/project.js';
import { pointSegDist, pointInPolygon, segRectDist, segSegDist, type Vec } from '../geometry.js';
import { allPads, boardBounds, netClassFor, type WorldPad } from './geometry.js';
import { computeRatsnest, type RatsnestLine } from './ratsnest.js';
import { suggestRoutingMoves, type RoutingMove } from './routingPlacement.js';
import { RoutingSpace } from './routingSpace.js';
import { zoneFills, traceTouchesPolygon } from './zones.js';

export interface AutorouteOptions {
  grid?: number;
  /** Allow bounded, preview-only relocation of unwired components after a failed routing pass. */
  allowComponentMoves?: boolean;
  /** 过孔代价（以格为单位；12 格 ≈ 3mm 走线） */
  viaCost?: number;
  maxNodes?: number;
  /** 只布这些网络（空 = 全部未布线） */
  nets?: string[];
  onProgress?: (done: number, total: number, net: string) => void;
  /** 优先布这些网络（第二轮重试用） */
  priorityNets?: string[];
  /** 内部：禁止再做第二轮 */
  noRetry?: boolean;
}

export interface AutorouteResult {
  moves?: RoutingMove[];
  traces: Omit<Trace, 'id'>[];
  vias: Omit<Via, 'id'>[];
  routed: number;
  failed: { net: string; reason: string }[];
  total: number;
  ms: number;
}

const DIRS: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

class MinHeap {
  private a: { f: number; i: number }[] = [];
  push(f: number, i: number) { const a = this.a; a.push({ f, i }); let k = a.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (a[p].f <= a[k].f) break; [a[p], a[k]] = [a[k], a[p]]; k = p; } }
  pop() { const a = this.a; const top = a[0]; const last = a.pop()!; if (a.length) { a[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < a.length && a[l].f < a[m].f) m = l; if (r < a.length && a[r].f < a[m].f) m = r; if (m === k) break; [a[m], a[k]] = [a[k], a[m]]; k = m; } } return top; }
  get size() { return this.a.length; }
  clear() { this.a.length = 0; }
}

export function autoroute(board: Board, rules: RuleSet = RULE_SETS[0], opts: AutorouteOptions = {}): AutorouteResult {
  const t0 = Date.now();
  const fills = zoneFills(board, rules);
  const netFilter = (l: RatsnestLine) => !opts.nets?.length || opts.nets.includes(l.net);
  const initial = computeRatsnest(board, rules, fills);
  const result: AutorouteResult = { traces: [], vias: [], routed: 0, failed: [], total: initial.lines.filter(netFilter).length, ms: 0 };
  if (!result.total) { result.ms = Date.now() - t0; return result; }
  const padsAll = allPads(board);
  // 自适应网格：按异网络相邻焊盘的最小中心距选择（细间距器件需要更细的网格）
  const g = opts.grid ?? pickGrid(padsAll);
  const viaCost = opts.viaCost ?? Math.round(3 / g), maxNodes = opts.maxNodes ?? 200000;
  const layers = copperLayers(board.copperCount);
  const L = layers.length;
  const bb = boardBounds(board);
  const W = Math.ceil(bb.w / g) + 1, H = Math.ceil(bb.h / g) + 1;
  const N = W * H;
  const idx = (x: number, y: number, l: number) => (l * H + y) * W + x;
  const toWorld = (x: number, y: number): Vec => ({ x: bb.x + x * g, y: bb.y + y * g });
  const toCell = (p: Vec) => ({ x: Math.round((p.x - bb.x) / g), y: Math.round((p.y - bb.y) / g) });

  // 占用图：值 = 网络 id（0 空，-1 硬障碍 / 无网络铜）
  const occ = new Int32Array(N * L);
  const space = new RoutingSpace(board, rules);
  space.reserveEscapes();
  const edgeDistance = new Float32Array(N);
  // Copper rasterization must never erase a board-edge or overlapping-net obstacle.
  const markCell = (i: number, value: number) => {
    const old = occ[i];
    occ[i] = old === 0 || old === value ? value : -1;
  };
  const netIds = new Map<string, number>();
  const netId = (n: string) => { if (!n) return -1; let v = netIds.get(n); if (!v) { v = netIds.size + 1; netIds.set(n, v); } return v; };
  const layerIdx = (l: CopperLayer) => layers.indexOf(l);

  // 标记矩形（按格中心是否落在 [x1,x2]×[y1,y2]，四周各放宽半格保证细焊盘至少占一格）
  const markRect = (x1: number, y1: number, x2: number, y2: number, ls: CopperLayer[], v: number) => {
    const cx1 = Math.max(0, Math.ceil((x1 - g / 2 - bb.x) / g)), cx2 = Math.min(W - 1, Math.floor((x2 + g / 2 - bb.x) / g));
    const cy1 = Math.max(0, Math.ceil((y1 - g / 2 - bb.y) / g)), cy2 = Math.min(H - 1, Math.floor((y2 + g / 2 - bb.y) / g));
    for (const l of ls) { const li = layerIdx(l); if (li < 0) continue; for (let y = cy1; y <= cy2; y++) for (let x = cx1; x <= cx2; x++) markCell(idx(x, y, li), v); }
  };
  const markSeg = (a: Vec, b: Vec, r: number, ls: CopperLayer[], v: number) => {
    const rr = r + g / 2;
    const x1 = Math.min(a.x, b.x) - rr, x2 = Math.max(a.x, b.x) + rr, y1 = Math.min(a.y, b.y) - rr, y2 = Math.max(a.y, b.y) + rr;
    const cx1 = Math.max(0, Math.floor((x1 - bb.x) / g)), cx2 = Math.min(W - 1, Math.ceil((x2 - bb.x) / g));
    const cy1 = Math.max(0, Math.floor((y1 - bb.y) / g)), cy2 = Math.min(H - 1, Math.ceil((y2 - bb.y) / g));
    for (const l of ls) { const li = layerIdx(l); if (li < 0) continue; for (let y = cy1; y <= cy2; y++) for (let x = cx1; x <= cx2; x++) { const p = toWorld(x, y); if (pointSegDist(p, a, b) <= rr) markCell(idx(x, y, li), v); } }
  };

  // 板外 / 板边留白 = 硬障碍
  const edge = rules.copperToEdge;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = toWorld(x, y);
    const inside = pointInPolygon(p, board.outline);
    let distance = Infinity;
    if (inside) for (let i = 0; i < board.outline.length; i++) distance = Math.min(distance, pointSegDist(p, board.outline[i], board.outline[(i + 1) % board.outline.length]));
    edgeDistance[y * W + x] = inside ? distance : -1;
    const near = distance < edge;
    if (!inside || near) for (let l = 0; l < L; l++) occ[idx(x, y, l)] = -1;
  }

  const pads = padsAll;
  for (const p of pads) markRect(p.rect.x, p.rect.y, p.rect.x + p.rect.w, p.rect.y + p.rect.h, p.layers, p.def.npth ? -1 : netId(p.net) || -1);
  for (const t of board.traces) for (let i = 0; i < t.points.length - 1; i++) markSeg(t.points[i], t.points[i + 1], t.width / 2, [t.layer], netId(t.net) || -1);
  for (const v of board.vias) markSeg(v, v, v.size / 2, layers, netId(v.net) || -1);
  // 异网络铺铜实铜也是障碍（同网络铺铜可以借道，不标记）
  for (const f of fills) {
    const li = layerIdx(f.zone.layer); if (li < 0) continue;
    const v = netId(f.zone.net) || -1;
    for (const poly of f.polygons) {
      const xs = poly[0].map((p) => p.x), ys = poly[0].map((p) => p.y);
      const cx1 = Math.max(0, Math.floor((Math.min(...xs) - bb.x) / g)), cx2 = Math.min(W - 1, Math.ceil((Math.max(...xs) - bb.x) / g));
      const cy1 = Math.max(0, Math.floor((Math.min(...ys) - bb.y) / g)), cy2 = Math.min(H - 1, Math.ceil((Math.max(...ys) - bb.y) / g));
      for (let y = cy1; y <= cy2; y++) for (let x = cx1; x <= cx2; x++) { const p = toWorld(x, y); if (pointInPolygon(p, poly[0]) && !poly.slice(1).some((h) => pointInPolygon(p, h))) { const i = idx(x, y, li); if (occ[i] === 0) occ[i] = v; } }
    }
  }

  const skipped = new Set<string>();
  const keyOf = (l: RatsnestLine) => `${l.net}|${l.a.x},${l.a.y}|${l.b.x},${l.b.y}`;
  const currentBoard = (): Board => ({ ...board, traces: [...board.traces, ...result.traces.map((t, i) => ({ id: `ar${i}`, ...t }))], vias: [...board.vias, ...result.vias.map((v, i) => ({ id: `av${i}`, ...v }))] });
  const remainingLines = () => computeRatsnest(currentBoard(), rules, fills).lines.filter(netFilter);
  const priority = new Map((opts.priorityNets ?? []).map((net, i) => [net, i]));
  let connectivity = initial;
  const nextLine = (): RatsnestLine | null => {
    connectivity = computeRatsnest(currentBoard(), rules, fills);
    const ls = connectivity.lines.filter(netFilter).filter((l) => !skipped.has(keyOf(l)));
    if (!ls.length) return null;
    const len = (l: RatsnestLine) => Math.hypot(l.a.x - l.b.x, l.a.y - l.b.y);
    ls.sort((x, y) => (priority.get(x.net) ?? 1e9) - (priority.get(y.net) ?? 1e9) || len(x) - len(y));
    return ls[0];
  };
  const padAt = (p: Vec): WorldPad | undefined => pads.find((pd) => Math.abs(pd.center.x - p.x) < 1e-6 && Math.abs(pd.center.y - p.y) < 1e-6);

  // A* 工作数组复用
  const gScore = new Float64Array(N * L);
  const came = new Int32Array(N * L);
  const heap = new MinHeap();
  let done = 0;

  for (let guard = 0; guard < result.total * 2 + 10; guard++) {
    const line = nextLine();
    if (!line) break;
    const key = keyOf(line);
    const net = line.net, nid = netId(net);
    const nc = netClassFor(board, net);
    const preferredWidth = Math.max(rules.minTraceWidth, nc?.traceWidth ?? 0.25);
    const clearance = Math.max(rules.minClearance, nc?.clearance ?? 0);
    const pa = padAt(line.a), pb = padAt(line.b);
    const padWidth = Math.min(...[pa, pb].filter((p): p is WorldPad => !!p).map(p => Math.min(p.rect.w, p.rect.h)));
    const width = Math.max(rules.minTraceWidth, Math.min(preferredWidth, padWidth));
    const outside = [line.a, line.b].filter((q) => !pointInPolygon(q, board.outline));
    if (outside.length) { skipped.add(key); result.failed.push({ net, reason: `${pa?.ref ?? ''}${pb ? (pa ? '/' : '') + pb.ref : ''} 焊盘在板框外，请先把元件拖进板框` }); continue; }
    const startLayers = pa ? pa.layers.map(layerIdx).filter((i) => i >= 0) : layers.map((_, i) => i);
    const goalLayers = new Set(pb ? pb.layers.map(layerIdx).filter((i) => i >= 0) : layers.map((_, i) => i));
    const s = toCell(line.a), t = toCell(line.b);
    const componentAt = (p: Vec) => connectivity.components?.find(c => c.net === net && c.pads.some(q => Math.hypot(q.x - p.x, q.y - p.y) < 1e-6));
    const startAnchors = componentAt(line.a)?.anchors ?? [{ point: line.a, layers: startLayers.map(l => layers[l]) }];
    const goalAnchors = componentAt(line.b)?.anchors ?? [{ point: line.b, layers: [...goalLayers].map(l => layers[l]) }];
    const startPoints = new Map<number, Vec>(), goalPoints = new Map<number, Vec>();
    // 目标：终点焊盘覆盖的格子 + 中心格
    const goal = new Set<number>();
    if (pb) { const sh = width / 2; const cx1 = Math.ceil((pb.rect.x + sh - bb.x) / g), cx2 = Math.floor((pb.rect.x + pb.rect.w - sh - bb.x) / g), cy1 = Math.ceil((pb.rect.y + sh - bb.y) / g), cy2 = Math.floor((pb.rect.y + pb.rect.h - sh - bb.y) / g); for (let y = cy1; y <= cy2; y++) for (let x = cx1; x <= cx2; x++) for (const l of goalLayers) goal.add(idx(x, y, l)); }
    for (const l of goalLayers) goal.add(idx(t.x, t.y, l));
    for (const i of goal) goalPoints.set(i, line.b);
    for (const anchor of goalAnchors) { const p = toCell(anchor.point); for (const layer of anchor.layers) { const i = idx(p.x, p.y, layerIdx(layer)); goal.add(i); goalPoints.set(i, anchor.point); } }

    // Exact copper clearance, cached for this search; pad necks widen outside the escape area.
    const freeCache = new Int8Array(N * L);
    const free = (x: number, y: number, l: number): boolean => {
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      const i = idx(x, y, l);
      if (freeCache[i]) return freeCache[i] === 1;
      freeCache[i] = -1;
      const p = toWorld(x, y);
      const nearPad = [pa, pb].some(pd => pd && segRectDist(p, p, pd.rect) < 1.25);
      const localWidth = nearPad ? width : preferredWidth;
      if (edgeDistance[y * W + x] < edge + localWidth / 2 - 1e-6) return false;
      if (!space.free(p, localWidth / 2, layers[l], net, clearance)) return false;
      for (const fill of fills) if (fill.zone.net !== net && fill.zone.layer === layers[l] && fill.polygons.some(poly => traceTouchesPolygon({ points: [p, p], width: width + 2 * clearance }, poly))) return false;
      freeCache[i] = 1;
      return true;
    };
    const viaDrill = Math.max(rules.minDrill, nc?.viaDrill ?? 0.3);
    const viaSize = Math.max(nc?.viaSize ?? 0.6, viaDrill + 2 * rules.minAnnularRing);
    const viaCache = new Int8Array(N);
    const viaFree = (x: number, y: number): boolean => {
      const i = y * W + x;
      if (viaCache[i]) return viaCache[i] === 1;
      viaCache[i] = -1;
      if (edgeDistance[i] < edge + viaSize / 2 - 1e-6) return false;
      const p = toWorld(x, y);
      if (!layers.every(layer => space.free(p, viaSize / 2, layer, net, clearance))) return false;
      for (const fill of fills) if (fill.zone.net !== net && fill.polygons.some(poly => traceTouchesPolygon({ points: [p, p], width: viaSize + 2 * clearance }, poly))) return false;
      viaCache[i] = 1;
      return true;
    };

    gScore.fill(Infinity); came.fill(-1); heap.clear();
    const h = (x: number, y: number) => 1.15 * Math.hypot(x - t.x, y - t.y);
    for (const anchor of startAnchors) {
      const p = toCell(anchor.point);
      for (const layer of anchor.layers) { const l = layerIdx(layer); if (!free(p.x, p.y, l)) continue; const i = idx(p.x, p.y, l); gScore[i] = 0; heap.push(h(p.x, p.y), i); startPoints.set(i, anchor.point); }
    }
    let found = -1, expanded = 0;
    while (heap.size) {
      const { i, f } = heap.pop();
      const cellX = (i % N) % W, cellY = Math.floor((i % N) / W);
      // Better paths leave stale entries in the heap; don't count or expand them twice.
      if (f > gScore[i] + h(cellX, cellY) + 1e-9) continue;
      if (goal.has(i)) { found = i; break; }
      if (++expanded > maxNodes) break;
      const l = Math.floor(i / N), rem = i % N, y = Math.floor(rem / W), x = rem % W;
      const gi = gScore[i];
      const prev = came[i];
      const px = prev >= 0 ? (prev % N) % W : -1, py = prev >= 0 ? Math.floor((prev % N) / W) : -1;
      for (const [dx, dy, c] of DIRS) {
        const nx = x + dx, ny = y + dy;
        const ni = idx(nx, ny, l);
        if (!free(nx, ny, l)) continue;
        // 对角线：两个正交邻格都要满足间距，否则斜段中部会擦到障碍角点
        if (dx && dy && (!free(x + dx, y, l) || !free(x, y + dy, l))) continue;
        const turn = prev >= 0 && (x - px !== dx || y - py !== dy) ? 0.8 : 0;
        const own = occ[ni] === nid && !goal.has(ni) ? 0.6 : 0;
        const ng = gi + c + turn + own;
        if (ng < gScore[ni]) { gScore[ni] = ng; came[ni] = i; heap.push(ng + h(nx, ny), ni); }
      }
      if (L > 1 && viaFree(x, y)) for (let nl = 0; nl < L; nl++) {
        if (nl === l) continue;
        const ni = idx(x, y, nl); const ng = gi + viaCost;
        if (ng < gScore[ni]) { gScore[ni] = ng; came[ni] = i; heap.push(ng + h(x, y), ni); }
      }
    }
    if (found < 0) {
      skipped.add(key);
      const startBlocked = !startLayers.some((l) => DIRS.some(([dx, dy]) => free(s.x + dx, s.y + dy, l)));
      const goalBlocked = ![...goalLayers].some((l) => DIRS.some(([dx, dy]) => free(t.x + dx, t.y + dy, l)));
      result.failed.push({ net, reason: expanded > maxNodes ? '搜索空间过大（板子太大或栅格太细）' : startBlocked ? `${pa?.ref ?? '起点'} 焊盘周围没有走线空间（与其他焊盘/走线太近，或板边留白不够）` : goalBlocked ? `${pb?.ref ?? '终点'} 焊盘周围没有走线空间` : `没有找到不违反间距的路径（可尝试移动元件、${board.copperCount === 2 ? '改 4 层或' : ''}减小线宽）` });
      continue;
    }

    // 回溯路径，按层切段，层变化处放过孔
    const path: { x: number; y: number; l: number }[] = [];
    for (let i = found; i >= 0; i = came[i]) path.push({ l: Math.floor(i / N), y: Math.floor((i % N) / W), x: (i % N) % W });
    path.reverse();
    const sourcePoint = startPoints.get(idx(path[0].x, path[0].y, path[0].l)) ?? line.a;
    const targetPoint = goalPoints.get(found) ?? line.b;
    const beforeTraces = result.traces.length, beforeVias = result.vias.length;
    let seg: Vec[] = [];
    let curL = path[0].l;
    const flush = () => { if (seg.length >= 2) { const pts = simplify(seg); result.traces.push({ layer: layers[curL], net, width, points: pts }); } seg = []; };
    for (let k = 0; k < path.length; k++) {
      const p = path[k];
      if (p.l !== curL) {
        // 起点 / 终点处直接换层：过孔放在焊盘中心，保证与 SMD 焊盘连通
        const at = k === 1 && seg.length === 1 ? { ...sourcePoint } : k === path.length - 1 && p.x === t.x && p.y === t.y ? { ...targetPoint } : toWorld(p.x, p.y);
        flush();
        result.vias.push({ x: at.x, y: at.y, size: viaSize, drill: viaDrill, net });
        curL = p.l;
        seg = [at];
        continue;
      }
      seg.push(toWorld(p.x, p.y));
    }
    flush();
    // 首末点精确落到焊盘中心，用 45° 折线衔接
    const near = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
    const bend = (a: Vec, b: Vec): Vec | null => { const dx = b.x - a.x, dy = b.y - a.y, ax = Math.abs(dx), ay = Math.abs(dy); if (ax < 1e-9 || ay < 1e-9 || Math.abs(ax - ay) < 1e-9) return null; const d = Math.min(ax, ay); return { x: a.x + Math.sign(dx) * d, y: a.y + Math.sign(dy) * d }; };
    const first = result.traces[beforeTraces], last = result.traces[result.traces.length - 1];
    if (!first) { const m = bend(sourcePoint, targetPoint); result.traces.push({ layer: layers[path[0].l], net, width, points: m ? [{ ...sourcePoint }, m, { ...targetPoint }] : [{ ...sourcePoint }, { ...targetPoint }] }); }
    else {
      if (!near(first.points[0], sourcePoint)) { const m = bend(sourcePoint, first.points[0]); first.points.unshift(...(m ? [{ ...sourcePoint }, m] : [{ ...sourcePoint }])); }
      if (!near(last.points[last.points.length - 1], targetPoint)) { const m = bend(last.points[last.points.length - 1], targetPoint); last.points.push(...(m ? [m, { ...targetPoint }] : [{ ...targetPoint }])); }
      first.points = simplify(first.points);
      if (last !== first) last.points = simplify(last.points);
    }
    // Validate final world-coordinate geometry, including off-grid pad escapes and vias.
    // Search cells alone do not prove that the stitched segments meet clearance.
    let candidateTraces = result.traces.slice(beforeTraces);
    const candidateVias = result.vias.slice(beforeVias);
    const existingTraces = [...board.traces, ...result.traces.slice(0, beforeTraces)];
    const existingVias = [...board.vias, ...result.vias.slice(0, beforeVias)];
    const gapFor = (other: string) => Math.max(clearance, netClassFor(board, other)?.clearance ?? 0);
    const foreign = (other: string) => !other || other !== net;
    const segmentSafe = (a: Vec, b: Vec, radius: number, ls: CopperLayer[]) => {
      if (!pointInPolygon(a, board.outline) || !pointInPolygon(b, board.outline)) return false;
      for (let i = 0; i < board.outline.length; i++) if (segSegDist(a, b, board.outline[i], board.outline[(i + 1) % board.outline.length]) < edge + radius - 1e-6) return false;
      for (const p of pads) if ((p.def.npth || foreign(p.net)) && p.layers.some((l) => ls.includes(l)) && segRectDist(a, b, p.rect) < radius + gapFor(p.net) - 1e-6) return false;
      for (const tr of existingTraces) if (foreign(tr.net) && ls.includes(tr.layer)) for (let i = 1; i < tr.points.length; i++) if (segSegDist(a, b, tr.points[i - 1], tr.points[i]) < radius + tr.width / 2 + gapFor(tr.net) - 1e-6) return false;
      for (const v of existingVias) if (foreign(v.net) && pointSegDist(v, a, b) < radius + v.size / 2 + gapFor(v.net) - 1e-6) return false;
      for (const fill of fills) if (foreign(fill.zone.net) && ls.includes(fill.zone.layer)) {
        const expanded = { points: [a, b], width: 2 * (radius + Math.max(gapFor(fill.zone.net), fill.zone.clearance ?? 0)) };
        if (fill.polygons.some((poly) => traceTouchesPolygon(expanded, poly))) return false;
      }
      return true;
    };
    // Keep full net-class width except short escapes from pads narrower than that width.
    if (width < preferredWidth) {
      const widened: typeof candidateTraces = [];
      for (const tr of candidateTraces) for (let i = 1; i < tr.points.length; i++) {
        const a = tr.points[i - 1], b = tr.points[i], length = Math.hypot(b.x - a.x, b.y - a.y);
        const count = Math.max(1, Math.ceil(length / .75));
        for (let k = 0; k < count; k++) {
          const at = (u: number) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
          const aa = at(k / count), bb = at((k + 1) / count);
          const w = segmentSafe(aa, bb, preferredWidth / 2, [tr.layer]) ? preferredWidth : width;
          const last = widened[widened.length - 1];
          if (last && last.layer === tr.layer && last.width === w && Math.hypot(last.points[last.points.length - 1].x - aa.x, last.points[last.points.length - 1].y - aa.y) < 1e-8) last.points.push(bb);
          else widened.push({ ...tr, width: w, points: [aa, bb] });
        }
      }
      candidateTraces = widened.map(tr => ({ ...tr, points: simplify(tr.points) }));
      result.traces.splice(beforeTraces, result.traces.length - beforeTraces, ...candidateTraces);
    }
    const safe = candidateTraces.every((tr) => tr.points.slice(1).every((b, i) => segmentSafe(tr.points[i], b, tr.width / 2, [tr.layer]))) && candidateVias.every((v) => segmentSafe(v, v, v.size / 2, layers));
    if (!safe) {
      result.traces.length = beforeTraces; result.vias.length = beforeVias;
      skipped.add(key);
      result.failed.push({ net, reason: '焊盘出线或过孔不满足实际铜间距，已跳过' });
      continue;
    }
    // 连通性校验：这条线布完后飞线必须减少，否则回滚并标记失败，避免死循环
    const remainingKeys = new Set(remainingLines().map(keyOf));
    if (remainingKeys.has(key)) {
      result.traces.length = beforeTraces; result.vias.length = beforeVias;
      skipped.add(key);
      result.failed.push({ net, reason: '走线未能连通两端（内部一致性问题），已跳过' });
      continue;
    }
    // Commit occupancy only after validation. Failed attempts leave no ghost obstacles.
    for (const tr of candidateTraces) for (let i = 1; i < tr.points.length; i++) markSeg(tr.points[i - 1], tr.points[i], tr.width / 2, [tr.layer], nid);
    for (const v of candidateVias) markSeg(v, v, v.size / 2, layers, nid);
    for (const tr of candidateTraces) for (let i = 1; i < tr.points.length; i++) space.segment(tr.points[i - 1], tr.points[i], tr.width / 2, [tr.layer], net);
    for (const v of candidateVias) space.segment(v, v, v.size / 2, layers, net);
    done++;
    opts.onProgress?.(done, result.total, net);
  }
  const unresolved = new Set(remainingLines().map((l) => l.net));
  result.failed = result.failed.filter((f) => unresolved.has(f.net));
  result.routed = Math.max(0, result.total - remainingLines().length);
  result.ms = Date.now() - t0;
  // Reorder congested nets without removing the user's existing copper. Keep the best complete proposal.
  if (!opts.noRetry && result.routed < result.total) {
    let priorities = new Set(opts.priorityNets ?? []);
    let failures = result.failed;
    const attempted = new Set<string>();
    for (let pass = 0; pass < 5 && result.routed < result.total; pass++) {
      priorities = new Set([...failures.filter(f => !/板框外/.test(f.reason)).map(f => f.net), ...priorities]);
      const orderKey = [...priorities].join('|');
      if (!priorities.size || attempted.has(orderKey)) break;
      attempted.add(orderKey);
      const retry = autoroute(board, rules, { ...opts, noRetry: true, allowComponentMoves: false, priorityNets: [...priorities] });
      failures = retry.failed;
      if (retry.routed > result.routed) Object.assign(result, retry);
    }
  }
  // Local rip-up: remove only newly proposed copper blocking unresolved pads, never the user's copper.
  if (!opts.noRetry && result.routed < result.total) {
    for (let pass = 0; pass < 3 && result.routed < result.total; pass++) {
      const routedBoard: Board = { ...board, traces: [...board.traces,...result.traces.map((t,i)=>({...t,id:`local-t${i}`}))], vias: [...board.vias,...result.vias.map((v,i)=>({...v,id:`local-v${i}`}))] };
      const missing = computeRatsnest(routedBoard,rules).lines.filter(netFilter);
      const endpoints = missing.flatMap(l=>[l.a,l.b].map(point=>({point,net:l.net})));
      const retainedTraces = result.traces.filter(t=>!endpoints.some(e=>e.net!==t.net && t.points.slice(1).some((b,i)=>pointSegDist(e.point,t.points[i],b)<1.5+t.width/2)));
      const retainedVias = result.vias.filter(v=>!endpoints.some(e=>e.net!==v.net && Math.hypot(v.x-e.point.x,v.y-e.point.y)<1.5+v.size/2));
      if(retainedTraces.length===result.traces.length && retainedVias.length===result.vias.length)break;
      const reduced: Board = {...board,traces:[...board.traces,...retainedTraces.map((t,i)=>({...t,id:`keep-t${i}`}))],vias:[...board.vias,...retainedVias.map((v,i)=>({...v,id:`keep-v${i}`}))]};
      const patch = autoroute(reduced,rules,{...opts,noRetry:true,allowComponentMoves:false,priorityNets:[...new Set(missing.map(l=>l.net))]});
      const traces=[...retainedTraces,...patch.traces],vias=[...retainedVias,...patch.vias];
      const unresolved=computeRatsnest({...board,traces:[...board.traces,...traces.map((t,i)=>({...t,id:`all-t${i}`}))],vias:[...board.vias,...vias.map((v,i)=>({...v,id:`all-v${i}`}))]},rules).lines.filter(netFilter).length;
      if(unresolved<result.total-result.routed){result.traces=traces;result.vias=vias;result.routed=result.total-unresolved;result.failed=patch.failed;}else break;
    }
  }
  if (opts.allowComponentMoves && result.routed < result.total) {
    const moves = suggestRoutingMoves(board, rules, result.failed.map(f => f.net));
    if (moves.length) {
      const relocated: Board = { ...board, footprints: board.footprints.map(fp => { const m = moves.find(m => m.id === fp.id); return m ? { ...fp, x: m.x, y: m.y } : fp; }) };
      const candidate = autoroute(relocated, rules, { ...opts, allowComponentMoves: false });
      if (candidate.total - candidate.routed < result.total - result.routed) {
        candidate.moves = moves; candidate.total = result.total; candidate.routed = result.total - computeRatsnest({ ...relocated, traces: [...relocated.traces, ...candidate.traces.map((t,i) => ({ ...t,id: `test-t${i}` }))], vias: [...relocated.vias, ...candidate.vias.map((v,i) => ({ ...v,id: `test-v${i}` }))] }, rules).lines.filter(netFilter).length;
        candidate.ms = Date.now() - t0;
        return candidate;
      }
    }
  }
  result.ms = Date.now() - t0;
  return result;
}

/** 按异网络相邻焊盘最小中心距选网格：≥1.0mm → 0.25，≥0.45mm → 0.125，否则 0.1。 */
export function pickGrid(pads: WorldPad[]): number {
  let minD = Infinity;
  const byFp = new Map<string, WorldPad[]>();
  for (const p of pads) { if (!byFp.has(p.footprintId)) byFp.set(p.footprintId, []); byFp.get(p.footprintId)!.push(p); }
  for (const list of byFp.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (a.net && a.net === b.net) continue;
    const d = Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y);
    if (d > 0.05 && d < minD) minD = d;
  }
  return minD >= 1.0 ? 0.25 : minD >= 0.45 ? 0.125 : 0.1;
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
