import type { Board } from '../model/board.js';
import type { RuleSet } from '../model/project.js';
import type { CheckItem, CheckReport } from '../schematic/erc.js';
import { segRectDist, segSegDist, rectsOverlap, pointInPolygon, expandRect, pointSegDist, type Vec } from '../geometry.js';
import { allPads, footprintBody, netClassFor } from './geometry.js';
import { computeRatsnest } from './ratsnest.js';

const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const f = (v: number) => v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');

export function runDrc(board: Board, rules: RuleSet): CheckReport {
  const items: CheckItem[] = [];
  let n = 0;
  const push = (i: Omit<CheckItem, 'id'>) => items.push({ id: `drc_${++n}`, ...i });
  const pads = allPads(board);
  const clearance = rules.minClearance;

  // 走线 vs 焊盘
  board.traces.forEach((t) => {
    for (let i = 0; i < t.points.length - 1; i++) {
      const a = t.points[i], b = t.points[i + 1];
      for (const p of pads) {
        if (!p.layers.includes(t.layer)) continue;
        if (p.net && t.net && p.net === t.net) continue;
        const d = segRectDist(a, b, p.rect) - t.width / 2;
        if (d < clearance - 1e-6) {
          push({ rule: 'clearance', severity: 'error', message: `间距不足 ${f(Math.max(d, 0))} < ${f(clearance)}mm`, why: '铜间距低于板厂最小值会在蚀刻时短路。', refs: [`走线 ${t.net || '?'} ↔ 焊盘 ${p.ref}.${p.number}`, t.layer], location: mid(a, b), objectIds: [t.id, p.footprintId] });
        }
      }
    }
  });

  // 走线 vs 走线
  for (let i = 0; i < board.traces.length; i++) for (let j = i + 1; j < board.traces.length; j++) {
    const t1 = board.traces[i], t2 = board.traces[j];
    if (t1.layer !== t2.layer) continue;
    if (t1.net && t2.net && t1.net === t2.net) continue;
    for (let a = 0; a < t1.points.length - 1; a++) for (let b = 0; b < t2.points.length - 1; b++) {
      const d = segSegDist(t1.points[a], t1.points[a + 1], t2.points[b], t2.points[b + 1]) - (t1.width + t2.width) / 2;
      if (d < clearance - 1e-6) push({ rule: 'clearance', severity: 'error', message: `走线间距不足 ${f(Math.max(d, 0))} < ${f(clearance)}mm`, why: '两条不同网络的走线太近，可能短路。', refs: [`${t1.net || '?'} ↔ ${t2.net || '?'}`, t1.layer], location: mid(t1.points[a], t2.points[b]), objectIds: [t1.id, t2.id] });
    }
  }

  // 线宽
  for (const t of board.traces) {
    if (t.width < rules.minTraceWidth - 1e-6) push({ rule: 'min-width', severity: 'error', message: `线宽 ${f(t.width)} 低于板厂最小 ${f(rules.minTraceWidth)}mm`, why: '过细的走线板厂无法可靠制造。', refs: [t.net || '?', t.layer], location: t.points[0], objectIds: [t.id] });
    else {
      const nc = netClassFor(board, t.net);
      if (nc && t.width < nc.traceWidth - 1e-6) push({ rule: 'netclass-width', severity: 'warning', message: `走线宽度低于网络类 ${nc.name}（${f(t.width)} < ${f(nc.traceWidth)}mm）`, why: '电源类走线太细会发热、压降变大。', refs: [t.net || '?'], location: t.points[0], objectIds: [t.id] });
    }
  }

  // 过孔 vs 异网络焊盘 / 走线
  for (const v of board.vias) {
    for (const p of pads) {
      if (p.net && v.net && p.net === v.net) continue;
      const d = segRectDist(v, v, p.rect) - v.size / 2;
      if (d < clearance - 1e-6) push({ rule: 'clearance', severity: 'error', message: `过孔与焊盘间距不足 ${f(Math.max(d, 0))} < ${f(clearance)}mm`, why: '过孔环与相邻焊盘太近会短路。', refs: [`过孔 ${v.net || '?'} ↔ ${p.ref}.${p.number}`], location: v, objectIds: [v.id, p.footprintId] });
    }
    for (const t of board.traces) {
      if (t.net && v.net && t.net === v.net) continue;
      for (let i = 0; i < t.points.length - 1; i++) { const d = pointSegDist(v, t.points[i], t.points[i + 1]) - v.size / 2 - t.width / 2; if (d < clearance - 1e-6) { push({ rule: 'clearance', severity: 'error', message: `过孔与走线间距不足 ${f(Math.max(d, 0))} < ${f(clearance)}mm`, why: '过孔环与异网络走线太近会短路。', refs: [`过孔 ${v.net || '?'} ↔ 走线 ${t.net || '?'}`, t.layer], location: v, objectIds: [v.id, t.id] }); break; } }
    }
  }
  // 过孔
  for (const v of board.vias) {
    if (v.drill < rules.minDrill - 1e-6) push({ rule: 'min-drill', severity: 'error', message: `过孔孔径 ${f(v.drill)} 低于最小 ${f(rules.minDrill)}mm`, why: '钻头规格有限，太小的孔无法加工。', refs: [v.net || '?'], location: v, objectIds: [v.id] });
    if ((v.size - v.drill) / 2 < rules.minAnnularRing - 1e-6) push({ rule: 'annular-ring', severity: 'error', message: `过孔环宽不足 ${f((v.size - v.drill) / 2)} < ${f(rules.minAnnularRing)}mm`, why: '环宽太小，钻孔偏移时会钻穿铜环。', refs: [v.net || '?'], location: v, objectIds: [v.id] });
  }

  // 铜到板边
  const inner = board.outline.length >= 3 ? board.outline : null;
  if (inner) {
    for (const p of pads) {
      if (p.def.npth) continue; // 非金属化孔没有铜
      const r = expandRect(p.rect, rules.copperToEdge);
      const corners = [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
      if (!corners.every((c) => pointInPolygon(c, inner))) push({ rule: 'copper-to-edge', severity: 'warning', message: `焊盘靠近板边 < ${f(rules.copperToEdge)}mm`, why: '切割公差可能切到铜，导致露铜或短路。', refs: [`${p.ref}.${p.number}`], location: p.center, objectIds: [p.footprintId] });
    }
    for (const v of board.vias) {
      const r = rules.copperToEdge + v.size / 2;
      const corners = [{ x: v.x - r, y: v.y - r }, { x: v.x + r, y: v.y - r }, { x: v.x + r, y: v.y + r }, { x: v.x - r, y: v.y + r }];
      if (!corners.every((c) => pointInPolygon(c, inner))) push({ rule: 'copper-to-edge', severity: 'warning', message: `过孔靠近板边 < ${f(rules.copperToEdge)}mm`, why: '切割公差可能切到铜环。', refs: [v.net || '?'], location: v, objectIds: [v.id] });
    }
    for (const fp of board.footprints) {
      const b = footprintBody(fp);
      const corners = [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }];
      if (!corners.some((c) => pointInPolygon(c, inner))) push({ rule: 'outside-board', severity: 'error', message: `元件在板框外`, why: '板框外的元件不会被制造，可能是还没布局。', refs: [fp.ref], location: { x: fp.x, y: fp.y }, objectIds: [fp.id] });
    }
  }

  // 元件重叠
  for (let i = 0; i < board.footprints.length; i++) for (let j = i + 1; j < board.footprints.length; j++) {
    const a = board.footprints[i], b = board.footprints[j];
    if (a.side !== b.side) continue;
    if (rectsOverlap(footprintBody(a), footprintBody(b))) push({ rule: 'courtyard-overlap', severity: 'error', message: `元件重叠`, why: '两个元件的占位区域重叠，贴片时会撞件。', refs: [a.ref, b.ref], location: { x: a.x, y: a.y }, objectIds: [a.id, b.id] });
  }

  // 未布线
  const rats = computeRatsnest(board, rules);
  const byNet = new Map<string, number>();
  for (const l of rats.lines) byNet.set(l.net, (byNet.get(l.net) ?? 0) + 1);
  for (const [net, count] of byNet) {
    const first = rats.lines.find((l) => l.net === net)!;
    push({ rule: 'unrouted', severity: 'error', message: `未连接网络 ${net}（${count} 处）`, why: '飞线表示原理图里相连、但 PCB 上还没用走线连起来。', refs: [net], location: mid(first.a, first.b), objectIds: [] });
  }

  return { items, errors: items.filter((i) => i.severity === 'error').length, warnings: items.filter((i) => i.severity === 'warning').length };
}
