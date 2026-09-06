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
  // 2oz 外层铜：线宽 / 线距按重铜规则收紧（内层铜厚 ≥2oz 同理）
  const outerHeavy = (board.stackup?.copperWeight ?? 1) >= 2, innerHeavy = (board.stackup?.innerCopperWeight ?? 0.5) >= 2;
  const heavyOn = (layer: string) => (/^(F|B)\.Cu$/.test(layer) ? outerHeavy : innerHeavy);
  const minTraceOn = (layer: string) => (heavyOn(layer) ? Math.max(rules.minTraceWidth, rules.heavyCopperMinTrace) : rules.minTraceWidth);
  const clearanceOn = (layer: string) => (heavyOn(layer) ? Math.max(rules.minClearance, rules.heavyCopperMinTrace) : rules.minClearance);
  const clearance = rules.minClearance;

  // 走线 vs 焊盘
  board.traces.forEach((t) => {
    for (let i = 0; i < t.points.length - 1; i++) {
      const a = t.points[i], b = t.points[i + 1];
      for (const p of pads) {
        if (!p.layers.includes(t.layer)) continue;
        if (p.net && t.net && p.net === t.net) continue;
        const d = segRectDist(a, b, p.rect) - t.width / 2;
        const need = p.def.npth ? Math.max(clearanceOn(t.layer), rules.minNpthClearance) : clearanceOn(t.layer);
        if (d < need - 1e-6) {
          push({ rule: p.def.npth ? 'npth-clearance' : 'clearance', severity: 'error', message: p.def.npth ? `走线离非金属化孔太近 ${f(Math.max(d, 0))} < ${f(need)}mm` : `间距不足 ${f(Math.max(d, 0))} < ${f(need)}mm`, why: p.def.npth ? '无铜孔周围 0.2mm 会被掏空（干膜封孔工艺），太近的铜会被切掉。' : '铜间距低于板厂最小值会在蚀刻时短路。', refs: [`走线 ${t.net || '?'} ↔ 焊盘 ${p.ref}.${p.number}`, t.layer], location: mid(a, b), objectIds: [t.id, p.footprintId] });
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
      if (d < clearanceOn(t1.layer) - 1e-6) push({ rule: 'clearance', severity: 'error', message: `走线间距不足 ${f(Math.max(d, 0))} < ${f(clearanceOn(t1.layer))}mm`, why: '两条不同网络的走线太近，可能短路。', refs: [`${t1.net || '?'} ↔ ${t2.net || '?'}`, t1.layer], location: mid(t1.points[a], t2.points[b]), objectIds: [t1.id, t2.id] });
    }
  }

  // 线宽
  for (const t of board.traces) {
    if (t.width < minTraceOn(t.layer) - 1e-6) push({ rule: 'min-width', severity: 'error', message: `线宽 ${f(t.width)} 低于板厂最小 ${f(minTraceOn(t.layer))}mm${heavyOn(t.layer) ? '（2oz 铜）' : ''}`, why: '过细的走线板厂无法可靠制造；铜越厚，蚀刻能做的最小线宽越大。', refs: [t.net || '?', t.layer], location: t.points[0], objectIds: [t.id] });
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
    else if (v.drill < rules.preferredDrill - 1e-6) push({ rule: 'small-drill', severity: 'warning', message: `过孔孔径 ${f(v.drill)} 小于常规 ${f(rules.preferredDrill)}mm，属非常规工艺会加价`, why: '板厂常规钻孔 0.3mm 起；更小的孔可做但需塞孔、价格更高。', refs: [v.net || '?'], location: v, objectIds: [v.id] });
    if ((v.size - v.drill) / 2 < rules.minAnnularRing - 1e-6) push({ rule: 'annular-ring', severity: 'error', message: `过孔环宽不足 ${f((v.size - v.drill) / 2)} < ${f(rules.minAnnularRing)}mm`, why: '环宽太小，钻孔偏移时会钻穿铜环。', refs: [v.net || '?'], location: v, objectIds: [v.id] });
  }

  // 插件孔焊环（有铜通孔焊盘）
  for (const p of pads) {
    if (!p.through || p.def.npth || p.def.drill <= 0) continue;
    const ring = (Math.min(p.def.w, p.def.h) - p.def.drill) / 2;
    if (ring < rules.minPthAnnularRing - 1e-6) push({ rule: 'pth-annular-ring', severity: 'error', message: `插件孔焊环 ${f(ring)} < 极限 ${f(rules.minPthAnnularRing)}mm`, why: '焊环太窄，钻孔偏移（±0.05mm）会钻破焊盘。', refs: [`${p.ref}.${p.number}`], location: p.center, objectIds: [p.footprintId] });
    else if (ring < rules.recommendedPthAnnularRing - 1e-6) push({ rule: 'pth-annular-ring', severity: 'warning', message: `插件孔焊环 ${f(ring)} 低于建议 ${f(rules.recommendedPthAnnularRing)}mm`, why: '板厂建议插件孔焊环 ≥0.25mm，接近极限值可能出现破孔。', refs: [`${p.ref}.${p.number}`], location: p.center, objectIds: [p.footprintId] });
  }
  // 孔到孔（过孔 / 插件孔 / 无铜孔）：孔边距
  interface Hole { x: number; y: number; d: number; kind: 'via' | 'pth' | 'npth'; ref: string; fp?: string; id?: string }
  const holes: Hole[] = [
    ...board.vias.map((v): Hole => ({ x: v.x, y: v.y, d: v.drill, kind: 'via', ref: `过孔 ${v.net || '?'}`, id: v.id })),
    ...pads.filter((p) => p.def.drill > 0).map((p): Hole => ({ x: p.center.x, y: p.center.y, d: p.def.drill, kind: p.def.npth ? 'npth' : 'pth', ref: `${p.ref}.${p.number}`, fp: p.footprintId }))
  ];
  for (let i = 0; i < holes.length; i++) for (let j = i + 1; j < holes.length; j++) {
    const a = holes[i], b = holes[j];
    const gap = Math.hypot(a.x - b.x, a.y - b.y) - (a.d + b.d) / 2;
    if (gap < rules.minHoleToHole - 1e-6) push({ rule: 'hole-to-hole', severity: 'error', message: `孔边距 ${f(Math.max(gap, 0))} < ${f(rules.minHoleToHole)}mm`, why: '两个孔太近钻头会断、孔壁会破。', refs: [a.ref, b.ref], location: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, objectIds: [a.id ?? a.fp!, b.id ?? b.fp!] });
    else if ((a.kind !== 'via' || b.kind !== 'via') && !(a.fp && a.fp === b.fp) && gap < rules.recommendedPadHoleToHole - 1e-6) push({ rule: 'hole-to-hole', severity: 'warning', message: `插件孔孔边距 ${f(gap)} 低于建议 ${f(rules.recommendedPadHoleToHole)}mm`, why: '板厂建议插件孔之间孔边距 ≥0.45mm。', refs: [a.ref, b.ref], location: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, objectIds: [a.id ?? a.fp!, b.id ?? b.fp!] });
  }
  // 插件孔孔边到异网络走线 / 无铜孔到过孔
  for (const p of pads) {
    if (p.def.drill <= 0) continue;
    for (const t of board.traces) {
      if (!p.def.npth && p.net && t.net && p.net === t.net) continue;
      const need = p.def.npth ? rules.minNpthClearance : rules.minPthHoleToCopper;
      for (let i = 0; i < t.points.length - 1; i++) { const d = pointSegDist(p.center, t.points[i], t.points[i + 1]) - p.def.drill / 2 - t.width / 2; if (d < need - 1e-6 && !p.def.npth) { push({ rule: 'hole-to-copper', severity: 'error', message: `插件孔孔边到走线 ${f(Math.max(d, 0))} < ${f(need)}mm`, why: '钻孔偏移会钻到旁边的走线，板厂要求孔边到异网络铜 ≥0.28mm。', refs: [`${p.ref}.${p.number} ↔ ${t.net || '?'}`, t.layer], location: mid(t.points[i], t.points[i + 1]), objectIds: [p.footprintId, t.id] }); break; } }
    }
    if (p.def.npth) for (const v of board.vias) { const d = Math.hypot(v.x - p.center.x, v.y - p.center.y) - p.def.drill / 2 - v.size / 2; if (d < rules.minNpthClearance - 1e-6) push({ rule: 'npth-clearance', severity: 'error', message: `过孔离非金属化孔太近 ${f(Math.max(d, 0))} < ${f(rules.minNpthClearance)}mm`, why: '无铜孔周围 0.2mm 会被掏空。', refs: [`${p.ref}.${p.number}`, v.net || '?'], location: v, objectIds: [p.footprintId, v.id] }); }
  }
  // 不同封装之间的焊盘间距（异网络）
  for (let i = 0; i < pads.length; i++) for (let j = i + 1; j < pads.length; j++) {
    const a = pads[i], b = pads[j];
    if (a.footprintId === b.footprintId || a.def.npth || b.def.npth) continue;
    if (a.net && b.net && a.net === b.net) continue;
    if (!a.layers.some((l) => b.layers.includes(l))) continue;
    const dx = Math.max(0, Math.max(a.rect.x, b.rect.x) - Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w)), dy = Math.max(0, Math.max(a.rect.y, b.rect.y) - Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h));
    const d = Math.hypot(dx, dy);
    const need = clearanceOn(a.layers[0]);
    if (d < need - 1e-6) push({ rule: 'clearance', severity: 'error', message: `焊盘间距不足 ${f(d)} < ${f(need)}mm`, why: '两个元件的异网络焊盘太近，蚀刻 / 焊接时会短路。', refs: [`${a.ref}.${a.number} ↔ ${b.ref}.${b.number}`], location: a.center, objectIds: [a.footprintId, b.footprintId] });
  }
  // 丝印：字高、字符压焊盘
  for (const t of board.texts) {
    if (!/Silk/.test(t.layer)) continue;
    if (t.size < rules.minSilkHeight - 1e-6) push({ rule: 'silk-height', severity: 'warning', message: `丝印字高 ${f(t.size)} < ${f(rules.minSilkHeight)}mm`, why: '字太小丝印会糊成一团看不清；板厂常规字高 ≥1.0mm、线宽 ≥0.15mm。', refs: [t.text], location: { x: t.x, y: t.y }, objectIds: [t.id] });
    const w = t.text.length * t.size * 0.65, h = t.size * 1.2;
    const box = { x: t.x - w / 2, y: t.y - h, w, h };
    const side = t.layer.startsWith('F') ? 'F.Cu' : 'B.Cu';
    for (const p of pads) {
      if (!p.layers.includes(side)) continue;
      const dx = Math.max(0, Math.max(box.x, p.rect.x) - Math.min(box.x + box.w, p.rect.x + p.rect.w)), dy = Math.max(0, Math.max(box.y, p.rect.y) - Math.min(box.y + box.h, p.rect.y + p.rect.h));
      if (Math.hypot(dx, dy) < rules.silkToPad - 1e-6) { push({ rule: 'silk-on-pad', severity: 'warning', message: `丝印「${t.text}」压到焊盘 ${p.ref}.${p.number}`, why: '焊盘上的丝印会被板厂自动裁掉或影响焊接，字符到焊盘应 ≥0.15mm。', refs: [t.text, `${p.ref}.${p.number}`], location: { x: t.x, y: t.y }, objectIds: [t.id, p.footprintId] }); break; }
    }
  }
  // 板尺寸 / 板厚
  if (board.outline.length >= 3) {
    const xs = board.outline.map((p) => p.x), ys = board.outline.map((p) => p.y);
    const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
    if (bw < rules.minBoardSize - 1e-6 || bh < rules.minBoardSize - 1e-6) push({ rule: 'board-size', severity: 'error', message: `板子 ${f(bw)}×${f(bh)}mm 小于板厂最小 ${f(rules.minBoardSize)}×${f(rules.minBoardSize)}mm`, why: 'CNC 锣边能加工的最小单板尺寸有限。', refs: ['板框'], location: { x: Math.min(...xs), y: Math.min(...ys) }, objectIds: [] });
  }
  if (rules.boardThicknesses.length && !rules.boardThicknesses.some((t) => Math.abs(t - board.thickness) < 1e-6)) push({ rule: 'board-thickness', severity: 'warning', message: `板厚 ${f(board.thickness)}mm 不在板厂常规可选项（${rules.boardThicknesses.join(' / ')}）`, why: '下单时只能选常规板厚；非常规板厚需要另议。', refs: ['层叠'], location: board.outline[0] ?? { x: 0, y: 0 }, objectIds: [] });

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
