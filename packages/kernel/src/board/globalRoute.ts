/**
 * 全局路由：在粗网格（约 1.5mm）上用协商拥塞（PathFinder）为每条连接规划走廊与层，
 * 细节布线只在走廊内的细网格搜索。粗格容量按静态障碍采样估计（能并行通过几条线）。
 */
import type { Vec } from '../geometry.js';
import type { RatsnestLine } from './ratsnest.js';

export interface GlobalRouteInput {
  W: number; H: number; L: number;
  /** 每个粗格包含的细格数 */
  f: number;
  lines: RatsnestLine[];
  /** 细格坐标 → 世界坐标 */
  toCell: (p: Vec) => { x: number; y: number };
  /** 细格是否可走（无网络上下文，所有铜都算障碍） */
  cellFree: (x: number, y: number, l: number) => boolean;
  viaFree: (x: number, y: number) => boolean;
  /** 焊盘所在层（细格坐标处），undefined = 任意层 */
  layersAt: (p: Vec) => number[] | undefined;
  /** 典型线距（线宽 + 间距，mm）与粗格边长（mm），用于容量 */
  pitch: number; coarseMm: number;
  maxIters?: number;
  deadline?: number;
  /** 走廊膨胀格数（默认 1） */
  dilate?: number;
}
export interface GlobalRouteResult { CW: number; CH: number; f: number; /** net → 粗格允许掩码（CW*CH*L） */ corridors: Map<string, Uint8Array>; iterations: number; overused: number }

const DIRS4: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function globalRoute(inp: GlobalRouteInput): GlobalRouteResult {
  const { W, H, L, f, lines } = inp;
  const CW = Math.ceil(W / f), CH = Math.ceil(H / f), CN = CW * CH;
  const cidx = (x: number, y: number, l: number) => (l * CH + y) * CW + x;
  // 容量与过孔可行性采样
  const cap = new Float32Array(CN * L), viaOk = new Uint8Array(CN);
  const S = 4; // 每格 4×4 采样
  for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CW; cx++) {
    let anyVia = false;
    for (let l = 0; l < L; l++) {
      let free = 0, total = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const x = Math.min(W - 1, cx * f + Math.floor(((sx + 0.5) * f) / S)), y = Math.min(H - 1, cy * f + Math.floor(((sy + 0.5) * f) / S));
        total++; if (inp.cellFree(x, y, l)) { free++; if (l === 0 && !anyVia && inp.viaFree(x, y)) anyVia = true; }
      }
      const frac = free / total;
      // 只要有明显空隙就至少能过一条线；完全被占的格容量为 0
      cap[cidx(cx, cy, l)] = frac >= 0.25 ? Math.max(1, frac * (inp.coarseMm / inp.pitch)) : frac * (inp.coarseMm / inp.pitch);
    }
    viaOk[cy * CW + cx] = anyVia ? 1 : 0;
  }
  const usage = new Float32Array(CN * L), hist = new Float32Array(CN * L);
  const paths = new Map<number, number[]>(); // 连接序号 → 粗格节点序列
  const termCells = (p: Vec) => { const c = inp.toCell(p); return { x: Math.max(0, Math.min(CW - 1, Math.floor(c.x / f))), y: Math.max(0, Math.min(CH - 1, Math.floor(c.y / f))) }; };
  const viaCost = 2.5;
  const gScore = new Float64Array(CN * L), came = new Int32Array(CN * L);
  const order = lines.map((l, i) => i).sort((a, b) => dist(lines[a]) - dist(lines[b]));
  let pres = 0.5, iterations = 0, overused = 0;
  const maxIters = inp.maxIters ?? 30;
  const cost = (n: number) => { const over = Math.max(0, usage[n] + 1 - cap[n]); return (1 + hist[n]) * (1 + pres * over); };
  for (let iter = 0; iter < maxIters; iter++) {
    iterations = iter + 1;
    for (const ci of order) {
      const line = lines[ci];
      const old = paths.get(ci); if (old) { for (let k = 1; k < old.length - 1; k++) usage[old[k]] -= 1; paths.delete(ci); }
      const s = termCells(line.a), t = termCells(line.b);
      const sl = inp.layersAt(line.a) ?? [...Array(L).keys()], tl = new Set(inp.layersAt(line.b) ?? [...Array(L).keys()]);
      gScore.fill(Infinity); came.fill(-1);
      const heap: { f: number; i: number }[] = [];
      const push = (fv: number, i: number) => { heap.push({ f: fv, i }); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p].f <= heap[k].f) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
      const pop = () => { const top = heap[0]; const last = heap.pop()!; if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l].f < heap[m].f) m = l; if (r < heap.length && heap[r].f < heap[m].f) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
      const h = (x: number, y: number) => Math.abs(x - t.x) + Math.abs(y - t.y);
      for (const l of sl) { const i = cidx(s.x, s.y, l); gScore[i] = 0; push(h(s.x, s.y), i); }
      let found = -1;
      while (heap.length) {
        const { i, f: fv } = pop();
        const l = Math.floor(i / CN), rem = i % CN, y = Math.floor(rem / CW), x = rem % CW;
        if (fv > gScore[i] + h(x, y) + 1e-9) continue;
        if (x === t.x && y === t.y && tl.has(l)) { found = i; break; }
        const gi = gScore[i];
        for (const [dx, dy] of DIRS4) {
          const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= CW || ny >= CH) continue;
          const ni = cidx(nx, ny, l); if (cap[ni] <= 0.05 && !(nx === t.x && ny === t.y)) continue;
          // 层方向偏好：偶数层横、奇数层竖
          const dirPen = L > 1 ? ((l % 2 === 0) === (dy !== 0) ? 0.35 : 0) : 0;
          const ng = gi + cost(ni) + dirPen;
          if (ng < gScore[ni]) { gScore[ni] = ng; came[ni] = i; push(ng + h(nx, ny), ni); }
        }
        if (L > 1 && viaOk[rem]) for (let nl = 0; nl < L; nl++) { if (nl === l) continue; const ni = cidx(x, y, nl); if (cap[ni] <= 0.05) continue; const ng = gi + viaCost + cost(ni); if (ng < gScore[ni]) { gScore[ni] = ng; came[ni] = i; push(ng + h(x, y), ni); } }
      }
      if (found < 0) continue;
      const path: number[] = []; for (let i = found; i >= 0; i = came[i]) path.push(i);
      // 端点所在格（焊盘格）不计入用量：那里必然拥挤但不可回避
      for (let k = 1; k < path.length - 1; k++) usage[path[k]] += 1;
      paths.set(ci, path);
    }
    overused = 0; for (let n = 0; n < CN * L; n++) if (usage[n] > cap[n] + 1e-6) { overused++; hist[n] += usage[n] - cap[n]; }
    if (!overused || (inp.deadline && Date.now() > inp.deadline)) break;
    pres *= 1.6;
  }
  // 走廊：每个网络的路径格（同层四邻膨胀一格）+ 过孔格两层
  const corridors = new Map<string, Uint8Array>();
  for (const [ci, path] of paths) {
    const net = lines[ci].net;
    let m = corridors.get(net); if (!m) { m = new Uint8Array(CN * L); corridors.set(net, m); }
    for (let k = 0; k < path.length; k++) {
      const n = path[k]; const l = Math.floor(n / CN), rem = n % CN, y = Math.floor(rem / CW), x = rem % CW;
      const D = inp.dilate ?? 1;
      for (let dy = -D; dy <= D; dy++) for (let dx = -D; dx <= D; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < CW && ny < CH) m[cidx(nx, ny, l)] = 1; }
      if (k > 0 && Math.floor(path[k - 1] / CN) !== l) for (let ll = 0; ll < L; ll++) m[cidx(x, y, ll)] = 1; // 换层处两层都开
    }
  }
  return { CW, CH, f, corridors, iterations, overused };
}
const dist = (l: RatsnestLine) => Math.hypot(l.a.x - l.b.x, l.a.y - l.b.y);
