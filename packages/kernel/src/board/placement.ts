/**
 * 布局检查与优化：在自动布线之前，按"连接关系、远近、信号干扰、空间均衡、最小间距、对齐"给出问题清单，
 * 并用模拟退火给出可预览的移动建议（不改动锁定件、连接器、安装孔与已有走线的器件）。
 * 目标函数：飞线半周长（HPWL）+ 去耦电容贴近芯片电源脚 + 晶振贴近主控 + 敏感网络远离开关网络
 *          + 本体不重叠 / 不出板 / 最小间距 + 对齐到 0.5mm 栅格。
 */
import type { Board, BoardFootprint } from '../model/board.js';
import type { RuleSet } from '../model/project.js';
import { allPads, footprintBody, boardBounds, type WorldPad } from './geometry.js';
import { pointInPolygon, type Rect, type Vec } from '../geometry.js';
import { autoroute } from './autoroute.js';

export interface PlacementIssue { rule: 'overlap' | 'outside' | 'spacing' | 'decoupling' | 'crystal' | 'connector-edge' | 'noise' | 'long-net' | 'alignment'; severity: 'error' | 'warning' | 'info'; message: string; refs: string[]; location?: Vec; suggestion?: string }
export interface PlacementMetrics { hpwl: number; overlaps: number; outside: number; decouplingAvg: number; issues: number }
export interface PlacementResult { moves: { id: string; ref: string; x: number; y: number; rotation?: number; from: { x: number; y: number; rotation: number } }[]; before: PlacementMetrics; after: PlacementMetrics; iterations: number; ms: number; /** 用自动布线验证前后（verifyRouting） */ routing?: { before: { routed: number; total: number; vias: number; length: number }; after: { routed: number; total: number; vias: number; length: number } }; /** 布线验证变差，建议已丢弃 */ rejected?: string; /** 完整建议布线变差时回退为保守子集 */ fallback?: boolean }
export interface PlacementOptions { timeBudgetMs?: number; /** 固定迭代次数（给定 seed 时结果可复现；默认按时间预算） */ iterations?: number; seed?: number; moveConnectors?: boolean; grid?: number; keepRotation?: boolean; /** 单个器件最大位移（mm，默认 8） */ maxMove?: number; /** 用自动布线对比前后，变差则丢弃建议（默认开） */ verifyRouting?: boolean; routeBudgetMs?: number; onProgress?: (stage: string) => void }

const POWER_RE = /^(\+|vcc|vdd|v[0-9]|3v3|5v|vbus|vin|avdd|dvdd|vbat)/i;
const GND_RE = /^(gnd|vss|agnd|dgnd|pgnd)/i;
const CLOCK_RE = /(xtal|osc|clk|clock|mclk|sclk)/i;
const ANALOG_RE = /(adc|ain|analog|vref|sense|mic|audio|dac)/i;
const SWITCH_RE = /(sw_|_sw$|^sw|pwm|boost|buck|lx$|drv|motor|relay|usb_d)/i;
const CONNECTOR_RE = /^(J|P|CN|USB|X|SW|BT|H|MH|TP|FID)\d/i;

interface Ctx { board: Board; pads: WorldPad[]; nets: Map<string, WorldPad[]>; byFp: Map<string, WorldPad[]>; outline: Vec[]; bb: Rect }
function ctxOf(board: Board): Ctx {
  const pads = allPads(board).filter((p) => !p.def.npth);
  const nets = new Map<string, WorldPad[]>(), byFp = new Map<string, WorldPad[]>();
  for (const p of pads) { if (p.net) { if (!nets.has(p.net)) nets.set(p.net, []); nets.get(p.net)!.push(p); } if (!byFp.has(p.footprintId)) byFp.set(p.footprintId, []); byFp.get(p.footprintId)!.push(p); }
  return { board, pads, nets, byFp, outline: board.outline, bb: boardBounds(board) };
}
const hpwl = (ps: Vec[]) => { if (ps.length < 2) return 0; let x1 = Infinity, x2 = -Infinity, y1 = Infinity, y2 = -Infinity; for (const p of ps) { if (p.x < x1) x1 = p.x; if (p.x > x2) x2 = p.x; if (p.y < y1) y1 = p.y; if (p.y > y2) y2 = p.y; } return x2 - x1 + (y2 - y1); };
const rectGap = (a: Rect, b: Rect) => Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), 0, b.y - (a.y + a.h), a.y - (b.y + b.h));
const overlapArea = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const isIc = (f: BoardFootprint, byFp: Map<string, WorldPad[]>) => (byFp.get(f.id)?.length ?? 0) >= 4 && /^(U|IC|Q)\d/i.test(f.ref);
const isCap = (f: BoardFootprint, byFp: Map<string, WorldPad[]>) => /^C\d/i.test(f.ref) && (byFp.get(f.id)?.length ?? 0) === 2;
const isCrystal = (f: BoardFootprint) => /^(Y|X)\d/i.test(f.ref) || /(mhz|khz|crystal|xtal|resonator)/i.test(f.value);

/** 去耦对：电容（电源 + 地）→ 同电源网络上最近的 IC 引脚。 */
function decouplingPairs(c: Ctx): { cap: BoardFootprint; pin: WorldPad; ic: BoardFootprint }[] {
  const out: { cap: BoardFootprint; pin: WorldPad; ic: BoardFootprint }[] = [];
  for (const f of c.board.footprints) {
    if (!isCap(f, c.byFp)) continue;
    const ps = c.byFp.get(f.id)!; const power = ps.find((p) => POWER_RE.test(p.net)), gnd = ps.find((p) => GND_RE.test(p.net));
    if (!power || !gnd) continue;
    let best: { pin: WorldPad; ic: BoardFootprint; d: number } | null = null;
    for (const p of c.nets.get(power.net) ?? []) { const ic = c.board.footprints.find((x) => x.id === p.footprintId); if (!ic || !isIc(ic, c.byFp)) continue; const d = Math.hypot(p.center.x - power.center.x, p.center.y - power.center.y); if (!best || d < best.d) best = { pin: p, ic, d }; }
    if (best) out.push({ cap: f, pin: best.pin, ic: best.ic });
  }
  return out;
}
/** 晶振 → 与之共享网络、引脚最多的 IC。 */
function crystalPairs(c: Ctx): { xtal: BoardFootprint; ic: BoardFootprint }[] {
  const out: { xtal: BoardFootprint; ic: BoardFootprint }[] = [];
  for (const f of c.board.footprints) {
    if (!isCrystal(f)) continue;
    const netsOf = new Set((c.byFp.get(f.id) ?? []).map((p) => p.net).filter((n) => n && !GND_RE.test(n)));
    const counts = new Map<string, number>();
    for (const n of netsOf) for (const p of c.nets.get(n) ?? []) if (p.footprintId !== f.id) counts.set(p.footprintId, (counts.get(p.footprintId) ?? 0) + 1);
    const icId = [...counts.entries()].filter(([id]) => { const x = c.board.footprints.find((y) => y.id === id); return x && isIc(x, c.byFp); }).sort((a, b) => b[1] - a[1])[0]?.[0];
    const ic = c.board.footprints.find((x) => x.id === icId); if (ic) out.push({ xtal: f, ic });
  }
  return out;
}
const classOf = (net: string) => (CLOCK_RE.test(net) ? 'clock' : ANALOG_RE.test(net) ? 'analog' : SWITCH_RE.test(net) ? 'switch' : POWER_RE.test(net) || GND_RE.test(net) ? 'power' : 'signal');

/** 布局问题清单（不改动板子）。 */
export function checkPlacement(board: Board, rules: RuleSet): PlacementIssue[] {
  const c = ctxOf(board); const out: PlacementIssue[] = [];
  const bodies = board.footprints.map((f) => ({ f, r: footprintBody(f) }));
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    const corners = [{ x: a.r.x, y: a.r.y }, { x: a.r.x + a.r.w, y: a.r.y }, { x: a.r.x + a.r.w, y: a.r.y + a.r.h }, { x: a.r.x, y: a.r.y + a.r.h }];
    if (board.outline.length >= 3 && !corners.every((p) => pointInPolygon(p, board.outline))) out.push({ rule: 'outside', severity: 'error', message: `${a.f.ref} 超出板框`, refs: [a.f.ref], location: { x: a.f.x, y: a.f.y }, suggestion: '拖进板内或用「板框适配内容」' });
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j]; if (a.f.side !== b.f.side) continue;
      if (overlapArea(a.r, b.r) > 0) out.push({ rule: 'overlap', severity: 'error', message: `${a.f.ref} 与 ${b.f.ref} 重叠`, refs: [a.f.ref, b.f.ref], location: { x: (a.f.x + b.f.x) / 2, y: (a.f.y + b.f.y) / 2 } });
      else { const g = rectGap(a.r, b.r); if (g < 0.3) out.push({ rule: 'spacing', severity: 'warning', message: `${a.f.ref} 与 ${b.f.ref} 间距 ${g.toFixed(2)}mm，贴片焊接和返修会困难`, refs: [a.f.ref, b.f.ref], location: { x: (a.f.x + b.f.x) / 2, y: (a.f.y + b.f.y) / 2 }, suggestion: '至少留 0.3–0.5mm' }); }
    }
  }
  for (const { cap, pin, ic } of decouplingPairs(c)) { const p = c.byFp.get(cap.id)!.find((x) => POWER_RE.test(x.net))!; const d = Math.hypot(p.center.x - pin.center.x, p.center.y - pin.center.y); if (d > 4) out.push({ rule: 'decoupling', severity: d > 8 ? 'warning' : 'info', message: `去耦电容 ${cap.ref} 离 ${ic.ref} 电源脚 ${pin.number} 有 ${d.toFixed(1)}mm`, refs: [cap.ref, ic.ref], location: { x: cap.x, y: cap.y }, suggestion: '放到电源脚 2–3mm 内，先接电容再进芯片' }); }
  for (const { xtal, ic } of crystalPairs(c)) { const d = Math.hypot(xtal.x - ic.x, xtal.y - ic.y); if (d > 10) out.push({ rule: 'crystal', severity: 'warning', message: `晶振 ${xtal.ref} 离 ${ic.ref} ${d.toFixed(1)}mm`, refs: [xtal.ref, ic.ref], location: { x: xtal.x, y: xtal.y }, suggestion: '晶振紧贴 MCU 的 OSC 引脚，走线短且下面不要走其他信号' }); }
  if (board.outline.length >= 3) for (const { f, r } of bodies) if (CONNECTOR_RE.test(f.ref) && !/^(H|MH|TP|FID|SW)\d/i.test(f.ref)) { let d = Infinity; for (let k = 0; k < board.outline.length; k++) { const a = board.outline[k], b = board.outline[(k + 1) % board.outline.length]; d = Math.min(d, segRectGap(a, b, r)); } if (d > 4) out.push({ rule: 'connector-edge', severity: 'info', message: `连接器 ${f.ref} 离板边 ${d.toFixed(1)}mm`, refs: [f.ref], location: { x: f.x, y: f.y }, suggestion: '接插件一般贴板边，方便插拔与外壳开孔' }); }
  // 干扰：晶振 / 模拟器件与开关 / 电机驱动器件靠太近
  const sensitive = board.footprints.filter((f) => isCrystal(f) || (c.byFp.get(f.id) ?? []).some((p) => classOf(p.net) === 'analog'));
  const noisy = board.footprints.filter((f) => (c.byFp.get(f.id) ?? []).some((p) => classOf(p.net) === 'switch') && !sensitive.includes(f));
  for (const s of sensitive) for (const n of noisy) { const d = rectGap(footprintBody(s), footprintBody(n)); if (d < 3) out.push({ rule: 'noise', severity: 'info', message: `敏感器件 ${s.ref} 与开关/驱动器件 ${n.ref} 相距 ${d.toFixed(1)}mm`, refs: [s.ref, n.ref], location: { x: s.x, y: s.y }, suggestion: '拉开 5mm 以上，或用地铜隔开' }); }
  // 过长飞线
  const diag = Math.hypot(c.bb.w, c.bb.h);
  for (const [net, ps] of c.nets) { if (ps.length < 2 || GND_RE.test(net) || POWER_RE.test(net)) continue; const L = hpwl(ps.map((p) => p.center)); if (L > diag * 0.8) out.push({ rule: 'long-net', severity: 'info', message: `网络 ${net} 横跨整板（${L.toFixed(0)}mm）`, refs: [...new Set(ps.map((p) => p.ref))].slice(0, 4), suggestion: '把相连的器件放近一点，布线更短更好走' }); }
  // 对齐：同一排里差一点点没对齐的小件
  const small = bodies.filter((b) => b.r.w * b.r.h < 12);
  const seen = new Set<string>();
  for (const a of small) for (const b of small) { if (a === b) continue; const key = [a.f.ref, b.f.ref].sort().join('|'); if (seen.has(key)) continue; const dx = Math.abs(a.f.x - b.f.x), dy = Math.abs(a.f.y - b.f.y); if ((dx > 0.05 && dx < 0.6 && dy > 2 && dy < 12) || (dy > 0.05 && dy < 0.6 && dx > 2 && dx < 12)) { seen.add(key); out.push({ rule: 'alignment', severity: 'info', message: `${a.f.ref} 与 ${b.f.ref} 差 ${Math.min(dx > 0.05 && dx < 0.6 ? dx : 9, dy > 0.05 && dy < 0.6 ? dy : 9).toFixed(2)}mm 没对齐`, refs: [a.f.ref, b.f.ref], suggestion: '框选后用对齐工具' }); } }
  return out;
}
function segRectGap(a: Vec, b: Vec, r: Rect): number {
  const cx = Math.max(r.x, Math.min((a.x + b.x) / 2, r.x + r.w)), cy = Math.max(r.y, Math.min((a.y + b.y) / 2, r.y + r.h));
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2; const t = l2 ? Math.max(0, Math.min(1, ((cx - a.x) * (b.x - a.x) + (cy - a.y) * (b.y - a.y)) / l2)) : 0;
  const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  return Math.hypot(Math.max(r.x - q.x, 0, q.x - (r.x + r.w)), Math.max(r.y - q.y, 0, q.y - (r.y + r.h)));
}

export function placementMetrics(board: Board, rules: RuleSet): PlacementMetrics {
  const c = ctxOf(board); let hp = 0; for (const [, ps] of c.nets) hp += hpwl(ps.map((p) => p.center));
  const issues = checkPlacement(board, rules);
  const dp = decouplingPairs(c); const dAvg = dp.length ? dp.reduce((n, { cap, pin }) => n + Math.hypot(cap.x - pin.center.x, cap.y - pin.center.y), 0) / dp.length : 0;
  return { hpwl: Math.round(hp), overlaps: issues.filter((i) => i.rule === 'overlap').length, outside: issues.filter((i) => i.rule === 'outside').length, decouplingAvg: Math.round(dAvg * 10) / 10, issues: issues.length };
}

/** 模拟退火布局优化：返回移动建议（不修改输入）。 */
export function optimizePlacement(board: Board, rules: RuleSet, opts: PlacementOptions = {}): PlacementResult {
  const t0 = Date.now(); const budget = opts.timeBudgetMs ?? 1500; const G = opts.grid ?? 0.5;
  const c = ctxOf(board);
  const wired = new Set<string>();
  for (const p of c.pads) if (board.traces.some((t) => p.layers.includes(t.layer) && t.points.slice(1).some((b, i) => segRectGap(t.points[i], b, p.rect) <= t.width / 2 + 1e-6))) wired.add(p.footprintId);
  const movable = board.footprints.filter((f) => !f.locked && !wired.has(f.id) && (opts.moveConnectors || !CONNECTOR_RE.test(f.ref)) && !(c.byFp.get(f.id) ?? []).every((p) => p.def.npth));
  const before = placementMetrics(board, rules);
  if (movable.length < 2) return { moves: [], before, after: before, iterations: 0, ms: Date.now() - t0 };
  // 工作副本
  const pos = new Map<string, { x: number; y: number; rotation: number }>(); for (const f of board.footprints) pos.set(f.id, { x: f.x, y: f.y, rotation: f.rotation });
  const orig = new Map(board.footprints.map((f) => [f.id, { x: f.x, y: f.y }]));
  const movableIds = movable.map((f) => f.id);
  const maxMove = opts.maxMove ?? 8;
  const fpById = new Map(board.footprints.map((f) => [f.id, f]));
  const padLocal = new Map<string, { dx: number; dy: number; net: string; number: string }[]>();
  for (const f of board.footprints) { const ps = c.byFp.get(f.id) ?? []; padLocal.set(f.id, ps.map((p) => { const dx = p.center.x - f.x, dy = p.center.y - f.y; const r = (-f.rotation * Math.PI) / 180; return { dx: dx * Math.cos(r) - dy * Math.sin(r), dy: dx * Math.sin(r) + dy * Math.cos(r), net: p.net, number: p.number }; })); }
  const padWorld = (id: string) => { const q = pos.get(id)!; const r = (q.rotation * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r); return padLocal.get(id)!.map((p) => ({ x: q.x + p.dx * cs - p.dy * sn, y: q.y + p.dx * sn + p.dy * cs, net: p.net })); };
  const bodyOf = (id: string) => { const f = fpById.get(id)!; const q = pos.get(id)!; return footprintBody({ ...f, x: q.x, y: q.y, rotation: q.rotation }); };
  const dps = decouplingPairs(c).map((d) => ({ cap: d.cap.id, ic: d.ic.id, pin: d.pin.number }));
  const xps = crystalPairs(c).map((d) => ({ xtal: d.xtal.id, ic: d.ic.id }));
  const sensitive = board.footprints.filter((f) => isCrystal(f) || (c.byFp.get(f.id) ?? []).some((p) => classOf(p.net) === 'analog')).map((f) => f.id);
  const noisy = board.footprints.filter((f) => (c.byFp.get(f.id) ?? []).some((p) => classOf(p.net) === 'switch') && !sensitive.includes(f.id)).map((f) => f.id);
  const ids = board.footprints.map((f) => f.id);
  const padsOf = new Map<string, { x: number; y: number; net: string; w: number; h: number }[]>();
  const padWorldR = (id: string) => { const q = pos.get(id)!; const r = (q.rotation * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r); const f = fpById.get(id)!; const src = c.byFp.get(id) ?? []; return padLocal.get(id)!.map((p, i) => { const rot90 = ((q.rotation - f.rotation) % 180 + 180) % 180 === 90; const pw = src[i]?.rect.w ?? 0.5, ph = src[i]?.rect.h ?? 0.5; return { x: q.x + p.dx * cs - p.dy * sn, y: q.y + p.dx * sn + p.dy * cs, net: p.net, w: rot90 ? ph : pw, h: rot90 ? pw : ph }; }); };
  const refreshPads = (id: string) => padsOf.set(id, padWorldR(id));
  for (const id of ids) refreshPads(id);
  const netsOfFp = new Map<string, string[]>(); for (const id of ids) netsOfFp.set(id, [...new Set((c.byFp.get(id) ?? []).map((p) => p.net).filter(Boolean))]);
  const fpsOfNet = new Map<string, string[]>(); for (const [id, ns] of netsOfFp) for (const n of ns) { if (!fpsOfNet.has(n)) fpsOfNet.set(n, []); fpsOfNet.get(n)!.push(id); }
  const netCost = (net: string) => { const ps: Vec[] = []; for (const id of fpsOfNet.get(net) ?? []) for (const p of padsOf.get(id)!) if (p.net === net) ps.push(p); return hpwl(ps) * (GND_RE.test(net) ? 0.3 : POWER_RE.test(net) ? 0.6 : 1); };
  const bodyCache = new Map<string, Rect>(); const body = (id: string) => { let r = bodyCache.get(id); if (!r) { r = bodyOf(id); bodyCache.set(id, r); } return r; };
  const decByCap = new Map(dps.map((d) => [d.cap, d])), decByIc = new Map<string, typeof dps>(); for (const d of dps) { if (!decByIc.has(d.ic)) decByIc.set(d.ic, []); decByIc.get(d.ic)!.push(d); }
  const xtalOf = new Map(xps.map((x) => [x.xtal, x.ic])), icXtals = new Map<string, string[]>(); for (const x of xps) { if (!icXtals.has(x.ic)) icXtals.set(x.ic, []); icXtals.get(x.ic)!.push(x.xtal); }
  const sensitiveSet = new Set(sensitive), noisySet = new Set(noisy);
  const decCost = (d: { cap: string; ic: string }) => { const capPads = padsOf.get(d.cap)!; const cp = capPads.find((q) => POWER_RE.test(q.net)); const pp = padsOf.get(d.ic)!.find((p) => p.net && cp && p.net === cp.net); if (!pp || !cp) return 0; return Math.max(0, Math.hypot(pp.x - cp.x, pp.y - cp.y) - 2.5) * 6; };
  const singleCost = (id: string) => {
    let e = 0; const r = body(id);
    if (board.outline.length >= 3) { const corners = [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }]; for (const p of corners) if (!pointInPolygon(p, board.outline)) e += 400; }
    if (orig.has(id) && movableIds.includes(id)) { const q = pos.get(id)!, o = orig.get(id)!; const d = Math.hypot(q.x - o.x, q.y - o.y); e += d > maxMove ? (d - maxMove) * 50 + maxMove * 0.15 : d * 0.15; }
    const dc = decByCap.get(id); if (dc) e += decCost(dc);
    for (const d of decByIc.get(id) ?? []) e += decCost(d);
    const ic = xtalOf.get(id); if (ic) { const a2 = pos.get(id)!, b2 = pos.get(ic)!; e += Math.max(0, Math.hypot(a2.x - b2.x, a2.y - b2.y) - 6) * 4; }
    for (const xt of icXtals.get(id) ?? []) { const a2 = pos.get(xt)!, b2 = pos.get(id)!; e += Math.max(0, Math.hypot(a2.x - b2.x, a2.y - b2.y) - 6) * 4; }
    return e;
  };
  const pairCost = (a: string, b: string) => {
    if (fpById.get(a)!.side !== fpById.get(b)!.side) return 0;
    const ra = body(a), rb = body(b);
    const ov = overlapArea(ra, rb); if (ov > 0) return 300 + ov * 200;
    let e = 0;
    const g = rectGap(ra, rb);
    if (g < 2.5) {
      const big = (r: Rect) => r.w * r.h > 20;
      const isDec = decByCap.get(a)?.ic === b || decByCap.get(b)?.ic === a;
      const want = isDec ? 0.5 : big(ra) || big(rb) ? 1.5 : 1.0;
      if (g < want) e += (want - g) * (g < 0.4 ? 60 : 25);
      // 焊盘之间至少留 0.6mm（不同器件），否则无法出线、同网焊盘还会误连
      for (const p of padsOf.get(a)!) for (const q of padsOf.get(b)!) { const gp = Math.max(Math.abs(p.x - q.x) - (p.w + q.w) / 2, Math.abs(p.y - q.y) - (p.h + q.h) / 2); const wantPad = (POWER_RE.test(p.net) || POWER_RE.test(q.net)) && p.net !== q.net ? 1.0 : 0.6; if (gp < wantPad) e += (wantPad - gp) * 80; }
    }
    if ((sensitiveSet.has(a) && noisySet.has(b)) || (sensitiveSet.has(b) && noisySet.has(a))) { if (g < 5) e += (5 - g) * 3; }
    return e;
  };
  const deltaTerms = (moved: string[]) => {
    let e = 0; const ms = new Set(moved);
    for (const m of moved) { e += singleCost(m); for (const o of ids) if (o !== m && (!ms.has(o) || o > m)) e += pairCost(m, o); }
    const nets = new Set<string>(); for (const m of moved) for (const n of netsOfFp.get(m)!) nets.add(n);
    for (const n of nets) e += netCost(n);
    return e;
  };
  const fullCost = () => { let e = 0; for (const id of ids) e += singleCost(id); for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) e += pairCost(ids[i], ids[j]); for (const n of fpsOfNet.keys()) e += netCost(n); return e; };
  const setPos = (id: string, q: { x: number; y: number; rotation: number }) => { pos.set(id, q); bodyCache.delete(id); refreshPads(id); };
  let seed = opts.seed ?? 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const snap = (v: number) => Math.round(v / G) * G;
  let cur = fullCost(), best = cur; const bestPos = new Map([...pos].map(([k, v]) => [k, { ...v }]));
  const deltas: number[] = [];
  for (let k = 0; k < 40; k++) { const f = movable[Math.floor(rnd() * movable.length)]; const old = { ...pos.get(f.id)! }; const b0 = deltaTerms([f.id]); setPos(f.id, { ...old, x: snap(old.x + (rnd() - 0.5) * 4), y: snap(old.y + (rnd() - 0.5) * 4) }); deltas.push(Math.abs(deltaTerms([f.id]) - b0)); setPos(f.id, old); }
  deltas.sort((a2, b2) => a2 - b2);
  const T0 = Math.max(1, deltas[Math.floor(deltas.length * 0.6)] || 1); let T = T0, iter = 0;
  const end = t0 + budget; const maxIter = opts.iterations ?? Infinity;
  while (maxIter === Infinity ? Date.now() < end : iter < maxIter) {
    iter++;
    const f = movable[Math.floor(rnd() * movable.length)];
    const old = { ...pos.get(f.id)! };
    const kind = rnd();
    let moved = [f.id]; const undo: [string, { x: number; y: number; rotation: number }][] = [[f.id, old]];
    let g2: BoardFootprint | null = null;
    if (kind >= 0.85) { g2 = movable[Math.floor(rnd() * movable.length)]; if (g2 === f) continue; moved = [f.id, g2.id]; undo.push([g2.id, { ...pos.get(g2.id)! }]); }
    const before = deltaTerms(moved);
    if (kind < 0.7) { const step = G * (1 + Math.floor(rnd() * (rnd() < 0.7 ? 3 : 10))); const ang = Math.floor(rnd() * 8) * Math.PI / 4; setPos(f.id, { ...old, x: snap(old.x + Math.cos(ang) * step), y: snap(old.y + Math.sin(ang) * step) }); }
    else if (kind < 0.85) { if (opts.keepRotation) continue; setPos(f.id, { ...old, rotation: (old.rotation + 90) % 360 }); }
    else { const o2 = { ...pos.get(g2!.id)! }; setPos(f.id, { ...old, x: o2.x, y: o2.y }); setPos(g2!.id, { ...o2, x: old.x, y: old.y }); }
    const d = deltaTerms(moved) - before;
    if (d <= 0 || rnd() < Math.exp(-d / T)) { cur += d; if (cur < best - 1e-9) { best = cur; for (const [k, v] of pos) bestPos.set(k, { ...v }); } }
    else for (const [k, v] of undo) setPos(k, v);
    T = Math.max(0.05, T0 * (1 - (maxIter === Infinity ? (Date.now() - t0) / budget : iter / maxIter)));
  }
  const moves: PlacementResult['moves'] = [];
  for (const f of movable) { const q = bestPos.get(f.id)!; if (Math.abs(q.x - f.x) > 1e-6 || Math.abs(q.y - f.y) > 1e-6 || q.rotation !== f.rotation) moves.push({ id: f.id, ref: f.ref, x: q.x, y: q.y, rotation: q.rotation !== f.rotation ? q.rotation : undefined, from: { x: f.x, y: f.y, rotation: f.rotation } }); }
  const after = placementMetrics(applyPlacement(board, moves), rules);
  const result: PlacementResult = { moves, before, after, iterations: iter, ms: Date.now() - t0 };
  if (opts.verifyRouting !== false && moves.length) {
    const rb = opts.routeBudgetMs ?? 20000;
    const stat = (r: ReturnType<typeof autoroute>) => ({ routed: r.routed, total: r.total, vias: r.vias.length, length: Math.round(r.traces.reduce((n, t) => { for (let i = 1; i < t.points.length; i++) n += Math.hypot(t.points[i].x - t.points[i - 1].x, t.points[i].y - t.points[i - 1].y); return n; }, 0)) });
    opts.onProgress?.('验证：布线原布局');
    const r0 = stat(autoroute(board, rules, { timeBudgetMs: rb, optimize: false }));
    opts.onProgress?.('验证：布线新布局');
    const worse = (r1: ReturnType<typeof stat>) => r1.routed - (r1.total - r0.total) < r0.routed || (r1.routed === r0.routed && r1.length > r0.length * 1.15 && r1.vias >= r0.vias);
    let r1 = stat(autoroute(applyPlacement(board, moves), rules, { timeBudgetMs: rb, optimize: false }));
    result.routing = { before: r0, after: r1 };
    if (worse(r1) && moves.length > 1) {
      // 回退：只保留位移最小的一半（多为去耦 / 晶振靠近这类小调整），不重叠再验证一次
      const conservative = [...moves].sort((a, b) => Math.hypot(a.x - a.from.x, a.y - a.from.y) - Math.hypot(b.x - b.from.x, b.y - b.from.y)).slice(0, Math.ceil(moves.length / 2));
      const m2 = placementMetrics(applyPlacement(board, conservative), rules);
      if (m2.overlaps === 0 && m2.outside === 0 && m2.hpwl <= before.hpwl) {
        opts.onProgress?.('验证：布线保守方案');
        const r2 = stat(autoroute(applyPlacement(board, conservative), rules, { timeBudgetMs: rb, optimize: false }));
        if (!worse(r2)) { result.moves = conservative; result.after = m2; result.fallback = true; r1 = r2; result.routing = { before: r0, after: r2 }; }
      }
    }
    if (worse(r1)) { result.rejected = `新布局自动布线 ${r1.routed}/${r1.total}，不优于原布局 ${r0.routed}/${r0.total}，已放弃建议`; result.moves = []; result.after = before; }
    result.ms = Date.now() - t0;
  }
  return result;
}
export function applyPlacement(board: Board, moves: PlacementResult['moves']): Board {
  return { ...board, footprints: board.footprints.map((f) => { const m = moves.find((x) => x.id === f.id); return m ? { ...f, x: m.x, y: m.y, rotation: m.rotation ?? f.rotation } : f; }) };
}
