/**
 * 内置自动布线器：网格 A*（状态 x, y, 层）+ 拆线重布。
 * - 第 1 阶段：全部飞线按"全局最短优先"交替严格布线（每条布完只重算该网络连通性）
 * - 第 2 阶段：失败网络与其附近挡路网络一起拆掉，失败网络优先重布、挡路网络补回；没有变好就回滚并扩大范围
 * - 冲突图按真实铜边距离判定（每格记录最近两个新走线网络的边距），支持"软冲突"协商模式供后续扩展
 * - 层方向偏好（顶层偏水平、底层偏垂直）、过孔代价、转弯代价共同减少缠绕与过孔数
 * - 空间索引检查真实铜几何；细间距焊盘预留出线通道，必要时局部收窄到焊盘宽度
 * - 布通后统一做几何校验（含新走线之间）与 45° 倒角
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
  /** 优先布这些网络 */
  priorityNets?: string[];
  /** 内部：禁止元件微调递归 */
  noRetry?: boolean;
  /** 协商轮数上限（默认 10） */
  maxRounds?: number;
  /** 时间预算（毫秒，默认 90 s）：超时后停止协商，进入严格模式收尾 */
  timeBudgetMs?: number;
  /** 诊断回调 */
  debug?: (info: Record<string, unknown>) => void;
}

export interface AutorouteResult {
  moves?: RoutingMove[];
  traces: Omit<Trace, 'id'>[];
  vias: Omit<Via, 'id'>[];
  routed: number;
  failed: { net: string; reason: string }[];
  total: number;
  ms: number;
  /** 协商轮数（诊断用） */
  rounds?: number;
}

type TraceOut = Omit<Trace, 'id'>;
type ViaOut = Omit<Via, 'id'>;
interface Route { key: string; traces: TraceOut[]; vias: ViaOut[] }
interface NetRoutes { net: string; nid: number; routes: Route[]; cells: Int32Array | null; failures: Map<string, string> }

const DIRS: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

/** 二叉堆（TypedArray 存储，避免对象分配）。 */
class MinHeap {
  private f = new Float64Array(1 << 14);
  private i = new Int32Array(1 << 14);
  private n = 0;
  push(f: number, i: number) {
    if (this.n === this.f.length) { const nf = new Float64Array(this.n * 2); nf.set(this.f); this.f = nf; const ni = new Int32Array(this.n * 2); ni.set(this.i); this.i = ni; }
    let k = this.n++;
    const F = this.f, I = this.i;
    while (k > 0) { const p = (k - 1) >> 1; if (F[p] <= f) break; F[k] = F[p]; I[k] = I[p]; k = p; }
    F[k] = f; I[k] = i;
  }
  pop(): { f: number; i: number } {
    const F = this.f, I = this.i;
    const top = { f: F[0], i: I[0] };
    const n = --this.n;
    if (n > 0) {
      const lf = F[n], li = I[n];
      let k = 0;
      for (;;) { const l = 2 * k + 1; if (l >= n) break; const r = l + 1; const m = r < n && F[r] < F[l] ? r : l; if (F[m] >= lf) break; F[k] = F[m]; I[k] = I[m]; k = m; }
      F[k] = lf; I[k] = li;
    }
    return top;
  }
  get size() { return this.n; }
  clear() { this.n = 0; }
}

export function autoroute(board: Board, rules: RuleSet = RULE_SETS[0], opts: AutorouteOptions = {}): AutorouteResult {
  const t0 = Date.now();
  const fills = zoneFills(board, rules);
  const netFilter = (l: RatsnestLine) => !opts.nets?.length || opts.nets.includes(l.net);
  const initial = computeRatsnest(board, rules, fills);
  const initialLines = initial.lines.filter(netFilter);
  const result: AutorouteResult = { traces: [], vias: [], routed: 0, failed: [], total: initialLines.length, ms: 0 };
  if (!result.total) { result.ms = Date.now() - t0; return result; }
  const pads = allPads(board);
  const g = opts.grid ?? pickGrid(pads);
  const layers = copperLayers(board.copperCount);
  const L = layers.length;
  const bb = boardBounds(board);
  const W = Math.ceil(bb.w / g) + 1, H = Math.ceil(bb.h / g) + 1;
  const N = W * H;
  const viaCost = opts.viaCost ?? Math.round(3 / g);
  const maxNodes = opts.maxNodes ?? Math.max(200000, Math.min(1500000, N * L));
  const maxRounds = opts.maxRounds ?? 10;
  const deadline = t0 + (opts.timeBudgetMs ?? 90000);
  const idx = (x: number, y: number, l: number) => (l * H + y) * W + x;
  const toWorld = (x: number, y: number): Vec => ({ x: bb.x + x * g, y: bb.y + y * g });
  const toCell = (p: Vec) => ({ x: Math.round((p.x - bb.x) / g), y: Math.round((p.y - bb.y) / g) });
  const layerIdx = (l: CopperLayer) => layers.indexOf(l);

  // ---------- 静态障碍：已有铜、板边 ----------
  const occ = new Int32Array(N * L); // 值 = 网络 id（0 空，-1 硬障碍 / 无网络铜）—— 只用于"沿自家已有铜"的代价
  const space = new RoutingSpace(board, rules);
  space.reserveEscapes();
  // 新走线的精确几何索引（严格模式的硬障碍；按网络增删）
  const dyn = new RoutingSpace({ ...board, footprints: [], traces: [], vias: [], zones: [] }, rules);
  const edgeDistance = new Float32Array(N);
  const markCell = (i: number, value: number) => { const old = occ[i]; occ[i] = old === 0 || old === value ? value : -1; };
  const netIds = new Map<string, number>();
  const netId = (n: string) => { if (!n) return -1; let v = netIds.get(n); if (!v) { v = netIds.size + 1; netIds.set(n, v); } return v; };
  const markRect = (x1: number, y1: number, x2: number, y2: number, ls: CopperLayer[], v: number) => {
    const cx1 = Math.max(0, Math.ceil((x1 - g / 2 - bb.x) / g)), cx2 = Math.min(W - 1, Math.floor((x2 + g / 2 - bb.x) / g));
    const cy1 = Math.max(0, Math.ceil((y1 - g / 2 - bb.y) / g)), cy2 = Math.min(H - 1, Math.floor((y2 + g / 2 - bb.y) / g));
    for (const l of ls) { const li = layerIdx(l); if (li < 0) continue; for (let y = cy1; y <= cy2; y++) for (let x = cx1; x <= cx2; x++) markCell(idx(x, y, li), v); }
  };
  /** 线段周围 rr 内的格子（含半格栅格化余量），回调每个格索引。 */
  const forSegCells = (a: Vec, b: Vec, r: number, ls: number[], fn: (i: number) => void) => {
    const rr = r + g / 2;
    const x1 = Math.min(a.x, b.x) - rr, x2 = Math.max(a.x, b.x) + rr, y1 = Math.min(a.y, b.y) - rr, y2 = Math.max(a.y, b.y) + rr;
    const cx1 = Math.max(0, Math.floor((x1 - bb.x) / g)), cx2 = Math.min(W - 1, Math.ceil((x2 - bb.x) / g));
    const cy1 = Math.max(0, Math.floor((y1 - bb.y) / g)), cy2 = Math.min(H - 1, Math.ceil((y2 - bb.y) / g));
    for (let y = cy1; y <= cy2; y++) for (let x = cx1; x <= cx2; x++) { const p = toWorld(x, y); if (pointSegDist(p, a, b) <= rr) for (const li of ls) fn(idx(x, y, li)); }
  };
  const markSeg = (a: Vec, b: Vec, r: number, ls: CopperLayer[], v: number) => forSegCells(a, b, r, ls.map(layerIdx).filter((i) => i >= 0), (i) => markCell(i, v));

  const edge = rules.copperToEdge;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = toWorld(x, y);
    const inside = pointInPolygon(p, board.outline);
    let distance = Infinity;
    if (inside) for (let i = 0; i < board.outline.length; i++) distance = Math.min(distance, pointSegDist(p, board.outline[i], board.outline[(i + 1) % board.outline.length]));
    edgeDistance[y * W + x] = inside ? distance : -1;
    if (!inside || distance < edge) for (let l = 0; l < L; l++) occ[idx(x, y, l)] = -1;
  }
  for (const p of pads) markRect(p.rect.x, p.rect.y, p.rect.x + p.rect.w, p.rect.y + p.rect.h, p.layers, p.def.npth ? -1 : netId(p.net) || -1);
  for (const t of board.traces) for (let i = 0; i < t.points.length - 1; i++) markSeg(t.points[i], t.points[i + 1], t.width / 2, [t.layer], netId(t.net) || -1);
  for (const v of board.vias) markSeg(v, v, v.size / 2, layers, netId(v.net) || -1);
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

  // ---------- 网络与动态拥塞图 ----------
  const widthOf = (net: string) => Math.max(rules.minTraceWidth, netClassFor(board, net)?.traceWidth ?? 0.25);
  const clearanceOf = (net: string) => Math.max(rules.minClearance, netClassFor(board, net)?.clearance ?? 0);
  const netNames = [...new Set(initialLines.map((l) => l.net))];
  const wMax = Math.max(...netNames.map(widthOf)), clMax = Math.max(...netNames.map(clearanceOf));
  // 每格记录最多两个"邻近新走线"网络及其铜边到格心的距离，冲突按真实间距判定（自身半宽 + 间距）
  const cnt = new Uint8Array(N * L), own1 = new Int32Array(N * L), own2 = new Int32Array(N * L), d1 = new Float32Array(N * L).fill(Infinity), d2 = new Float32Array(N * L).fill(Infinity), hist = new Float32Array(N * L);
  const nets = new Map<string, NetRoutes>();
  for (const n of netNames) nets.set(n, { net: n, nid: netId(n), routes: [], cells: null, failures: new Map() });
  const netOf = (n: string) => nets.get(n)!;
  const gapBetween = (a: string, b: string) => Math.max(clearanceOf(a), clearanceOf(b));
  const nameOfNid = new Map<number, string>(); for (const n of netNames) nameOfNid.set(netId(n), n);
  /** 网络 X（半宽 hw）的走线中心落在格 i 是否与其他新走线冲突。 */
  /** 0 无冲突；1 与"可协商"网络冲突（软）；2 与固定网络冲突（硬）。soft=null 表示全部可协商。 */
  let soft = null as Set<number> | null;
  const conflictAt = (i: number, nid: number, hw: number, net: string): number => {
    const c = cnt[i]; if (!c) return 0;
    let r = 0;
    if (own1[i] !== nid && d1[i] < hw + gapBetween(net, nameOfNid.get(own1[i]) ?? '') - 1e-6) r = Math.max(r, !soft || soft.has(own1[i]) ? 1 : 2);
    if (c >= 2 && own2[i] !== nid && d2[i] < hw + gapBetween(net, nameOfNid.get(own2[i]) ?? '') - 1e-6) r = Math.max(r, !soft || soft.has(own2[i]) ? 1 : 2);
    return r;
  };
  const ownOnlyAt = (i: number, nid: number) => cnt[i] === 1 && own1[i] === nid;
  /** 标记一个网络：每格记录到该网络铜边的最小距离（标记带宽 = 最大间距 + 最宽线半宽）。 */
  let useMarks = false; // 仅协商模式需要网格冲突图
  const markNet = (nr: NetRoutes) => {
    if (nr.cells) unmarkNet(nr);
    dyn.removeNet(nr.net);
    for (const r of nr.routes) { for (const t of r.traces) for (let i = 1; i < t.points.length; i++) dyn.segment(t.points[i - 1], t.points[i], t.width / 2, [t.layer], nr.net); for (const v of r.vias) dyn.segment(v, v, v.size / 2, layers, nr.net); }
    if (!useMarks) return;
    const dmap = new Map<number, number>();
    const band = clMax + wMax / 2;
    const all = layers.map((_, i) => i);
    const put = (a: Vec, b: Vec, r: number, ls: number[]) => forSegCells(a, b, r + band, ls, (c) => { const p = toWorld((c % N) % W, Math.floor((c % N) / W)); const d = Math.max(0, pointSegDist(p, a, b) - r); const prev = dmap.get(c); if (prev === undefined || d < prev) dmap.set(c, d); });
    for (const r of nr.routes) {
      for (const t of r.traces) { const li = layerIdx(t.layer); for (let i = 1; i < t.points.length; i++) put(t.points[i - 1], t.points[i], t.width / 2, [li]); }
      for (const v of r.vias) put(v, v, v.size / 2, all);
    }
    const cells = new Int32Array(dmap.size); let k = 0;
    for (const [i, d] of dmap) {
      cells[k++] = i;
      // 每格只保留最近的两个网络
      if (cnt[i] === 0) { own1[i] = nr.nid; d1[i] = d; }
      else if (cnt[i] === 1) { if (d < d1[i]) { own2[i] = own1[i]; d2[i] = d1[i]; own1[i] = nr.nid; d1[i] = d; } else { own2[i] = nr.nid; d2[i] = d; } }
      else if (d < d1[i]) { own2[i] = own1[i]; d2[i] = d1[i]; own1[i] = nr.nid; d1[i] = d; }
      else if (d < d2[i]) { own2[i] = nr.nid; d2[i] = d; }
      if (cnt[i] < 255) cnt[i]++;
    }
    nr.cells = cells;
  };
  const unmarkNet = (nr: NetRoutes) => {
    dyn.removeNet(nr.net);
    if (!nr.cells) return;
    for (const i of nr.cells) {
      if (cnt[i] > 0) cnt[i]--;
      if (own1[i] === nr.nid) { own1[i] = own2[i]; d1[i] = d2[i]; own2[i] = 0; d2[i] = Infinity; } else if (own2[i] === nr.nid) { own2[i] = 0; d2[i] = Infinity; }
    }
    nr.cells = null;
  };
  /** 两个网络的标记带是否真的冲突（用于找需要拆线的网络）。 */
  const netHasConflict = (nr: NetRoutes): boolean => {
    if (!nr.cells) return false;
    const hw = widthOf(nr.net) / 2;
    for (const i of nr.cells) { if (cnt[i] < 2) continue; const mineFirst = own1[i] === nr.nid; if (!mineFirst && own2[i] !== nr.nid) continue; const other = mineFirst ? own2[i] : own1[i]; const dOther = mineFirst ? d2[i] : d1[i]; const dMine = mineFirst ? d1[i] : d2[i]; if (other && dMine <= 1e-9 && dOther < gapBetween(nr.net, nameOfNid.get(other) ?? '') - 1e-6) return true; }
    void hw;
    return false;
  };
  const ripNet = (nr: NetRoutes) => { unmarkNet(nr); nr.routes = []; nr.failures.clear(); };

  const allTraces = (except?: string): TraceOut[] => { const out: TraceOut[] = []; for (const nr of nets.values()) if (nr.net !== except) for (const r of nr.routes) out.push(...r.traces); return out; };
  const allVias = (except?: string): ViaOut[] => { const out: ViaOut[] = []; for (const nr of nets.values()) if (nr.net !== except) for (const r of nr.routes) out.push(...r.vias); return out; };
  const currentBoard = (): Board => ({ ...board, traces: [...board.traces, ...allTraces().map((t, i) => ({ id: `ar${i}`, ...t }))], vias: [...board.vias, ...allVias().map((v, i) => ({ id: `av${i}`, ...v }))] });
  const remainingLines = () => computeRatsnest(currentBoard(), rules, fills).lines.filter(netFilter);
  /** 只含某个网络铜的板（其他焊盘去网络名）：连通性只需算这一网络，快一个数量级。 */
  const netBoardBase = new Map<string, Board>();
  const netBoard = (net: string): Board => {
    let base = netBoardBase.get(net);
    if (!base) { base = { ...board, footprints: board.footprints.map((f) => ({ ...f, padNets: Object.fromEntries(Object.entries(f.padNets).map(([k, v]) => [k, v === net ? v : ''])) })), traces: board.traces.filter((t) => t.net === net), vias: board.vias.filter((v) => v.net === net), zones: board.zones.filter((z) => z.net === net) }; netBoardBase.set(net, base); }
    const nr = nets.get(net);
    const tr = nr ? nr.routes.flatMap((r) => r.traces) : [], vi = nr ? nr.routes.flatMap((r) => r.vias) : [];
    return { ...base, traces: [...base.traces, ...tr.map((t, i) => ({ id: `ar${i}`, ...t }))], vias: [...base.vias, ...vi.map((v, i) => ({ id: `av${i}`, ...v }))] };
  };
  const netFills = new Map<string, typeof fills>();
  const fillsOf = (net: string) => { let f = netFills.get(net); if (!f) { f = fills.filter((x) => x.zone.net === net); netFills.set(net, f); } return f; };
  const keyOf = (l: RatsnestLine) => `${l.net}|${l.a.x},${l.a.y}|${l.b.x},${l.b.y}`;
  const padAt = (p: Vec): WorldPad | undefined => pads.find((pd) => Math.abs(pd.center.x - p.x) < 1e-6 && Math.abs(pd.center.y - p.y) < 1e-6);
  const near = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
  const bend = (a: Vec, b: Vec): Vec | null => { const dx = b.x - a.x, dy = b.y - a.y, ax = Math.abs(dx), ay = Math.abs(dy); if (ax < 1e-9 || ay < 1e-9 || Math.abs(ax - ay) < 1e-9) return null; const d = Math.min(ax, ay); return { x: a.x + Math.sign(dx) * d, y: a.y + Math.sign(dy) * d }; };

  /** 精确几何校验：a→b 半径 radius 的铜在 ls 层上是否与异网络铜 / 板边保持间距。extra = 需要一并检查的新走线。 */
  const makeSafe = (net: string, clearance: number) => {
    const gapFor = (other: string) => Math.max(clearance, netClassFor(board, other)?.clearance ?? 0);
    const foreign = (other: string) => !other || other !== net;
    // 静态铜（焊盘 / 已有走线 / 过孔 / 预留出线通道）与新走线都走空间索引，避免每段线扫全板
    return (a: Vec, b: Vec, radius: number, ls: CopperLayer[], _extraTraces: TraceOut[], _extraVias: ViaOut[], useDyn = true) => {
      if (!pointInPolygon(a, board.outline) || !pointInPolygon(b, board.outline)) return false;
      for (let i = 0; i < board.outline.length; i++) if (segSegDist(a, b, board.outline[i], board.outline[(i + 1) % board.outline.length]) < edge + radius - 1e-6) return false;
      for (const l of ls) {
        if (!space.segmentFree(a, b, radius, l, net, clearance)) return false;
        if (useDyn && !dyn.segmentFree(a, b, radius, l, net, clearance)) return false;
      }
      for (const p of pads) if (p.def.npth && p.layers.some((l) => ls.includes(l)) && segRectDist(a, b, p.rect) < radius + clearance - 1e-6) return false;
      for (const fill of fills) if (foreign(fill.zone.net) && ls.includes(fill.zone.layer)) {
        const expanded = { points: [a, b], width: 2 * (radius + Math.max(gapFor(fill.zone.net), fill.zone.clearance ?? 0)) };
        if (fill.polygons.some((poly) => traceTouchesPolygon(expanded, poly))) return false;
      }
      return true;
    };
  };

  // ---------- A* 工作数组 ----------
  const gScore = new Float64Array(N * L);
  const came = new Int32Array(N * L);
  const heap = new MinHeap();
  const freeStamp = new Int32Array(N * L), freeVal = new Int8Array(N * L);
  const dynS = new Int32Array(N * L), dynV = new Int8Array(N * L);
  const viaStamp = new Int32Array(N), viaVal = new Int8Array(N);
  let generation = 0;
  let routedLines = 0;

  /** 布一条飞线。mode=negotiate：与其他新走线冲突只加代价；strict：视为硬障碍。 */
  const routeLine = (line: RatsnestLine, mode: 'negotiate' | 'strict', pf: number, connectivity: ReturnType<typeof computeRatsnest>): { route?: Route; reason?: string } => {
    generation++;
    const net = line.net, nid = netId(net), nr = netOf(net);
    const preferredWidth = widthOf(net), clearance = clearanceOf(net);
    const pa = padAt(line.a), pb = padAt(line.b);
    const padWidth = Math.min(...[pa, pb].filter((p): p is WorldPad => !!p).map((p) => Math.min(p.rect.w, p.rect.h)));
    const width = Math.max(rules.minTraceWidth, Math.min(preferredWidth, padWidth));
    const outside = [line.a, line.b].filter((q) => !pointInPolygon(q, board.outline));
    if (outside.length) return { reason: `${pa?.ref ?? ''}${pb ? (pa ? '/' : '') + pb.ref : ''} 焊盘在板框外，请先把元件拖进板框` };
    const startLayers = pa ? pa.layers.map(layerIdx).filter((i) => i >= 0) : layers.map((_, i) => i);
    const goalLayers = new Set(pb ? pb.layers.map(layerIdx).filter((i) => i >= 0) : layers.map((_, i) => i));
    const s = toCell(line.a), t = toCell(line.b);
    const componentAt = (p: Vec) => connectivity.components?.find((c) => c.net === net && c.pads.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-6));
    const startAnchors = componentAt(line.a)?.anchors ?? [{ point: line.a, layers: startLayers.map((l) => layers[l]) }];
    const goalAnchors = componentAt(line.b)?.anchors ?? [{ point: line.b, layers: [...goalLayers].map((l) => layers[l]) }];
    const startPoints = new Map<number, Vec>(), goalPoints = new Map<number, Vec>();
    const goal = new Set<number>();
    if (pb) { const sh = width / 2; const cx1 = Math.ceil((pb.rect.x + sh - bb.x) / g), cx2 = Math.floor((pb.rect.x + pb.rect.w - sh - bb.x) / g), cy1 = Math.ceil((pb.rect.y + sh - bb.y) / g), cy2 = Math.floor((pb.rect.y + pb.rect.h - sh - bb.y) / g); for (let y = cy1; y <= cy2; y++) for (let x = cx1; x <= cx2; x++) for (const l of goalLayers) goal.add(idx(x, y, l)); }
    for (const l of goalLayers) goal.add(idx(t.x, t.y, l));
    for (const i of goal) goalPoints.set(i, line.b);
    for (const anchor of goalAnchors) { const p = toCell(anchor.point); if (p.x < 0 || p.y < 0 || p.x >= W || p.y >= H) continue; for (const layer of anchor.layers) { const i = idx(p.x, p.y, layerIdx(layer)); goal.add(i); goalPoints.set(i, anchor.point); } }

    const staticFree = (x: number, y: number, l: number): boolean => {
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      const i = idx(x, y, l);
      if (freeStamp[i] === generation) return freeVal[i] === 1;
      freeStamp[i] = generation; freeVal[i] = -1;
      const p = toWorld(x, y);
      const nearPad = [pa, pb].some((pd) => pd && segRectDist(p, p, pd.rect) < 1.25);
      const localWidth = nearPad ? width : preferredWidth;
      if (edgeDistance[y * W + x] < edge + localWidth / 2 - 1e-6) return false;
      if (!space.free(p, localWidth / 2, layers[l], net, clearance)) return false;
      for (const fill of fills) if (fill.zone.net !== net && fill.zone.layer === layers[l] && fill.polygons.some((poly) => traceTouchesPolygon({ points: [p, p], width: width + 2 * clearance }, poly))) return false;
      freeVal[i] = 1;
      return true;
    };
    const hw = preferredWidth / 2;
    const dynFree = (x: number, y: number, l: number): boolean => {
      const i = idx(x, y, l);
      if (dynS[i] === generation) return dynV[i] === 1;
      dynS[i] = generation;
      const p = toWorld(x, y);
      const nearPad = [pa, pb].some((pd) => pd && segRectDist(p, p, pd.rect) < 1.25);
      const ok = dyn.free(p, (nearPad ? width : preferredWidth) / 2, layers[l], net, clearance);
      dynV[i] = ok ? 1 : -1;
      return ok;
    };
    const free = (x: number, y: number, l: number) => {
      if (!staticFree(x, y, l)) return false;
      if (mode === 'strict') return dynFree(x, y, l);
      const c = conflictAt(idx(x, y, l), nid, hw, net); return c === 0 || c === 1;
    };
    const viaDrill = Math.max(rules.minDrill, netClassFor(board, net)?.viaDrill ?? 0.3);
    const viaSize = Math.max(netClassFor(board, net)?.viaSize ?? 0.6, viaDrill + 2 * rules.minAnnularRing);
    const viaFree = (x: number, y: number): boolean => {
      const i = y * W + x;
      if (viaStamp[i] === generation) return viaVal[i] === 1;
      viaStamp[i] = generation; viaVal[i] = -1;
      if (edgeDistance[i] < edge + viaSize / 2 - 1e-6) return false;
      const p = toWorld(x, y);
      if (!layers.every((layer) => space.free(p, viaSize / 2, layer, net, clearance))) return false;
      for (const fill of fills) if (fill.zone.net !== net && fill.polygons.some((poly) => traceTouchesPolygon({ points: [p, p], width: viaSize + 2 * clearance }, poly))) return false;
      viaVal[i] = 1;
      return true;
    };
    const viaConflict = (x: number, y: number): number => { let c = 0; for (let l = 0; l < L; l++) { const k = conflictAt(idx(x, y, l), nid, viaSize / 2, net); if (k === 2) return -1; if (k) c++; } return c; };
    // 层方向偏好：偶数层偏水平、奇数层偏垂直（2 层板：顶层水平、底层垂直）
    const dirPen = (l: number, dx: number, dy: number) => (L < 2 ? 0 : (l % 2 === 0 ? (dy !== 0 ? (dx !== 0 ? 0.12 : 0.25) : 0) : (dx !== 0 ? (dy !== 0 ? 0.12 : 0.25) : 0)));

    gScore.fill(Infinity); came.fill(-1); heap.clear();
    const h = (x: number, y: number) => 1.15 * Math.hypot(x - t.x, y - t.y);
    for (const anchor of startAnchors) {
      const p = toCell(anchor.point); if (p.x < 0 || p.y < 0 || p.x >= W || p.y >= H) continue;
      for (const layer of anchor.layers) { const l = layerIdx(layer); if (!free(p.x, p.y, l)) continue; const i = idx(p.x, p.y, l); gScore[i] = 0; heap.push(h(p.x, p.y), i); startPoints.set(i, anchor.point); }
    }
    let found = -1, expanded = 0;
    while (heap.size) {
      const { i, f } = heap.pop();
      const cellX = (i % N) % W, cellY = Math.floor((i % N) / W);
      if (f > gScore[i] + h(cellX, cellY) + 1e-9) continue;
      if (goal.has(i)) { found = i; break; }
      if (++expanded > maxNodes) break;
      const l = Math.floor(i / N), rem = i % N, y = Math.floor(rem / W), x = rem % W;
      const gi = gScore[i];
      const prev = came[i];
      const px = prev >= 0 ? (prev % N) % W : -1, py = prev >= 0 ? Math.floor((prev % N) / W) : -1;
      for (const [dx, dy, c] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!free(nx, ny, l)) continue;
        if (dx && dy && (!free(x + dx, y, l) || !free(x, y + dy, l))) continue;
        const ni = idx(nx, ny, l);
        const turn = prev >= 0 && (x - px !== dx || y - py !== dy) ? 0.8 : 0;
        const own = (occ[ni] === nid || ownOnlyAt(ni, nid)) && !goal.has(ni) ? 0.6 : 0;
        const congestion = mode === 'negotiate' && conflictAt(ni, nid, hw, net) === 1 ? pf * (1 + hist[ni]) : 0;
        const ng = gi + c + turn + own + dirPen(l, dx, dy) + congestion;
        if (ng < gScore[ni]) { gScore[ni] = ng; came[ni] = i; heap.push(ng + h(nx, ny), ni); }
      }
      if (L > 1 && viaFree(x, y)) {
        const vc = mode === 'strict' ? (layers.every((layer) => dyn.free(toWorld(x, y), viaSize / 2, layer, net, clearance)) ? 0 : -1) : viaConflict(x, y);
        if (vc >= 0 && !(mode === 'strict' && vc)) for (let nl = 0; nl < L; nl++) {
          if (nl === l) continue;
          const ni = idx(x, y, nl); const ng = gi + viaCost + (vc ? pf * vc * (1 + hist[ni]) : 0);
          if (ng < gScore[ni]) { gScore[ni] = ng; came[ni] = i; heap.push(ng + h(x, y), ni); }
        }
      }
    }
    if (found < 0) {
      const startBlocked = !startLayers.some((l) => DIRS.some(([dx, dy]) => staticFree(s.x + dx, s.y + dy, l)));
      const goalBlocked = ![...goalLayers].some((l) => DIRS.some(([dx, dy]) => staticFree(t.x + dx, t.y + dy, l)));
      return { reason: expanded > maxNodes ? '搜索空间过大（板子太大或栅格太细）' : startBlocked ? `${pa?.ref ?? '起点'} 焊盘周围没有走线空间（与其他焊盘/走线太近，或板边留白不够）` : goalBlocked ? `${pb?.ref ?? '终点'} 焊盘周围没有走线空间` : `没有找到不违反间距的路径（可尝试移动元件、${board.copperCount === 2 ? '改 4 层或' : ''}减小线宽）` };
    }
    // 回溯路径，按层切段，层变化处放过孔
    const path: { x: number; y: number; l: number }[] = [];
    for (let i = found; i >= 0; i = came[i]) path.push({ l: Math.floor(i / N), y: Math.floor((i % N) / W), x: (i % N) % W });
    path.reverse();
    const sourcePoint = startPoints.get(idx(path[0].x, path[0].y, path[0].l)) ?? line.a;
    const targetPoint = goalPoints.get(found) ?? line.b;
    const traces: TraceOut[] = [], vias: ViaOut[] = [];
    let seg: Vec[] = [];
    let curL = path[0].l;
    const flush = () => { if (seg.length >= 2) traces.push({ layer: layers[curL], net, width, points: simplify(seg) }); seg = []; };
    for (let k = 0; k < path.length; k++) {
      const p = path[k];
      if (p.l !== curL) {
        const at = k === 1 && seg.length === 1 ? { ...sourcePoint } : k === path.length - 1 && p.x === t.x && p.y === t.y ? { ...targetPoint } : toWorld(p.x, p.y);
        flush();
        vias.push({ x: at.x, y: at.y, size: viaSize, drill: viaDrill, net });
        curL = p.l; seg = [at];
        continue;
      }
      seg.push(toWorld(p.x, p.y));
    }
    flush();
    const first = traces[0], last = traces[traces.length - 1];
    if (!first) { const m = bend(sourcePoint, targetPoint); traces.push({ layer: layers[path[0].l], net, width, points: m ? [{ ...sourcePoint }, m, { ...targetPoint }] : [{ ...sourcePoint }, { ...targetPoint }] }); }
    else {
      if (!near(first.points[0], sourcePoint)) { const m = bend(sourcePoint, first.points[0]); first.points.unshift(...(m ? [{ ...sourcePoint }, m] : [{ ...sourcePoint }])); }
      if (!near(last.points[last.points.length - 1], targetPoint)) { const m = bend(last.points[last.points.length - 1], targetPoint); last.points.push(...(m ? [m, { ...targetPoint }] : [{ ...targetPoint }])); }
      first.points = simplify(first.points);
      if (last !== first) last.points = simplify(last.points);
    }
    // 几何校验对象：协商模式只看静态铜，严格模式连其他网络的新走线一起看
    const safe = makeSafe(net, clearance);
    const extraT: TraceOut[] = [], extraV: ViaOut[] = []; const useDyn = mode === 'strict';
    let candidate = traces;
    // 收窄只保留在焊盘附近的短出线，其余恢复网络类线宽
    if (width < preferredWidth) {
      const widened: TraceOut[] = [];
      for (const tr of candidate) for (let i = 1; i < tr.points.length; i++) {
        const a = tr.points[i - 1], b = tr.points[i], length = Math.hypot(b.x - a.x, b.y - a.y);
        const count = Math.max(1, Math.ceil(length / 0.75));
        for (let k = 0; k < count; k++) {
          const at = (u: number) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
          const aa = at(k / count), bb2 = at((k + 1) / count);
          const w = safe(aa, bb2, preferredWidth / 2, [tr.layer], extraT, extraV, useDyn) ? preferredWidth : width;
          const prev = widened[widened.length - 1];
          if (prev && prev.layer === tr.layer && prev.width === w && Math.hypot(prev.points[prev.points.length - 1].x - aa.x, prev.points[prev.points.length - 1].y - aa.y) < 1e-8) prev.points.push(bb2);
          else widened.push({ ...tr, width: w, points: [aa, bb2] });
        }
      }
      candidate = widened.map((tr) => ({ ...tr, points: simplify(tr.points) }));
    }
    const ok = candidate.every((tr) => tr.points.slice(1).every((b, i) => safe(tr.points[i], b, tr.width / 2, [tr.layer], extraT, extraV, useDyn))) && vias.every((v) => safe(v, v, v.size / 2, layers, extraT, extraV, useDyn));
    if (!ok) return { reason: '焊盘出线或过孔不满足实际铜间距，已跳过' };
    void nr;
    return { route: { key: keyOf(line), traces: candidate, vias } };
  };

  /** 把一个网络的全部飞线布完（网络内逐条，每条后重算连通性）。返回是否有失败。 */
  const routeNet = (net: string, mode: 'negotiate' | 'strict', pf: number) => {
    const nr = netOf(net);
    const tried = new Set<string>();
    for (let guard = 0; guard < 200; guard++) {
      const connectivity = computeRatsnest(netBoard(net), rules, fillsOf(net));
      const ls = connectivity.lines.filter((l) => l.net === net && netFilter(l) && !tried.has(keyOf(l)));
      if (!ls.length) break;
      const len = (l: RatsnestLine) => Math.hypot(l.a.x - l.b.x, l.a.y - l.b.y);
      ls.sort((a, b) => len(a) - len(b));
      const line = ls[0]; const key = keyOf(line); tried.add(key);
      const r = routeLine(line, mode, pf, connectivity);
      if (r.route) { nr.routes.push(r.route); nr.failures.delete(key); routedLines++; }
      else nr.failures.set(key, r.reason!);
      let done = 0; for (const x of nets.values()) done += x.routes.length;
      opts.onProgress?.(Math.min(done, result.total), result.total, net);
    }
  };
  const conflictNets = (): NetRoutes[] => [...nets.values()].filter(netHasConflict);

  // ---------- 主流程 ----------
  const priority = new Map((opts.priorityNets ?? []).map((n, i) => [n, i]));
  const netLength = new Map<string, number>();
  for (const l of initialLines) netLength.set(l.net, (netLength.get(l.net) ?? 0) + Math.hypot(l.a.x - l.b.x, l.a.y - l.b.y));
  const order = [...netNames].sort((a, b) => (priority.get(a) ?? 1e9) - (priority.get(b) ?? 1e9) || netLength.get(a)! - netLength.get(b)!);
  const retryable = (nr: NetRoutes) => [...nr.failures.values()].some((r) => !/板框外/.test(r));
  const sortNets = (list: NetRoutes[]) => list.sort((a, b) => (priority.get(a.net) ?? 1e9) - (priority.get(b.net) ?? 1e9) || netLength.get(a.net)! - netLength.get(b.net)!);
  /** 与某网络实际冲突的其他网络 id 集合。 */
  const partnersOf = (nr: NetRoutes): Set<number> => {
    const out = new Set<number>(); if (!nr.cells) return out;
    for (const i of nr.cells) { if (cnt[i] < 2) continue; const mineFirst = own1[i] === nr.nid; if (!mineFirst && own2[i] !== nr.nid) continue; const other = mineFirst ? own2[i] : own1[i]; const dOther = mineFirst ? d2[i] : d1[i]; const dMine = mineFirst ? d1[i] : d2[i]; if (other && dMine <= 1e-9 && dOther < gapBetween(nr.net, nameOfNid.get(other) ?? '') - 1e-6) out.add(other); }
    return out;
  };
  let rounds = 0;
  void useMarks; void conflictNets;
  /** 一组网络按"全局最短飞线优先"交替布线（先布完 priority 组的所有线）；每条线布完只重算该网络的连通性。 */
  const routeGroup = (group: NetRoutes[], mode: 'negotiate' | 'strict', pf: number, first: Set<string> = new Set()) => {
    const pending = new Map<string, RatsnestLine[]>();
    const conn = new Map<string, ReturnType<typeof computeRatsnest>>();
    const tried = new Set<string>();
    const refresh = (net: string) => { const c = computeRatsnest(netBoard(net), rules, fillsOf(net)); conn.set(net, c); pending.set(net, c.lines.filter((l) => l.net === net && netFilter(l) && !tried.has(keyOf(l)))); };
    for (const nr of group) refresh(nr.net);
    const len = (l: RatsnestLine) => Math.hypot(l.a.x - l.b.x, l.a.y - l.b.y);
    for (let guard = 0; guard < 5000; guard++) {
      let best: RatsnestLine | null = null, bestScore = Infinity;
      for (const [net, ls] of pending) for (const l of ls) { const sc = (first.has(net) ? 0 : 1e6) + (priority.has(net) ? -5e5 : 0) + len(l); if (sc < bestScore) { bestScore = sc; best = l; } }
      if (!best) break;
      const net = best.net, nr = netOf(net), key = keyOf(best); tried.add(key);
      unmarkNet(nr);
      const r = routeLine(best, mode, pf, conn.get(net)!);
      if (r.route) { nr.routes.push(r.route); nr.failures.delete(key); routedLines++; } else nr.failures.set(key, r.reason!);
      markNet(nr);
      refresh(net);
      let done = 0; for (const x of nets.values()) done += x.routes.length;
      opts.onProgress?.(Math.min(done, result.total), result.total, net);
    }
  };
  // 第 1 阶段：全部网络严格布线（全局最短飞线优先）
  routeGroup([...nets.values()], 'strict', 0);
  /** 挡在失败飞线附近的网络（端点 2.5mm 内或直连线走廊 1mm 内有其新走线）。 */
  const blockersOf = (failedNets: NetRoutes[], radius = 2.5): NetRoutes[] => {
    const lines = remainingLines().filter((l) => failedNets.some((n) => n.net === l.net));
    const out = new Set<NetRoutes>();
    for (const nr of nets.values()) {
      if (failedNets.includes(nr) || !nr.routes.length) continue;
      const hit = nr.routes.some((r) => r.traces.some((t) => t.points.some((p) => lines.some((l) => Math.hypot(p.x - l.a.x, p.y - l.a.y) < radius || Math.hypot(p.x - l.b.x, p.y - l.b.y) < radius || pointSegDist(p, l.a, l.b) < radius * 0.4))) || r.vias.some((v) => lines.some((l) => Math.hypot(v.x - l.a.x, v.y - l.a.y) < radius || Math.hypot(v.x - l.b.x, v.y - l.b.y) < radius)));
      if (hit) out.add(nr);
    }
    return [...out];
  };
  // 第 2 阶段：拆线重布——失败网络 + 挡路网络一起拆掉，失败网络优先重布，挡路网络随后按最短优先补回；变差则回滚
  let rollbacks = 0;
  for (let pass = 0; pass < 4 && rollbacks < 1; pass++) {
    const failedNets = [...nets.values()].filter(retryable);
    if (!failedNets.length || Date.now() > deadline) break;
    const blockers = blockersOf(failedNets, 2.5 + pass * 1.5);
    if (!blockers.length) break;
    rounds++;
    opts.debug?.({ pass, t: Date.now() - t0, failed: failedNets.map((n) => n.net), blockers: blockers.length });
    const before = remainingLines().length;
    const subset = [...failedNets, ...blockers];
    const snapshot = new Map(subset.map((nr) => [nr, { routes: nr.routes, failures: new Map(nr.failures) }]));
    for (const nr of subset) ripNet(nr);
    routeGroup(subset, 'strict', 0, new Set(failedNets.map((n) => n.net)));
    const after = remainingLines().length;
    if (after >= before) { rollbacks++; for (const [nr, snap] of snapshot) { ripNet(nr); nr.routes = snap.routes; nr.failures = snap.failures; markNet(nr); } } // 没有变好：回滚，下一轮扩大拆线范围；连续两次无效即停
  }
  // 第 3 阶段：还有失败就整板重布一到两次，失败网络优先（相当于换一种布线顺序）；没有变好则回滚
  for (let attempt = 0; attempt < 1; attempt++) {
    const failedNets = [...nets.values()].filter(retryable);
    if (!failedNets.length || Date.now() > deadline || Date.now() - t0 > 20000) break; // 大板不再整板重布，时间花在刀刃上
    rounds++;
    opts.debug?.({ full: attempt, t: Date.now() - t0, failed: failedNets.map((n) => n.net) });
    const before = remainingLines().length;
    const all = [...nets.values()];
    const snapshot = new Map(all.map((nr) => [nr, { routes: nr.routes, failures: new Map(nr.failures) }]));
    for (const nr of all) ripNet(nr);
    routeGroup(all, 'strict', 0, new Set(failedNets.map((n) => n.net)));
    const after = remainingLines().length;
    if (after >= before) { for (const [nr, snap] of snapshot) { ripNet(nr); nr.routes = snap.routes; nr.failures = snap.failures; markNet(nr); } break; }
  }
  let stuck: NetRoutes[] = [];
  // 最终几何校验（保守栅格标记之外的漏网之鱼）：不合格的网络严格重布一次
  for (let pass = 0; pass < 2; pass++) {
    const invalid: NetRoutes[] = [];
    for (const nr of nets.values()) {
      if (!nr.routes.length) continue;
      const safe = makeSafe(nr.net, clearanceOf(nr.net));
      const extraT: TraceOut[] = [], extraV: ViaOut[] = [];
      const ok = nr.routes.every((r) => r.traces.every((tr) => tr.points.slice(1).every((b, i) => safe(tr.points[i], b, tr.width / 2, [tr.layer], extraT, extraV))) && r.vias.every((v) => safe(v, v, v.size / 2, layers, extraT, extraV)));
      if (!ok) invalid.push(nr);
    }
    if (!invalid.length) break;
    for (const nr of invalid) ripNet(nr);
    for (const nr of invalid) { routeNet(nr.net, 'strict', 0); markNet(nr); }
    if (pass === 1) for (const nr of invalid) { // 仍不合格：放弃，避免交付违规走线
      const safe = makeSafe(nr.net, clearanceOf(nr.net)); const extraT: TraceOut[] = [], extraV: ViaOut[] = [];
      const ok = nr.routes.every((r) => r.traces.every((tr) => tr.points.slice(1).every((b, i) => safe(tr.points[i], b, tr.width / 2, [tr.layer], extraT, extraV))) && r.vias.every((v) => safe(v, v, v.size / 2, layers, extraT, extraV)));
      if (!ok) { ripNet(nr); nr.failures.set('*', '与其他新走线的实际铜间距不足，已放弃'); }
    }
  }
  stuck = conflictNets();
  // 45° 倒角：直角拐点改成斜切（校验通过才替换）
  for (const nr of nets.values()) {
    const safe = makeSafe(nr.net, clearanceOf(nr.net));
    const extraT: TraceOut[] = [], extraV: ViaOut[] = [];
    for (const r of nr.routes) for (const tr of r.traces) {
      const pts = tr.points; if (pts.length < 3) continue;
      const out: Vec[] = [pts[0]];
      for (let i = 1; i < pts.length - 1; i++) {
        const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
        const v1 = { x: b.x - a.x, y: b.y - a.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
        const l1 = Math.hypot(v1.x, v1.y), l2 = Math.hypot(v2.x, v2.y);
        const right = l1 > 1e-9 && l2 > 1e-9 && Math.abs(v1.x * v2.x + v1.y * v2.y) < 1e-9 && (Math.abs(v1.x) < 1e-9 || Math.abs(v1.y) < 1e-9);
        if (right) {
          const cut = Math.min(l1 / 2, l2 / 2, Math.max(g, 1.5));
          if (cut >= g - 1e-9) {
            const a2 = { x: b.x - (v1.x / l1) * cut, y: b.y - (v1.y / l1) * cut }, c2 = { x: b.x + (v2.x / l2) * cut, y: b.y + (v2.y / l2) * cut };
            if (safe(a2, c2, tr.width / 2, [tr.layer], extraT, extraV)) { out.push(a2, c2); continue; }
          }
        }
        out.push(b);
      }
      out.push(pts[pts.length - 1]);
      tr.points = simplify(out);
    }
  }
  // ---------- 汇总 ----------
  for (const nr of nets.values()) for (const r of nr.routes) { result.traces.push(...r.traces); result.vias.push(...r.vias); }
  const remaining = remainingLines();
  const unresolved = new Set(remaining.map((l) => l.net));
  for (const nr of nets.values()) {
    if (!unresolved.has(nr.net)) continue;
    const reasons = [...nr.failures.values()];
    result.failed.push({ net: nr.net, reason: reasons[reasons.length - 1] ?? (stuck.some((s) => s.net === nr.net) ? '与其他网络冲突且无法绕开（可尝试移动元件或改 4 层）' : '没有找到不违反间距的路径') });
  }
  result.routed = Math.max(0, result.total - remaining.length);
  result.rounds = rounds;
  result.ms = Date.now() - t0;
  if (opts.allowComponentMoves && result.routed < result.total) {
    const moves = suggestRoutingMoves(board, rules, result.failed.map((f) => f.net));
    if (moves.length) {
      const relocated: Board = { ...board, footprints: board.footprints.map((fp) => { const m = moves.find((mm) => mm.id === fp.id); return m ? { ...fp, x: m.x, y: m.y } : fp; }) };
      const candidate = autoroute(relocated, rules, { ...opts, allowComponentMoves: false, noRetry: true });
      if (candidate.total - candidate.routed < result.total - result.routed) {
        candidate.moves = moves; candidate.total = result.total;
        candidate.routed = result.total - computeRatsnest({ ...relocated, traces: [...relocated.traces, ...candidate.traces.map((t, i) => ({ ...t, id: `test-t${i}` }))], vias: [...relocated.vias, ...candidate.vias.map((v, i) => ({ ...v, id: `test-v${i}` }))] }, rules).lines.filter(netFilter).length;
        candidate.ms = Date.now() - t0;
        return candidate;
      }
    }
  }
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
