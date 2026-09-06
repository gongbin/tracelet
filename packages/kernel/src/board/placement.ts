import { withUsbEdgeConstraints } from './usbPlacement.js';
/**
 * 布局检查与优化：在自动布线之前，按"连接关系、远近、信号干扰、空间均衡、最小间距、对齐"给出问题清单，
 * 并用模拟退火给出可预览的移动建议（不改动锁定件、连接器、安装孔与已有走线的器件）。
 * 目标函数：飞线半周长（HPWL）+ 去耦电容贴近芯片电源脚 + 晶振贴近主控 + 敏感网络远离开关网络
 *          + 本体不重叠 / 不出板 / 最小间距 + 对齐到 0.5mm 栅格。
 */
import type { Board, BoardFootprint } from '../model/board.js';
import type { RuleSet } from '../model/project.js';
import { allPads, footprintPads, footprintBody, boardBounds, type WorldPad } from './geometry.js';
import { pointInPolygon, segRectDist, type Rect, type Vec } from '../geometry.js';
import { bodyInsideOutline, edgePlacementFits, placementConstraintErrors, placementCopperClear } from './placementConstraints.js';
import { antennaGeometry, placementBodyInside, antennaAreasClear } from './antennaPlacement.js';
import { autoroute } from './autoroute.js';

export interface PlacementIssue { rule: 'overlap' | 'outside' | 'spacing' | 'decoupling' | 'crystal' | 'connector-edge' | 'connector-facing' | 'noise' | 'long-net' | 'alignment' | 'affinity' | 'grouping' | 'antenna'; severity: 'error' | 'warning' | 'info'; message: string; refs: string[]; location?: Vec; suggestion?: string }
export interface PlacementMetrics { hpwl: number; overlaps: number; outside: number; decouplingAvg: number; issues: number }
export interface PlacementResult { outline?: Vec[]; moves: { id: string; ref: string; x: number; y: number; rotation?: number; from: { x: number; y: number; rotation: number } }[]; before: PlacementMetrics; after: PlacementMetrics; iterations: number; ms: number; /** 用自动布线验证前后（verifyRouting） */ routing?: { before: { routed: number; total: number; vias: number; length: number }; after: { routed: number; total: number; vias: number; length: number } }; /** 布线验证变差，建议已丢弃 */ rejected?: string; /** 完整建议布线变差时回退为保守子集 */ fallback?: boolean; /** 第 0 步从板外 / 重叠状态摆进板内的器件数 */ legalized?: number }
export interface PlacementOptions { mode?: 'initial' | 'incremental'; /** Explicit opt-in: use an estimated rectangular outline. */ estimateOutline?: boolean; timeBudgetMs?: number; /** 固定迭代次数（给定 seed 时结果可复现；默认按时间预算） */ iterations?: number; seed?: number; moveConnectors?: boolean; grid?: number; keepRotation?: boolean; /** 单个器件最大位移（mm，默认 8） */ maxMove?: number; /** 用自动布线对比前后，变差则丢弃建议（默认开） */ verifyRouting?: boolean; routeBudgetMs?: number; onProgress?: (stage: string) => void }

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
const isIc = (f: BoardFootprint, byFp: Map<string, WorldPad[]>) => (f.placement?.role === 'ic' || ((byFp.get(f.id)?.length ?? 0) >= 4 && /^(U|IC|Q)\d/i.test(f.ref)));
const isCap = (f: BoardFootprint, byFp: Map<string, WorldPad[]>) => /^C\d/i.test(f.ref) && (byFp.get(f.id)?.length ?? 0) === 2;
const isCrystal = (f: BoardFootprint) => /^(Y|X)\d/i.test(f.ref) || /(mhz|khz|crystal|xtal|resonator)/i.test(f.value);

/** 去耦对：电容（电源 + 地）→ 同电源网络上最近的 IC 引脚。 */
function decouplingPairs(c: Ctx): { cap: BoardFootprint; pin: WorldPad; ic: BoardFootprint }[] {
  const out: { cap: BoardFootprint; pin: WorldPad; ic: BoardFootprint }[] = [];
  for (const f of c.board.footprints) {
    if (f.placement?.role && !['auto', 'decoupling'].includes(f.placement.role)) continue;
    if (!isCap(f, c.byFp)) continue;
    const ps = c.byFp.get(f.id)!; const power = ps.find((p) => POWER_RE.test(p.net)), gnd = ps.find((p) => GND_RE.test(p.net));
    if (!power || !gnd) continue;
    if (f.placement?.target) {
      const t = f.placement.target, ic = c.board.footprints.find(x => x.id === t.footprintId);
      const pin = c.byFp.get(t.footprintId)?.find(p => p.number === t.pad && p.net === power.net);
      if (ic && pin) out.push({ cap: f, pin, ic });
      continue;
    }
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
const PASSIVE_RE = /^(R|C|L|D|FB|Z|ZD|LED)\d/i;
const isPassive = (f: BoardFootprint, byFp: Map<string, WorldPad[]>) => PASSIVE_RE.test(f.ref) && (byFp.get(f.id)?.length ?? 0) <= 3;
const typeOf = (f: BoardFootprint) => (/^C\d/i.test(f.ref) ? 'C' : /^R\d/i.test(f.ref) ? 'R' : /^L\d/i.test(f.ref) ? 'L' : /^(D|LED)\d/i.test(f.ref) ? 'D' : '');
const isPlugConnector = (f: BoardFootprint) => f.placement?.role === 'connector' || /^(J|P|CN|USB|X)\d/i.test(f.ref);
const ANTENNA_RE = /(ant|antenna|wroom|wrover|esp32|esp8266|esp-|wifi|ble|nrf|rf|lora|zigbee|gnss|gps|module)/i;

/**
 * 亲源性：与 IC 共享网络的无源件（电容 / 电感 / 二极管 / 电阻）应贴近该 IC 上对应的引脚。
 * 权重：与同一 IC 共享 2 个网络的电容（输入 / 输出电容、去耦）最强；电感 / 二极管（开关节点）次之；电阻最弱。
 */
function affinityPairs(c: Ctx): { part: BoardFootprint; ic: BoardFootprint; nets: string[]; weight: number }[] {
  const out: { part: BoardFootprint; ic: BoardFootprint; nets: string[]; weight: number }[] = [];
  const ics = c.board.footprints.filter((f) => isIc(f, c.byFp));
  for (const f of c.board.footprints) {
    if (!isPassive(f, c.byFp)) continue;
    const mine = new Set((c.byFp.get(f.id) ?? []).map((p) => p.net).filter(Boolean));
    let best: { ic: BoardFootprint; nets: string[]; score: number } | null = null;
    for (const ic of ics) {
      const icNets = new Set((c.byFp.get(ic.id) ?? []).map((p) => p.net));
      const shared = [...mine].filter((n) => icNets.has(n));
      if (!shared.length) continue;
      const signal = shared.filter((n) => !GND_RE.test(n)).length;
      if (!signal) continue; // 只共地不算
      const meaningful = shared.filter(n=>!POWER_RE.test(n)&&!GND_RE.test(n));
      if (!meaningful.length) continue; // Global supplies do not identify a functional owner.
      const score = meaningful.length * 5 + signal;
      if (!best || score > best.score || (score === best.score && Math.hypot(f.x-ic.x,f.y-ic.y)<Math.hypot(f.x-best.ic.x,f.y-best.ic.y))) best = { ic, nets: shared, score };
    }
    if (!best) continue;
    const t = typeOf(f);
    const weight = t === 'C' ? (best.nets.length >= 2 ? 8 : 3) : t === 'L' || t === 'D' ? 5 : 2;
    out.push({ part: f, ic: best.ic, nets: best.nets, weight });
  }
  return out;
}
/** 天线区：模块本体上没有焊盘、且伸出焊盘包围盒 ≥3mm 的那一端（世界坐标矩形）；不是射频模块返回 null。 */
function antennaZone(f: BoardFootprint, byFp: Map<string, WorldPad[]>, name: string): Rect | null {
  if (!ANTENNA_RE.test(name) && !/^ANT\d/i.test(f.ref)) return null;
  const ps = byFp.get(f.id) ?? []; const r = footprintBody(f);
  if (/^ANT\d/i.test(f.ref)) return r;
  if (!ps.length) return null;
  const x1 = Math.min(...ps.map((p) => p.rect.x)), x2 = Math.max(...ps.map((p) => p.rect.x + p.rect.w)), y1 = Math.min(...ps.map((p) => p.rect.y)), y2 = Math.max(...ps.map((p) => p.rect.y + p.rect.h));
  const cand: [number, Rect][] = [[y1 - r.y, { x: r.x, y: r.y, w: r.w, h: y1 - r.y }], [r.y + r.h - y2, { x: r.x, y: y2, w: r.w, h: r.y + r.h - y2 }], [x1 - r.x, { x: r.x, y: r.y, w: x1 - r.x, h: r.h }], [r.x + r.w - x2, { x: x2, y: r.y, w: r.x + r.w - x2, h: r.h }]];
  cand.sort((a, b) => b[0] - a[0]);
  return cand[0][0] >= 3 ? cand[0][1] : null;
}
/** 连接器朝向：接口应朝向最近的板边（焊盘重心 → 本体中心 的方向大致指向板边）。返回 [0,1]：1 完全朝外，0 背对。 */
function connectorFacing(f: BoardFootprint, byFp: Map<string, WorldPad[]>, outline: Vec[]): number | null {
  const ps = byFp.get(f.id) ?? []; if (ps.length < 2 || outline.length < 3) return null;
  const r = footprintBody(f); const bc = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  const pc = { x: ps.reduce((n, p) => n + p.center.x, 0) / ps.length, y: ps.reduce((n, p) => n + p.center.y, 0) / ps.length };
  const dir = { x: bc.x - pc.x, y: bc.y - pc.y }; const dl = Math.hypot(dir.x, dir.y);
  if (dl < 0.3) return null; // 焊盘居中（如直插排针）看不出朝向
  // 最近板边的外法线
  let best: { d: number; n: Vec } | null = null;
  for (let i = 0; i < outline.length; i++) { const a = outline[i], b = outline[(i + 1) % outline.length]; const L = Math.hypot(b.x - a.x, b.y - a.y) || 1; const t = Math.max(0, Math.min(1, ((bc.x - a.x) * (b.x - a.x) + (bc.y - a.y) * (b.y - a.y)) / (L * L))); const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; const d = Math.hypot(bc.x - q.x, bc.y - q.y); if (!best || d < best.d) best = { d, n: { x: (q.x - bc.x) / (d || 1), y: (q.y - bc.y) / (d || 1) } }; }
  if (!best) return null;
  return (dir.x / dl) * best.n.x + (dir.y / dl) * best.n.y * 1 > 0 ? Math.max(0, (dir.x / dl) * best.n.x + (dir.y / dl) * best.n.y) : 0;
}
const classOf = (net: string) => (CLOCK_RE.test(net) ? 'clock' : ANALOG_RE.test(net) ? 'analog' : SWITCH_RE.test(net) ? 'switch' : POWER_RE.test(net) || GND_RE.test(net) ? 'power' : 'signal');

/** 布局问题清单（不改动板子）。 */
export function checkPlacement(board: Board, rules: RuleSet): PlacementIssue[] {
  const c = ctxOf(board); const out: PlacementIssue[] = [];
  const bodies = board.footprints.map((f) => ({ f, r: footprintBody(f) }));
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    const corners = [{ x: a.r.x, y: a.r.y }, { x: a.r.x + a.r.w, y: a.r.y }, { x: a.r.x + a.r.w, y: a.r.y + a.r.h }, { x: a.r.x, y: a.r.y + a.r.h }];
    if (board.outline.length >= 3 && !placementBodyInside(a.f,board)) out.push({ rule: 'outside', severity: 'error', message: `${a.f.ref} 超出板框`, refs: [a.f.ref], location: { x: a.f.x, y: a.f.y }, suggestion: '拖进板内或用「板框适配内容」' });
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
  // 亲源性：无源件离所连 IC 引脚太远（升压 / 降压的输入输出电容、电感尤其重要）
  for (const { part, ic, nets, weight } of affinityPairs(c)) {
    const mine = c.byFp.get(part.id) ?? [], his = c.byFp.get(ic.id) ?? [];
    let d = Infinity; for (const n of nets) for (const a of mine) if (a.net === n) for (const b of his) if (b.net === n) d = Math.min(d, Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y));
    const limit = weight >= 8 ? 5 : weight >= 5 ? 8 : 12;
    if (d > limit) out.push({ rule: 'affinity', severity: weight >= 5 ? 'warning' : 'info', message: `${part.ref} 离 ${ic.ref} 的 ${nets.filter((n) => !GND_RE.test(n)).slice(0, 2).join('/')} 引脚 ${d.toFixed(1)}mm`, refs: [part.ref, ic.ref], location: { x: part.x, y: part.y }, suggestion: weight >= 8 ? '输入 / 输出电容紧贴转换器的 VIN / VOUT 与 GND 引脚，回路面积越小越好' : weight >= 5 ? '电感 / 二极管紧贴开关引脚（SW / LX），开关节点走线要短而粗' : '与 IC 直连的电阻尽量靠近对应引脚' });
  }
  // 连接器朝向：接口应朝板外，不要对着大器件
  for (const f of board.footprints) {
    if (!isPlugConnector(f)) continue;
    const facing = connectorFacing(f, c.byFp, board.outline);
    if (facing !== null && facing < 0.3) out.push({ rule: 'connector-facing', severity: 'warning', message: `连接器 ${f.ref} 的接口没有朝向板边`, refs: [f.ref], location: { x: f.x, y: f.y }, suggestion: '旋转连接器让插拔方向朝板外，接口前方不要有高大器件' });
  }
  // 天线：天线区上下 / 周围留空，最好伸到板边
  for (const f of board.footprints) {
    const az = antennaZone(f, c.byFp, ((f as unknown as { footprintId: string }).footprintId ?? '') + ' ' + f.value);
    if (!az) continue;
    const keep = { x: az.x - 5, y: az.y - 5, w: az.w + 10, h: az.h + 10 };
    const intruders = board.footprints.filter((o) => o.id !== f.id && overlapArea(footprintBody(o), keep) > 0).map((o) => o.ref);
    if (intruders.length) out.push({ rule: 'antenna', severity: 'warning', message: `${f.ref} 天线区 5mm 内有 ${intruders.slice(0, 4).join('、')}`, refs: [f.ref, ...intruders.slice(0, 4)], location: { x: az.x + az.w / 2, y: az.y + az.h / 2 }, suggestion: '天线区四周至少留 5mm 净空，下方各层不铺铜不走线' });
    if (board.outline.length >= 3) { let d = Infinity; for (let k = 0; k < board.outline.length; k++) d = Math.min(d, segRectGap(board.outline[k], board.outline[(k + 1) % board.outline.length], az)); if (d > 2) out.push({ rule: 'antenna', severity: 'info', message: `${f.ref} 天线区离板边 ${d.toFixed(1)}mm`, refs: [f.ref], location: { x: az.x + az.w / 2, y: az.y + az.h / 2 }, suggestion: '把模块天线一端放到板边，天线伸出板外或与板边齐平最好' }); }
  }
  // 成组：相邻的同类小件朝向不一致
  const passives = bodies.filter((b) => isPassive(b.f, c.byFp) && b.r.w * b.r.h < 12);
  const seenG = new Set<string>();
  for (const a of passives) for (const b of passives) { if (a === b || typeOf(a.f) !== typeOf(b.f)) continue; const key = [a.f.ref, b.f.ref].sort().join('|'); if (seenG.has(key)) continue; const g = rectGap(a.r, b.r); if (g < 3 && (a.f.rotation - b.f.rotation) % 180 !== 0) { seenG.add(key); out.push({ rule: 'grouping', severity: 'info', message: `${a.f.ref} 与 ${b.f.ref} 相邻但朝向不同`, refs: [a.f.ref, b.f.ref], location: { x: a.f.x, y: a.f.y }, suggestion: '同类器件成排、同向摆放，便于贴片和检查' }); } }
  // 对齐：同一排里差一点点没对齐的小件
  const small = bodies.filter((b) => b.r.w * b.r.h < 12);
  const seen = new Set<string>();
  for (const a of small) for (const b of small) { if (a === b) continue; const key = [a.f.ref, b.f.ref].sort().join('|'); if (seen.has(key)) continue; const dx = Math.abs(a.f.x - b.f.x), dy = Math.abs(a.f.y - b.f.y); if ((dx > 0.05 && dx < 0.6 && dy > 2 && dy < 12) || (dy > 0.05 && dy < 0.6 && dx > 2 && dx < 12)) { seen.add(key); out.push({ rule: 'alignment', severity: 'info', message: `${a.f.ref} 与 ${b.f.ref} 差 ${Math.min(dx > 0.05 && dx < 0.6 ? dx : 9, dy > 0.05 && dy < 0.6 ? dy : 9).toFixed(2)}mm 没对齐`, refs: [a.f.ref, b.f.ref], suggestion: '框选后用对齐工具' }); } }
  return out;
}
const segRectGap = segRectDist;

export function placementMetrics(board: Board, rules: RuleSet): PlacementMetrics {
  const c = ctxOf(board); let hp = 0; for (const [, ps] of c.nets) hp += hpwl(ps.map((p) => p.center));
  const issues = checkPlacement(board, rules);
  const dp = decouplingPairs(c); const dAvg = dp.length ? dp.reduce((n, { cap, pin }) => { const power = c.byFp.get(cap.id)!.find((p) => p.net === pin.net)!; return n + Math.hypot(power.center.x - pin.center.x, power.center.y - pin.center.y); }, 0) / dp.length : 0;
  return { hpwl: Math.round(hp), overlaps: issues.filter((i) => i.rule === 'overlap').length, outside: issues.filter((i) => i.rule === 'outside').length, decouplingAvg: Math.round(dAvg * 10) / 10, issues: issues.length };
}

/**
 * 构造式合法化：把可动器件按连接关系依次摆进板内。
 * 顺序：引脚最多的 IC 先放（板中央或原位置），其余按与已放器件的连接强度 BFS；每个器件放到"所连引脚重心"附近
 * 最近的空位（螺旋搜索，本体之间留通道、离板边留余量），并在 0/90/180/270° 里选飞线最短的朝向。
 * 返回被移动器件的新位置（原位置已合法且不重叠的器件保持不动）。
 */
function legalize(board: Board, c: Ctx, movable: BoardFootprint[], rules: RuleSet, G: number, keepRotation: boolean, initial = false): Map<string, { x: number; y: number; rotation: number }> {
  const out = new Map<string, { x: number; y: number; rotation: number }>();
  const margin = (rules.copperToEdge ?? 0.3) + 0.3;
  const bb = boardBounds(board);
  const insideBody = (r: Rect) => bodyInsideOutline({x:r.x-margin,y:r.y-margin,w:r.w+2*margin,h:r.h+2*margin},board.outline);
  const fpById = new Map(board.footprints.map((f) => [f.id, f]));
  const at = (f: BoardFootprint, q: { x: number; y: number; rotation: number }): BoardFootprint => ({ ...f, x: q.x, y: q.y, rotation: q.rotation });
  const padsAt = (f: BoardFootprint, q: { x: number; y: number; rotation: number }) => allPads({ ...board, footprints: [at(f, q)] }).filter((p) => !p.def.npth);
  const bodyAt = (f: BoardFootprint, q: { x: number; y: number; rotation: number }) => footprintBody(at(f, q));
  // 已放置（固定或已合法）的器件
  const placed = new Map<string, { x: number; y: number; rotation: number }>();
  const movableSet = new Set(movable.map((f) => f.id));
  const legalNow = (f: BoardFootprint) => insideBody(footprintBody(f)) && !board.footprints.some((o) => o !== f && o.side === f.side && overlapArea(footprintBody(o), footprintBody(f)) > 0);
  for (const f of board.footprints) if (!movableSet.has(f.id)) placed.set(f.id, { x: f.x, y: f.y, rotation: f.rotation });
  // 原位置已合法且与固定件不冲突的可动器件也先保留原位（避免无谓大搬家）
  const pending = new Set<string>();
  for (const f of movable) { if ((!initial || (isPlugConnector(f) && Math.min(...board.outline.map((a,i)=>segRectGap(a,board.outline[(i+1)%board.outline.length],footprintBody(f))))<=4)) && legalNow(f) && edgePlacementFits(f, board)) placed.set(f.id, { x: f.x, y: f.y, rotation: f.rotation }); else pending.add(f.id); }
  const padCount = (id: string) => (c.byFp.get(id) ?? []).length;
  const netW = (n: string) => (GND_RE.test(n) ? 0.2 : POWER_RE.test(n) ? 0.5 : 1);
  const netsOf = (id: string) => [...new Set((c.byFp.get(id) ?? []).map((p) => p.net).filter(Boolean))];
  const conn = (a: string, b: string) => { const nb = new Set(netsOf(b)); let w = 0; for (const n of netsOf(a)) if (nb.has(n)) w += netW(n); return w; };
  const dps = decouplingPairs(c); const decTarget = new Map(dps.map(d => [d.cap.id, {footprintId:d.ic.id, pad:d.pin.number}])); const decIc = new Map(dps.map((d) => [d.cap.id, d.ic.id]));
  const gapWant = (a: string, b: string) => { const ra = bodyAt(fpById.get(a)!, placed.get(a)!), rb = bodyAt(fpById.get(b)!, placed.get(b)!); void ra; void rb; return decIc.get(a) === b || decIc.get(b) === a ? 0.5 : 1.0; };
  const bigGap = (r: Rect) => (r.w * r.h > 20 ? 1.5 : 1.0);
  const antennaAreas = board.footprints.flatMap(f=>{const a=antennaGeometry(f,board);return a?[a.area]:[];});
  const fits = (f: BoardFootprint, q: { x: number; y: number; rotation: number }) => {
    const r = bodyAt(f, q); if (!insideBody(r) || !edgePlacementFits({ ...f, ...q }, board)) return false;
    if(antennaAreas.some(a=>overlapArea(r,a)>1e-6))return false;
    for (const [id, pq] of placed) { const o = fpById.get(id)!; if (o.side !== f.side) continue; const ro = bodyAt(o, pq); const want = Math.max(decIc.get(f.id) === id || decIc.get(id) === f.id ? 0.5 : Math.min(bigGap(r), bigGap(ro)), 0.5); if (rectGap(r, ro) < want) return false; }
    return placementCopperClear({ ...board, footprints: [{ ...f, ...q }, ...[...placed].filter(([id]) => id !== f.id).map(([id, pq]) => ({ ...fpById.get(id)!, ...pq }))] }, rules);
  };
  // 放置顺序：先没放的 IC（引脚最多），再按与已放器件连接强度递减
  const order: string[] = [];
  while (pending.size) {
    let best: string | null = null, bestScore = -Infinity;
    for (const id of pending) { let sc = 0; for (const pid of placed.keys()) sc += conn(id, pid); sc += [...placed.keys()].filter(pid => fpById.get(pid)!.placement?.group && fpById.get(pid)!.placement?.group === fpById.get(id)!.placement?.group).length * 2; sc = (fpById.get(id)!.placement?.edge ? 10000 : initial && isPlugConnector(fpById.get(id)!) ? 1000 : 0) + sc * 10 + padCount(id) * 0.1 + (/^(U|IC)\d/i.test(fpById.get(id)!.ref) ? 5 : 0) - (/^(TP|FID)\d/i.test(fpById.get(id)!.ref) ? 3 : 0); const targetId = fpById.get(id)!.placement?.target?.footprintId ?? decIc.get(id); if (targetId && !placed.has(targetId)) sc -= 100000; else if (targetId) sc += 500; if (sc > bestScore) { bestScore = sc; best = id; } }
    const id = best!; pending.delete(id); order.push(id);
    const f = fpById.get(id)!;
    // 理想点：所连已放引脚的加权重心；没有就板中心（第一个器件）或已放器件的空白侧
    let sx = 0, sy = 0, wsum = 0;
    for (const n of netsOf(id)) { if (GND_RE.test(n)) continue; for (const p of c.nets.get(n) ?? []) if (placed.has(p.footprintId) && p.footprintId !== id) { const pq = placed.get(p.footprintId)!; const o = fpById.get(p.footprintId)!; const pp = padsAt(o, pq).find((x) => x.number === p.number); if (pp) { const w = netW(n); sx += pp.center.x * w; sy += pp.center.y * w; wsum += w; } } }
    let ideal = wsum ? { x: sx / wsum, y: sy / wsum } : { x: bb.x + bb.w / 2, y: bb.y + bb.h / 2 };
    // A valid imported IC location is a useful functional seed. Staged ICs still use connectivity.
    if(initial && isIc(f,c.byFp) && insideBody(footprintBody(f))) ideal={x:f.x,y:f.y};
    const target = f.placement?.target ?? decTarget.get(f.id);
    if (target && placed.has(target.footprintId)) {
      const pin = padsAt(fpById.get(target.footprintId)!, placed.get(target.footprintId)!).find(p => p.number === target.pad);
      if (pin) ideal = pin.center;
    }
    const inferredEdge = initial && !f.placement?.edge && (isPlugConnector(f) || !!antennaZone(f,c.byFp,`${f.footprintId} ${f.value}`));
    if (inferredEdge) {
      // Project the electrical centroid onto the nearest actual outline segment.
      // Retain useful mechanical side intent when the imported part is already inside the board.
      // For staged parts use connectivity instead of their arbitrary staging coordinates.
      const r0=footprintBody(f);
      if(insideBody(r0)) ideal={x:f.x,y:f.y};
      let closest = Infinity, point = ideal;
      for (let i=0;i<board.outline.length;i++) {
        const a=board.outline[i], b=board.outline[(i+1)%board.outline.length];
        const dx=b.x-a.x,dy=b.y-a.y, t=Math.max(0,Math.min(1,((ideal.x-a.x)*dx+(ideal.y-a.y)*dy)/(dx*dx+dy*dy || 1)));
        const q={x:a.x+t*dx,y:a.y+t*dy}, d=Math.hypot(q.x-ideal.x,q.y-ideal.y);
        if(d<closest){closest=d;point=q;}
      }
      ideal=point;
    }
    if (f.placement?.edge) {
      const i = f.placement.edge.index, a = board.outline[i], b = board.outline[(i+1)%board.outline.length];
      if (a && b) ideal = { x:(a.x+b.x)/2, y:(a.y+b.y)/2 };
    }
    const rots = keepRotation ? [f.rotation] : [f.rotation, (f.rotation + 90) % 360, (f.rotation + 180) % 360, (f.rotation + 270) % 360];
    // 螺旋搜索：按离理想点由近到远，收集前若干个可行位置，按飞线长度 + 偏离距离选最好的
    const snap = (v: number) => Math.round(v / G) * G;
    const cands: { q: { x: number; y: number; rotation: number }; cost: number }[] = [];
    const maxR = Math.hypot(bb.w, bb.h);
    const netPads = new Map<string, Vec[]>();
    for (const n of netsOf(id)) { if (GND_RE.test(n)) continue; const ps: Vec[] = []; for (const p of c.nets.get(n) ?? []) if (placed.has(p.footprintId) && p.footprintId !== id) { const pq = placed.get(p.footprintId)!; const pp = padsAt(fpById.get(p.footprintId)!, pq).find((x) => x.number === p.number); if (pp) ps.push(pp.center); } if (ps.length) netPads.set(n, ps); }
    const costAt = (q: { x: number; y: number; rotation: number }) => { let e = Math.hypot(q.x - ideal.x, q.y - ideal.y) * 0.3; const mine = padsAt(f, q);
      if(inferredEdge){
        const candidate={...f,...q}, body=footprintBody(candidate);
        const edgeGap=Math.min(...board.outline.map((a,i)=>segRectGap(a,board.outline[(i+1)%board.outline.length],body)));
        e+=edgeGap*25;
        const facing=connectorFacing(candidate,new Map([[f.id,mine]]),board.outline);
        if(facing!==null)e+=(1-facing)*40;
      }
      if (target && placed.has(target.footprintId)) { const pin = padsAt(fpById.get(target.footprintId)!, placed.get(target.footprintId)!).find(p => p.number === target.pad); if (pin) { const related = mine.filter(p => p.net && p.net === pin.net); if (related.length) e += Math.min(...related.map(p => Math.hypot(p.center.x-pin.center.x, p.center.y-pin.center.y))) * 30; } } for (const [n, ps] of netPads) { const own = mine.filter((p) => p.net === n).map((p) => p.center); e += hpwl([...ps, ...own]) * netW(n); } return e; };
    outer: for (let ring = 0; ring * G <= maxR; ring++) {
      const step = ring === 0 ? [0] : [-ring, ring];
      const pts: Vec[] = [];
      if (ring === 0) pts.push({ x: 0, y: 0 });
      else { for (let i = -ring; i <= ring; i++) { for (const sgn of step) { pts.push({ x: i * G, y: sgn * G }); if (i !== -ring && i !== ring) pts.push({ x: sgn * G, y: i * G }); } } }
      for (const d of pts) for (const rot of rots) {
        const q = { x: snap(ideal.x + d.x), y: snap(ideal.y + d.y), rotation: rot };
        if (q.x < bb.x - 1 || q.x > bb.x + bb.w + 1 || q.y < bb.y - 1 || q.y > bb.y + bb.h + 1) continue;
        if (fits(f, q)) cands.push({ q, cost: costAt(q) });
      }
      if (cands.length >= 24 || (cands.length && ring * G > 6)) break outer;
    }
    if (!cands.length) { // 实在放不下：退而求其次，放到板内不出界的位置（可能与别的重叠，交给退火处理）
      const q = { x: snap(Math.max(bb.x + margin + 2, Math.min(bb.x + bb.w - margin - 2, ideal.x))), y: snap(Math.max(bb.y + margin + 2, Math.min(bb.y + bb.h - margin - 2, ideal.y))), rotation: f.rotation };
      placed.set(id, q); out.set(id, q); continue;
    }
    cands.sort((a, b) => a.cost - b.cost);
    placed.set(id, cands[0].q); out.set(id, cands[0].q);
  }
  return out;
}

/** Capacity estimate only: inflated bodies plus routing space; mechanical requirements take precedence. */
export function estimateBoardSize(board: Board, rules: RuleSet) {
  const margin = Math.max(2, rules.copperToEdge + 1);
  const bodies = board.footprints.map(footprintBody);
  const area = bodies.reduce((n,r)=>n+(r.w+1.5)*(r.h+1.5),0) / 0.55;
  const bb = boardBounds(board), ratio = Math.max(0.75,Math.min(1.5,bb.w/Math.max(bb.h,1)));
  const width = Math.ceil(Math.max(Math.sqrt(area*ratio),...bodies.map(r=>r.w+2*margin),10)/5)*5;
  const height = Math.ceil(Math.max(area/width,...bodies.map(r=>r.h+2*margin),10)/5)*5;
  // Resizing is unsafe with existing routing, copper zones, explicit edge intent or mechanical anchors.
  const rectangular = board.outline.length === 4 && board.outline.every((p,i)=>{const q=board.outline[(i+1)%4];return p.x===q.x || p.y===q.y;});
  const canResize = !board.footprints.some(f=>antennaGeometry(f,board)) && rectangular && !board.traces.length && !board.vias.length && !board.zones.length && !board.footprints.some(f=>f.locked || f.placement?.fixed || f.placement?.edge || f.placement?.role==='mechanical' || /^(H|MH|FID)\d/i.test(f.ref));
  return {width,height,canResize,outline:[{x:bb.x,y:bb.y},{x:bb.x+width,y:bb.y},{x:bb.x+width,y:bb.y+height},{x:bb.x,y:bb.y+height}]};
}

/** 模拟退火布局优化：返回移动建议（不修改输入）。 */
export function optimizePlacement(board: Board, rules: RuleSet, opts: PlacementOptions = {}): PlacementResult {
  board = withUsbEdgeConstraints(board);
  if (opts.mode === 'initial' && opts.estimateOutline) {
    const size = estimateBoardSize(board,rules);
    if (size.canResize) {
      const result = optimizePlacement({...board,outline:size.outline,outlineRadius:undefined},rules,{...opts,estimateOutline:false});
      result.before = placementMetrics(board,rules);
      if (!result.rejected) result.outline = size.outline;
      return result;
    }
  }
  const t0 = Date.now(); const budget = opts.timeBudgetMs ?? 1500; const G = opts.grid ?? 0.5;
  const c = ctxOf(board);
  const initial = opts.mode === 'initial';
  const wired = new Set<string>();
  for (const p of c.pads) if (board.traces.some((t) => p.layers.includes(t.layer) && t.points.slice(1).some((b, i) => segRectGap(t.points[i], b, p.rect) <= t.width / 2 + 1e-6))) wired.add(p.footprintId);
  const inside0 = (f: BoardFootprint) => { if (board.outline.length < 3) return true; const r = footprintBody(f); return [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }].every((q) => pointInPolygon(q, board.outline)); };
  const FIXED_RE = /^(J|P|CN|USB|X|BT|H|MH|FID|SW)\d/i; // 连接器 / 安装孔 / 按键默认不动；测试点可动
  const movable = board.footprints.filter((f) => !antennaGeometry(f,board) && !f.locked && !f.placement?.fixed && f.placement?.role !== 'mechanical' && !wired.has(f.id) && (f.placement?.edge || opts.moveConnectors || (initial && isPlugConnector(f) && !/^(H|MH|FID|SW)\d/i.test(f.ref)) || (!FIXED_RE.test(f.ref) && f.placement?.role !== 'connector') || !inside0(f)) && !(c.byFp.get(f.id) ?? []).every((p) => p.def.npth));
  const before = placementMetrics(board, rules);
  if (movable.length === 0) return { moves: [], before, after: before, iterations: 0, ms: Date.now() - t0, ...(before.overlaps || before.outside || placementConstraintErrors(board).length ? { rejected: 'No movable components: resolve overlaps or outside components by adjusting fixed parts.' } : {}) };
  // ---- 第 0 步：合法化。有器件在板外 / 重叠时，先按连接关系从核心器件开始"构造式"摆进板内（不重叠、留通道），再退火细调 ----
  const relocated = new Set<string>();
  const start = new Map(board.footprints.map((f) => [f.id, { x: f.x, y: f.y, rotation: f.rotation }]));
  const needsLegalize = initial || before.outside > 0 || before.overlaps > 0 || placementConstraintErrors(board).length > 0;
  if (needsLegalize && board.outline.length >= 3) {
    opts.onProgress?.('整理：把板外 / 重叠的器件摆进板内');
    const res = legalize(board, c, movable, rules, G, !!opts.keepRotation, initial);
    for (const [id, q] of res) { start.set(id, q); relocated.add(id); }
  }
  // 工作副本
  const pos = new Map<string, { x: number; y: number; rotation: number }>(); for (const f of board.footprints) pos.set(f.id, { ...start.get(f.id)! });
  const orig = new Map(board.footprints.map((f) => [f.id, { x: f.x, y: f.y }]));
  const movableIds = movable.map((f) => f.id);
  const maxMove = opts.maxMove ?? 8;
  const edgeMargin = (rules.copperToEdge ?? 0.3) + 0.3;
  const fpById = new Map(board.footprints.map((f) => [f.id, f]));
  const bodyOf = (id: string) => { const f = fpById.get(id)!; const q = pos.get(id)!; return footprintBody({ ...f, x: q.x, y: q.y, rotation: q.rotation }); };
  const dps = decouplingPairs(c).map((d) => ({ cap: d.cap.id, ic: d.ic.id, pin: d.pin.number }));
  const affs = affinityPairs(c).filter(a => !dps.some(d=>d.cap===a.part.id)).map((a) => ({ part: a.part.id, ic: a.ic.id, nets: a.nets, weight: a.weight }));
  const affByPart = new Map(affs.map((a) => [a.part, a])), affByIc = new Map<string, typeof affs>(); for (const a of affs) { if (!affByIc.has(a.ic)) affByIc.set(a.ic, []); affByIc.get(a.ic)!.push(a); }
  const fpName = (id: string) => { const f = fpById.get(id)!; return `${f.footprintId} ${f.value}`; };
  const antennaIds = board.footprints.filter((f) => antennaZone(f, c.byFp, fpName(f.id))).map((f) => f.id);
  const antennaSet = new Set(antennaIds);
  const antennaRect = (id: string) => { const f = fpById.get(id)!; const q = pos.get(id)!; return antennaZone({ ...f, x: q.x, y: q.y, rotation: q.rotation }, currentPads, fpName(id)); };
  const typeCache = new Map(board.footprints.map((f) => [f.id, typeOf(f)]));
  const smallPassive = new Set(board.footprints.filter((f) => isPassive(f, c.byFp) && footprintBody(f).w * footprintBody(f).h < 12).map((f) => f.id));
  const plugs = new Set(board.footprints.filter(isPlugConnector).map((f) => f.id));
  const xps = crystalPairs(c).map((d) => ({ xtal: d.xtal.id, ic: d.ic.id }));
  const sensitive = board.footprints.filter((f) => isCrystal(f) || (c.byFp.get(f.id) ?? []).some((p) => classOf(p.net) === 'analog')).map((f) => f.id);
  const noisy = board.footprints.filter((f) => (c.byFp.get(f.id) ?? []).some((p) => classOf(p.net) === 'switch') && !sensitive.includes(f.id)).map((f) => f.id);
  const ids = board.footprints.map((f) => f.id);
  const currentPads = new Map<string, WorldPad[]>();
  const padsOf = new Map<string, { x: number; y: number; number: string; net: string; w: number; h: number }[]>();
  const refreshPads = (id: string) => {
    const ps = footprintPads({ ...fpById.get(id)!, ...pos.get(id)! }, board).filter((p) => !p.def.npth);
    currentPads.set(id, ps);
    padsOf.set(id, ps.map((p) => ({ ...p.center, number: p.number, net: p.net, w: p.rect.w, h: p.rect.h })));
  };
  for (const id of ids) refreshPads(id);
  const netsOfFp = new Map<string, string[]>(); for (const id of ids) netsOfFp.set(id, [...new Set((c.byFp.get(id) ?? []).map((p) => p.net).filter(Boolean))]);
  const fpsOfNet = new Map<string, string[]>(); for (const [id, ns] of netsOfFp) for (const n of ns) { if (!fpsOfNet.has(n)) fpsOfNet.set(n, []); fpsOfNet.get(n)!.push(id); }
  const netCost = (net: string) => { const ps: Vec[] = []; for (const id of fpsOfNet.get(net) ?? []) for (const p of padsOf.get(id)!) if (p.net === net) ps.push(p); return hpwl(ps) * (GND_RE.test(net) ? 0.3 : POWER_RE.test(net) ? 0.6 : 1); };
  const bodyCache = new Map<string, Rect>(); const body = (id: string) => { let r = bodyCache.get(id); if (!r) { r = bodyOf(id); bodyCache.set(id, r); } return r; };
  const decByCap = new Map(dps.map((d) => [d.cap, d])), decByIc = new Map<string, typeof dps>(); for (const d of dps) { if (!decByIc.has(d.ic)) decByIc.set(d.ic, []); decByIc.get(d.ic)!.push(d); }
  const xtalOf = new Map(xps.map((x) => [x.xtal, x.ic])), icXtals = new Map<string, string[]>(); for (const x of xps) { if (!icXtals.has(x.ic)) icXtals.set(x.ic, []); icXtals.get(x.ic)!.push(x.xtal); }
  const sensitiveSet = new Set(sensitive), noisySet = new Set(noisy);
  const affCost = (a: { part: string; ic: string; nets: string[]; weight: number }) => {
    const mine = padsOf.get(a.part)!, his = padsOf.get(a.ic)!;
    let d = Infinity; for (const n of a.nets) { if (GND_RE.test(n) && a.nets.length > 1) continue; for (const p of mine) if (p.net === n) for (const q of his) if (q.net === n) d = Math.min(d, Math.hypot(p.x - q.x, p.y - q.y)); }
    if (!Number.isFinite(d)) return 0;
    const slack = a.weight >= 8 ? 2.0 : a.weight >= 5 ? 3.0 : 4.0;
    return Math.max(0, d - slack) * a.weight;
  };
  const decCost = (d: { cap: string; ic: string; pin: string }) => { const capPads = padsOf.get(d.cap)!; const cp = capPads.find((q) => POWER_RE.test(q.net)); const pp = padsOf.get(d.ic)!.find((p) => p.number === d.pin && cp && p.net === cp.net); if (!pp || !cp) return 0; return Math.max(0, Math.hypot(pp.x - cp.x, pp.y - cp.y) - 2.5) * 6; };
  const singleCost = (id: string) => {
    let e = 0; const r = body(id);
    if (board.outline.length >= 3) { const m = edgeMargin; const corners = [{ x: r.x - m, y: r.y - m }, { x: r.x + r.w + m, y: r.y - m }, { x: r.x + r.w + m, y: r.y + r.h + m }, { x: r.x - m, y: r.y + r.h + m }]; for (const p of corners) if (!pointInPolygon(p, board.outline)) e += 400; }
    if (orig.has(id) && movableIds.includes(id) && !relocated.has(id)) { const q = pos.get(id)!, o = orig.get(id)!; const d = Math.hypot(q.x - o.x, q.y - o.y); e += d > maxMove ? (d - maxMove) * 50 + maxMove * 0.15 : d * 0.15; }
    e += pullCost(id);
    const intent = fpById.get(id)!.placement;
    if (intent?.edge && !edgePlacementFits({ ...fpById.get(id)!, ...pos.get(id)! }, board)) e += 2000;
    if (intent?.target) {
      const pin = padsOf.get(intent.target.footprintId)?.find(p => p.number === intent.target!.pad);
      const mine = padsOf.get(id)!.filter(p => pin?.net && p.net === pin.net);
      if (pin && mine.length) e += Math.max(0, Math.min(...mine.map(p => Math.hypot(p.x-pin.x,p.y-pin.y))) - intent.target.maxDistance) * 200;
    }
    const dc = decByCap.get(id); if (dc) e += decCost(dc);
    for (const d of decByIc.get(id) ?? []) e += decCost(d);
    const af = affByPart.get(id); if (af) e += affCost(af);
    for (const a of affByIc.get(id) ?? []) e += affCost(a);
    // 连接器接口朝板外
    if (plugs.has(id) && movableIds.includes(id)) { const f = fpById.get(id)!; const q = pos.get(id)!; const facing = connectorFacing({ ...f, x: q.x, y: q.y, rotation: q.rotation }, currentPads, board.outline); if (facing !== null) e += (1 - facing) * 20; }
    // 天线区靠板边
    if (antennaSet.has(id) && board.outline.length >= 3) { const az = antennaRect(id); if (az) { let dmin = Infinity; for (let k = 0; k < board.outline.length; k++) dmin = Math.min(dmin, segRectGap(board.outline[k], board.outline[(k + 1) % board.outline.length], az)); e += Math.max(0, dmin - 1) * 6; } }
    const ic = xtalOf.get(id); if (ic) { const a2 = pos.get(id)!, b2 = pos.get(ic)!; e += Math.max(0, Math.hypot(a2.x - b2.x, a2.y - b2.y) - 6) * 4; }
    for (const xt of icXtals.get(id) ?? []) { const a2 = pos.get(xt)!, b2 = pos.get(id)!; e += Math.max(0, Math.hypot(a2.x - b2.x, a2.y - b2.y) - 6) * 4; }
    return e;
  };
  const pairCost = (a: string, b: string) => {
    if (fpById.get(a)!.side !== fpById.get(b)!.side) return 0;
    const ra = body(a), rb = body(b);
    const ov = overlapArea(ra, rb); if (ov > 0) return 300 + ov * 200;
    let e = 0;
    const ga = fpById.get(a)!.placement?.group, gb = fpById.get(b)!.placement?.group;
    if (ga && ga === gb) e += Math.hypot(pos.get(a)!.x-pos.get(b)!.x, pos.get(a)!.y-pos.get(b)!.y) * 0.8;
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
    // 天线净空：其他器件不进天线区 5mm
    if (antennaSet.has(a) || antennaSet.has(b)) { const ant = antennaSet.has(a) ? a : b, other = ant === a ? b : a; if (!antennaSet.has(other)) { const az = antennaRect(ant); if (az) { const ov = overlapArea({ x: az.x - 5, y: az.y - 5, w: az.w + 10, h: az.h + 10 }, body(other)); if (ov > 0) e += 30 + ov * 10; } } }
    // 美观：相邻同类小件 —— 同向、对齐成排（差一点点没对齐罚，完全对齐不罚）
    if (smallPassive.has(a) && smallPassive.has(b) && typeCache.get(a) === typeCache.get(b) && g < 4) {
      const qa = pos.get(a)!, qb = pos.get(b)!;
      if ((qa.rotation - qb.rotation) % 180 !== 0) e += 1.5;
      const dx = Math.abs(qa.x - qb.x), dy = Math.abs(qa.y - qb.y);
      const miss = Math.min(dx, dy); if (miss > 0.05 && miss < 1.5) e += (1.5 - miss) * 1.2;
    }
    return e;
  };
  const deltaTerms = (moved: string[]) => {
    let e = 0; const ms = new Set(moved);
    for (const m of moved) { e += singleCost(m); for (const o of ids) if (o !== m && (!ms.has(o) || o > m)) e += pairCost(m, o); }
    const nets = new Set<string>(); for (const m of moved) for (const n of netsOfFp.get(m)!) nets.add(n);
    for (const n of nets) e += netCost(n);
    e += balanceCost();
    return e;
  };
  const fullCost = () => { let e = 0; for (const id of ids) e += singleCost(id); for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) e += pairCost(ids[i], ids[j]); for (const n of fpsOfNet.keys()) e += netCost(n); e += balanceCost(); return e; };
  // 空间均衡：没有固定件时，可动器件整体重心向板中心靠（弱项，避免整坨挤在角落）
  const hasFixed = board.footprints.some((f) => !movableIds.includes(f.id));
  const center = { x: c.bb.x + c.bb.w / 2, y: c.bb.y + c.bb.h / 2 };
  // 每个可动器件向板中心弱吸引（重心式均衡会奖励对称摊开，这里用逐件距离，既居中又不散开）
  const balanceCost = () => 0;
  const pullCost = (id: string) => (hasFixed || !movableIds.includes(id) ? 0 : Math.hypot(pos.get(id)!.x - center.x, pos.get(id)!.y - center.y) * 0.08);
  const setPos = (id: string, q: { x: number; y: number; rotation: number }) => { pos.set(id, q); bodyCache.delete(id); refreshPads(id); };
  let seed = opts.seed ?? 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const snap = (v: number) => Math.round(v / G) * G;
  const legalPosition = () => {
    for (let i = 0; i < ids.length; i++) {
      const r = body(ids[i]);
      if (!placementBodyInside({...fpById.get(ids[i])!,...pos.get(ids[i])!},board)) return false;
      for (let j = 0; j < i; j++) if (fpById.get(ids[i])!.side === fpById.get(ids[j])!.side && overlapArea(r, body(ids[j])) > 0) return false;
    }
    const candidate = { ...board, footprints: board.footprints.map(f => ({ ...f, ...pos.get(f.id)! })) };
    return antennaAreasClear(candidate) && candidate.footprints.every(f=>placementBodyInside(f,candidate)) && placementConstraintErrors(candidate).length === 0 && placementCopperClear(candidate, rules);
  };
  let cur = fullCost(), best = legalPosition() ? cur : Infinity; const bestPos = new Map([...pos].map(([k, v]) => [k, { ...v }]));
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
    // 整体平移：没有固定件且器件不多时，偶尔把全部可动器件一起挪一格（飞线不变，只改善居中 / 出板），单件移动做不到这一点
    if (!hasFixed && movable.length <= 60 && kind >= 0.97) {
      const dx = (Math.floor(rnd() * 3) - 1) * G * (1 + Math.floor(rnd() * 4)), dy = (Math.floor(rnd() * 3) - 1) * G * (1 + Math.floor(rnd() * 4));
      if (!dx && !dy) continue;
      const all = movableIds; const snapshotAll = all.map((id) => [id, { ...pos.get(id)! }] as [string, { x: number; y: number; rotation: number }]);
      const b0 = deltaTerms(all);
      for (const id of all) { const q = pos.get(id)!; setPos(id, { ...q, x: snap(q.x + dx), y: snap(q.y + dy) }); }
      const d = deltaTerms(all) - b0;
      if (d <= 0 || rnd() < Math.exp(-d / T)) { cur += d; if (cur < best - 1e-9 && legalPosition()) { best = cur; for (const [k, v] of pos) bestPos.set(k, { ...v }); } }
      else for (const [k, v] of snapshotAll) setPos(k, v);
      T = Math.max(0.05, T0 * (1 - (maxIter === Infinity ? (Date.now() - t0) / budget : iter / maxIter)));
      continue;
    }
    const before = deltaTerms(moved);
    if (kind < 0.7) {
      if (rnd() < 0.25) {
        // 定向移动：朝所连器件的引脚重心挪一步（比纯随机游走收敛快得多）
        let sx = 0, sy = 0, n = 0;
        for (const net of netsOfFp.get(f.id)!) { if (GND_RE.test(net)) continue; for (const o of fpsOfNet.get(net) ?? []) if (o !== f.id) for (const q of padsOf.get(o)!) if (q.net === net) { sx += q.x; sy += q.y; n++; } }
        if (n) { const tx = sx / n, ty = sy / n; const k = 0.3 + rnd() * 0.5; setPos(f.id, { ...old, x: snap(old.x + (tx - old.x) * k + (rnd() - 0.5) * 2 * G), y: snap(old.y + (ty - old.y) * k + (rnd() - 0.5) * 2 * G) }); }
        else { const step = G * (1 + Math.floor(rnd() * 3)); const ang = Math.floor(rnd() * 8) * Math.PI / 4; setPos(f.id, { ...old, x: snap(old.x + Math.cos(ang) * step), y: snap(old.y + Math.sin(ang) * step) }); }
      } else { const step = G * (1 + Math.floor(rnd() * (rnd() < 0.7 ? 3 : 10))); const ang = Math.floor(rnd() * 8) * Math.PI / 4; setPos(f.id, { ...old, x: snap(old.x + Math.cos(ang) * step), y: snap(old.y + Math.sin(ang) * step) }); }
    }
    else if (kind < 0.85) { if (opts.keepRotation) continue; setPos(f.id, { ...old, rotation: (old.rotation + 90) % 360 }); }
    else { const o2 = { ...pos.get(g2!.id)! }; setPos(f.id, { ...old, x: o2.x, y: o2.y }); setPos(g2!.id, { ...o2, x: old.x, y: old.y }); }
    const d = deltaTerms(moved) - before;
    if (d <= 0 || rnd() < Math.exp(-d / T)) { cur += d; if (cur < best - 1e-9 && legalPosition()) { best = cur; for (const [k, v] of pos) bestPos.set(k, { ...v }); } }
    else for (const [k, v] of undo) setPos(k, v);
    T = Math.max(0.05, T0 * (1 - (maxIter === Infinity ? (Date.now() - t0) / budget : iter / maxIter)));
  }
  const moves: PlacementResult['moves'] = [];
  for (const f of movable) { const q = bestPos.get(f.id)!; if (Math.abs(q.x - f.x) > 1e-6 || Math.abs(q.y - f.y) > 1e-6 || q.rotation !== f.rotation) moves.push({ id: f.id, ref: f.ref, x: q.x, y: q.y, rotation: q.rotation !== f.rotation ? q.rotation : undefined, from: { x: f.x, y: f.y, rotation: f.rotation } }); }
  const after = placementMetrics(applyPlacement(board, moves), rules);
  const result: PlacementResult = { moves, before, after, iterations: iter, ms: Date.now() - t0 };
  // A lower weighted cost must never turn an illegal placement into an accepted suggestion.
  if (!antennaAreasClear(applyPlacement(board,moves)) || after.overlaps || after.outside || !placementCopperClear(applyPlacement(board, moves), rules) || placementConstraintErrors(applyPlacement(board, moves)).length) {
    result.rejected = 'No legal placement found. ' + (placementConstraintErrors(applyPlacement(board, moves)).slice(0, 3).join('; ') || 'Components overlap, extend outside the board, or violate pad clearance.') + ' Adjust fixed components, board dimensions, or placement constraints.';
    result.moves = [];
    result.after = before;
    return result;
  }
  if (opts.verifyRouting !== false && moves.length && !needsLegalize) {
    const rb = opts.routeBudgetMs ?? 20000;
    const stat = (r: ReturnType<typeof autoroute>) => ({ routed: r.routed, total: r.total, vias: r.vias.length, length: Math.round(r.traces.reduce((n, t) => { for (let i = 1; i < t.points.length; i++) n += Math.hypot(t.points[i].x - t.points[i - 1].x, t.points[i].y - t.points[i - 1].y); return n; }, 0)) });
    opts.onProgress?.('验证：布线原布局');
    const r0 = stat(autoroute(board, rules, { timeBudgetMs: rb, optimize: false }));
    opts.onProgress?.('验证：布线新布局');
    const worse = (r1: ReturnType<typeof stat>) => r1.routed - (r1.total - r0.total) < r0.routed || (r1.routed === r0.routed && r1.length > r0.length * 1.15 && r1.vias >= r0.vias);
    let r1 = stat(autoroute(applyPlacement(board, moves), rules, { timeBudgetMs: rb, optimize: false }));
    result.routing = { before: r0, after: r1 };
    for (let count = Math.ceil(moves.length / 2); worse(r1) && moves.length > 1 && count >= 1; count = Math.floor(count / 2)) {
      // 回退：只保留位移最小的一半（多为去耦 / 晶振靠近这类小调整），不重叠再验证一次
      const conservative = [...moves].sort((a, b) => Math.hypot(a.x - a.from.x, a.y - a.from.y) - Math.hypot(b.x - b.from.x, b.y - b.from.y)).slice(0, count);
      const m2 = placementMetrics(applyPlacement(board, conservative), rules);
      if (antennaAreasClear(applyPlacement(board,conservative)) && m2.overlaps === 0 && m2.outside === 0 && m2.hpwl <= before.hpwl && !placementConstraintErrors(applyPlacement(board, conservative)).length && placementCopperClear(applyPlacement(board, conservative), rules)) {
        opts.onProgress?.('验证：布线保守方案');
        const r2 = stat(autoroute(applyPlacement(board, conservative), rules, { timeBudgetMs: rb, optimize: false }));
        if (!worse(r2)) { result.moves = conservative; result.after = m2; result.fallback = true; r1 = r2; result.routing = { before: r0, after: r2 }; }
      }
    }
    if (worse(r1)) { result.rejected = `新布局自动布线 ${r1.routed}/${r1.total}，不优于原布局 ${r0.routed}/${r0.total}，已放弃建议`; result.moves = []; result.after = before; }
    result.ms = Date.now() - t0;
  }
  if (opts.verifyRouting !== false && moves.length && needsLegalize) {
    // 原布局本身不合法（板外 / 重叠），没有可比性：只对新布局试布线用于展示
    const rb = opts.routeBudgetMs ?? 20000;
    opts.onProgress?.('验证：布线新布局');
    const r1 = autoroute(applyPlacement(board, moves), rules, { timeBudgetMs: rb, optimize: false });
    const len = Math.round(r1.traces.reduce((n, t) => { for (let i = 1; i < t.points.length; i++) n += Math.hypot(t.points[i].x - t.points[i - 1].x, t.points[i].y - t.points[i - 1].y); return n; }, 0));
    result.routing = { before: { routed: 0, total: r1.total, vias: 0, length: 0 }, after: { routed: r1.routed, total: r1.total, vias: r1.vias.length, length: len } };
    result.legalized = relocated.size;
    result.ms = Date.now() - t0;
  } else if (needsLegalize) result.legalized = relocated.size;
  return result;
}
export function applyPlacement(board: Board, moves: PlacementResult['moves']): Board {
  return { ...board, footprints: board.footprints.map((f) => { const m = moves.find((x) => x.id === f.id); return m ? { ...f, x: m.x, y: m.y, rotation: m.rotation ?? f.rotation } : f; }) };
}
