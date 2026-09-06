import type { Project } from '../model/project.js';
import type { Board, BoardText, CopperLayer, Layer, Trace, Via, Zone, Stackup } from '../model/board.js';
import { DEFAULT_STACKUP, copperLayers } from '../model/board.js';
import { findFootprint, BUILTIN_FOOTPRINTS } from '../library/footprints.js';
import { registeredFootprint } from '../library/registry.js';
import { ensureFootprintDef } from '../board/footprintResolve.js';
import { boardBounds, footprintBody, allPads, rectOutline } from '../board/geometry.js';
import type { Vec } from '../geometry.js';
import { newId } from '../ids.js';
import { command, type Command } from './types.js';
import { syncBoardDetailed } from '../board/sync.js';

function updateBoard(p: Project, fn: (b: Board) => Board): Project {
  return { ...p, board: fn(p.board) };
}

export function moveFootprint(id: string, pos: Vec): Command {
  return command('移动封装', (proj) => updateBoard(proj, (b) => ({ ...b, footprints: b.footprints.map((f) => (f.id === id ? { ...f, x: pos.x, y: pos.y } : f)) })));
}

export function rotateFootprint(id: string, delta = 90): Command {
  return command('旋转封装', (proj) => updateBoard(proj, (b) => ({ ...b, footprints: b.footprints.map((f) => (f.id === id ? { ...f, rotation: ((f.rotation + delta) % 360 + 360) % 360 } : f)) })));
}

export function flipFootprint(id: string): Command {
  return command('翻面', (proj) => updateBoard(proj, (b) => ({ ...b, footprints: b.footprints.map((f) => (f.id === id ? { ...f, side: f.side === 'F' ? 'B' : 'F' } : f)) })));
}

export function addTrace(t: Omit<Trace, 'id'>): { command: Command; id: string } {
  const id = newId('t');
  return { id, command: command('走线', (proj) => updateBoard(proj, (b) => ({ ...b, traces: [...b.traces, { id, ...t }] }))) };
}

export function deleteTraces(ids: string[]): Command {
  const set = new Set(ids);
  return command('删除走线', (proj) => updateBoard(proj, (b) => ({ ...b, traces: b.traces.filter((t) => !set.has(t.id)) })));
}

export function addVia(v: { x: number; y: number; size: number; drill: number; net?: string }): Command {
  return command('过孔', (proj) => updateBoard(proj, (b) => ({ ...b, vias: [...b.vias, { id: newId('v'), net: '', ...v }] })));
}

export function deleteVias(ids: string[]): Command {
  const set = new Set(ids);
  return command('删除过孔', (proj) => updateBoard(proj, (b) => ({ ...b, vias: b.vias.filter((v) => !set.has(v.id)) })));
}

export function addZone(z: Omit<Zone, 'id' | 'thermal' | 'thermalGap' | 'spokeWidth' | 'clearance'> & Partial<Pick<Zone, 'thermal' | 'thermalGap' | 'spokeWidth' | 'clearance'>>): Command {
  return command('铺铜', (proj) => updateBoard(proj, (b) => ({ ...b, zones: [...b.zones, { thermal: 'relief', thermalGap: 0.3, spokeWidth: 0.4, clearance: 0, ...z, id: newId('z') }] })));
}

export function setZoneProps(id: string, props: Partial<Pick<Zone, 'net' | 'layer' | 'thermal' | 'thermalGap' | 'spokeWidth' | 'clearance'>>): Command {
  return command('修改铺铜', (proj) => updateBoard(proj, (b) => ({ ...b, zones: b.zones.map((z) => (z.id === id ? { ...z, ...props } : z)) })));
}

export function deleteZones(ids: string[]): Command {
  const set = new Set(ids);
  return command('删除铺铜', (proj) => updateBoard(proj, (b) => ({ ...b, zones: b.zones.filter((z) => !set.has(z.id)) })));
}

export function addBoardText(t: { layer: 'F.Silk' | 'B.Silk'; text: string; x: number; y: number; size?: number }): Command {
  return command('丝印文字', (proj) => updateBoard(proj, (b) => ({ ...b, texts: [...b.texts, { id: newId('x'), size: 1, ...t }] })));
}

export function setTracePoints(id: string, points: Vec[]): Command {
  return command('编辑走线', (proj) => updateBoard(proj, (b) => ({ ...b, traces: b.traces.map((t) => (t.id === id ? { ...t, points } : t)) })));
}

export function setTraceProps(id: string, props: Partial<Pick<Trace, 'width' | 'layer' | 'net'>>): Command {
  return command('修改走线', (proj) => updateBoard(proj, (b) => ({ ...b, traces: b.traces.map((t) => (t.id === id ? { ...t, ...props } : t)) })));
}

export function setViaProps(id: string, props: Partial<Pick<Via, 'x' | 'y' | 'size' | 'drill' | 'net' | 'startLayer' | 'endLayer' | 'backdrill'>>): Command {
  return command('修改过孔', (proj) => updateBoard(proj, (b) => ({ ...b, vias: b.vias.map((v) => (v.id === id ? { ...v, ...props } : v)) })));
}

export function setTextProps(id: string, props: Partial<Pick<BoardText, 'x' | 'y' | 'text' | 'size' | 'layer'>>): Command {
  return command('修改文字', (proj) => updateBoard(proj, (b) => ({ ...b, texts: b.texts.map((t) => (t.id === id ? { ...t, ...props } : t)) })));
}

export function deleteTexts(ids: string[]): Command {
  const set = new Set(ids);
  return command('删除文字', (proj) => updateBoard(proj, (b) => ({ ...b, texts: b.texts.filter((t) => !set.has(t.id)) })));
}

/** 设置任意多边形板框（至少 3 点）。 */
export function setOutline(points: Vec[]): Command {
  return command('板框', (proj) => (points.length < 3 ? proj : updateBoard(proj, (b) => ({ ...b, outline: points, outlineRadius: 0 }))));
}

/** 设置矩形板框的圆角半径（按当前外接矩形重建板框）。 */
export function setOutlineRadius(r: number): Command {
  return command(r > 0 ? `板框圆角 ${r}mm` : '板框直角', (proj) => updateBoard(proj, (b) => { const o = boardBounds(b); return { ...b, outlineRadius: Math.max(0, r), outline: rectOutline(o.x, o.y, o.w, o.h, r) }; }));
}

/** 撤销布线 / 铺铜：清空走线、过孔、铺铜中的任意组合，方便重新布局后再布线（可 undo）。 */
export function clearRouting(what: { traces?: boolean; vias?: boolean; zones?: boolean } = { traces: true, vias: true, zones: true }): Command {
  const parts = [what.traces ? '走线' : '', what.vias ? '过孔' : '', what.zones ? '铺铜' : ''].filter(Boolean).join(' / ');
  return command(`清除${parts}`, (proj) => updateBoard(proj, (b) => ({ ...b, traces: what.traces ? [] : b.traces, vias: what.vias ? [] : b.vias, zones: what.zones ? [] : b.zones })));
}

/** 批量移动封装（对齐 / 分布）。 */
export function moveFootprints(moves: { id: string; x: number; y: number }[]): Command {
  const m = new Map(moves.map((x) => [x.id, x]));
  return command('对齐 / 分布', (proj) => updateBoard(proj, (b) => ({ ...b, footprints: b.footprints.map((f) => (m.has(f.id) ? { ...f, x: m.get(f.id)!.x, y: m.get(f.id)!.y } : f)) })));
}

/** 应用自动布线结果。 */
export function applyRoutes(traces: Omit<Trace, 'id'>[], vias: Omit<Via, 'id'>[], moves: { id: string; x: number; y: number }[] = []): Command {
  return command(`自动布线（${traces.length} 段）`, (proj) => updateBoard(proj, (b) => ({
    ...b,
    footprints: b.footprints.map(fp => { const move = moves.find(m => m.id === fp.id); return move && !fp.locked ? { ...fp, x: move.x, y: move.y } : fp; }),
    traces: [...b.traces, ...traces.map((t) => ({ id: newId('t'), ...t }))],
    vias: [...b.vias, ...vias.map((v) => ({ id: newId('v'), ...v }))]
  })));
}

/** 矩形板框：保持当前板框左上角不动（元件不会因此跑到板外）；可指定 origin。 */
export function setOutlineRect(w: number, h: number, origin?: Vec): Command {
  return command('板框尺寸', (proj) => updateBoard(proj, (b) => {
    const o = origin ?? (b.outline.length >= 3 ? boardBounds(b) : { x: 0, y: 0 });
    return { ...b, outline: rectOutline(o.x, o.y, w, h, b.outlineRadius ?? 0) };
  }));
}

const shift = (p: Vec, dx: number, dy: number): Vec => ({ x: Math.round((p.x + dx) * 1000) / 1000, y: Math.round((p.y + dy) * 1000) / 1000 });

/** 平移板框（不动元件）。 */
export function translateOutline(dx: number, dy: number): Command {
  return command('移动板框', (proj) => updateBoard(proj, (b) => ({ ...b, outline: b.outline.map((p) => shift(p, dx, dy)) })));
}

/** 整板平移：板框 + 元件 + 走线 + 过孔 + 铺铜 + 文字一起动。 */
export function translateBoard(dx: number, dy: number): Command {
  return command('移动整板', (proj) => updateBoard(proj, (b) => ({
    ...b,
    outline: b.outline.map((p) => shift(p, dx, dy)),
    footprints: b.footprints.map((f) => ({ ...f, ...shift(f, dx, dy) })),
    traces: b.traces.map((t) => ({ ...t, points: t.points.map((p) => shift(p, dx, dy)) })),
    vias: b.vias.map((v) => ({ ...v, ...shift(v, dx, dy) })),
    zones: b.zones.map((z) => ({ ...z, polygon: z.polygon.map((p) => shift(p, dx, dy)) })),
    texts: b.texts.map((t) => ({ ...t, ...shift(t, dx, dy) }))
  })));
}

/** 板上内容（元件本体与焊盘、走线、过孔、铺铜、文字）的外接框；没有内容返回 null。 */
export function contentBounds(b: Board): { x: number; y: number; w: number; h: number } | null {
  const xs: number[] = [], ys: number[] = [];
  const add = (x: number, y: number) => { xs.push(x); ys.push(y); };
  for (const f of b.footprints) { const r = footprintBody(f); add(r.x, r.y); add(r.x + r.w, r.y + r.h); }
  for (const p of allPads(b)) { add(p.rect.x, p.rect.y); add(p.rect.x + p.rect.w, p.rect.y + p.rect.h); }
  for (const t of b.traces) for (const p of t.points) { add(p.x - t.width / 2, p.y - t.width / 2); add(p.x + t.width / 2, p.y + t.width / 2); }
  for (const v of b.vias) { add(v.x - v.size / 2, v.y - v.size / 2); add(v.x + v.size / 2, v.y + v.size / 2); }
  for (const z of b.zones) for (const p of z.polygon) add(p.x, p.y);
  for (const t of b.texts) { add(t.x - t.text.length * 0.4 * t.size, t.y - t.size); add(t.x + t.text.length * 0.4 * t.size, t.y); }
  if (!xs.length) return null;
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** 板框自动包住现有内容（四周留 margin，取整到 0.5mm），不移动元件。 */
export function fitOutlineToContent(margin = 2): Command {
  return command('板框适配内容', (proj) => updateBoard(proj, (b) => {
    const c = contentBounds(b); if (!c) return b;
    const r = (v: number) => Math.round(v * 2) / 2;
    const x = r(c.x - margin), y = r(c.y - margin), w = Math.max(5, r(c.w + 2 * margin)), h = Math.max(5, r(c.h + 2 * margin));
    return { ...b, outline: rectOutline(x, y, w, h, b.outlineRadius ?? 0) };
  }));
}

/** 把整板（含内容）平移到板框左上角位于 (0,0)。 */
export function normalizeBoardOrigin(): Command {
  return command('板框归零', (proj) => { const bb = boardBounds(proj.board); return bb.x === 0 && bb.y === 0 ? proj : translateBoard(-bb.x, -bb.y).apply(proj); });
}

export function setCopperCount(count: 2 | 4 | 6): Command {
  return command(`改为 ${count} 层`, (proj) => updateBoard(proj, (b) => {
    const allowed = copperLayers(count);
    if (b.vias.some(v => (v.startLayer && !allowed.includes(v.startLayer)) || (v.endLayer && !allowed.includes(v.endLayer)) || (v.backdrill && count!==b.copperCount)) || b.traces.some(t => !allowed.includes(t.layer)) || b.zones.some(z => !allowed.includes(z.layer))) {
      throw new Error('Cannot remove layers containing traces or zones');
    }
    return { ...b, copperCount: count, stackup: b.stackup && count!==b.copperCount ? {...b.stackup,copperDepths:undefined} : b.stackup, hiddenLayers: b.hiddenLayers.filter(l => !l.endsWith('.Cu') || allowed.includes(l as CopperLayer)) };
  }));
}

export function setLayerHidden(layer: Layer, hidden: boolean): Command {
  return command(hidden ? `隐藏 ${layer}` : `显示 ${layer}`, (proj) => updateBoard(proj, (b) => ({ ...b, hiddenLayers: hidden ? [...new Set([...b.hiddenLayers, layer])] : b.hiddenLayers.filter((l) => l !== layer) })));
}

/** 原理图 → PCB 同步：新增/删除封装、更新焊盘网络。 */
export function syncFromSchematic(): Command {
  return command('同步到 PCB', (proj) => {
    const r = syncBoardDetailed(proj);
    const known = new Set(proj.library.footprints.map((f) => f.id));
    const add = r.createdFootprints.filter((f) => !known.has(f.id));
    // 板上引用的、仅存在于运行时注册表的封装（参数化生成 / 库导入）也写入项目库，避免重新打开后丢失
    for (const f of r.board.footprints) {
      if (known.has(f.footprintId) || add.some((d) => d.id === f.footprintId) || BUILTIN_FOOTPRINTS.some((d) => d.id === f.footprintId)) continue;
      const def = registeredFootprint(f.footprintId); if (def) add.push(def);
    }
    return { ...proj, board: r.board, library: add.length ? { ...proj.library, footprints: [...proj.library.footprints, ...add] } : proj.library };
  });
}

/** Assign a model to all instances of one footprint definition; undoable and serialized. */
export function setFootprintModel(footprintId: string, model?: import('../model/board.js').Model3d): Command {
  return command('匹配 3D 模型', proj => updateBoard(proj, b => {
    const models3d = { ...b.models3d };
    if (model) models3d[footprintId] = model; else delete models3d[footprintId];
    return { ...b, models3d };
  }));
}

/** 板厚 / 叠层参数。 */
export function setBoardProps(props: { thickness?: number; stackup?: Partial<Stackup> }): Command {
  return command('板参数', (proj) => updateBoard(proj, (b) => ({
    ...b,
    thickness: props.thickness && props.thickness > 0 ? props.thickness : b.thickness,
    stackup: props.stackup ? { ...DEFAULT_STACKUP, ...(b.stackup ?? {}), ...props.stackup } : b.stackup
  })));
}

export interface AddBoardFootprintArgs { footprintId: string; x: number; y: number; ref?: string; prefix?: string; value?: string; side?: 'F' | 'B'; rotation?: number }

/**
 * 在 PCB 上直接放置一个"仅板级"封装（定位孔、基准点、Logo、测试点等），不出现在原理图 / BOM。
 * 同步原理图时保留。位号按前缀自动递增（默认 H 定位孔、FID 基准点、其余 M）。
 */
export function addBoardFootprint(p: Project, args: AddBoardFootprintArgs): { command: Command; id: string; ref: string } {
  const def = findFootprint(args.footprintId) ?? ensureFootprintDef({ footprintId: args.footprintId, padNets: {}, ref: '' });
  const npthOnly = def.pads.length > 0 && def.pads.every((pd) => pd.npth);
  const prefix = args.prefix ?? (npthOnly ? 'H' : /fiducial/i.test(def.name) ? 'FID' : /test/i.test(def.name) ? 'TP' : 'M');
  let ref = args.ref;
  if (!ref) {
    const used = new Set(p.board.footprints.map((f) => f.ref));
    let n = 1; while (used.has(`${prefix}${n}`)) n++;
    ref = `${prefix}${n}`;
  }
  const id = newId('fp');
  const padNets: Record<string, string> = {};
  for (const pd of def.pads) padNets[pd.number] = '';
  const cmd = command(`放置 ${ref}`, (proj) => updateBoard(proj, (b) => ({ ...b, footprints: [...b.footprints, { id, ref: ref!, footprintId: args.footprintId, value: args.value ?? def.name, x: args.x, y: args.y, rotation: args.rotation ?? 0, side: args.side ?? 'F', padNets }] })));
  return { command: cmd, id, ref };
}

/** 删除板上封装（仅板级封装可直接删除；来自原理图的封装应在原理图中删除后同步）。 */
export function deleteFootprints(ids: string[]): Command {
  const set = new Set(ids);
  return command('删除封装', (proj) => updateBoard(proj, (b) => ({ ...b, footprints: b.footprints.filter((f) => !set.has(f.id)) })));
}

/** 应用布局优化建议（可撤销）。 */
export function applyPlacementMoves(moves: { id: string; x: number; y: number; rotation?: number }[], outline?: import('../geometry.js').Vec[]): Command {
  return command(`布局优化（${moves.length} 个器件）`, (proj) => updateBoard(proj, (b) => ({ ...b, outline: outline ?? b.outline, outlineRadius: outline ? undefined : b.outlineRadius, footprints: b.footprints.map((f) => { const m = moves.find((x) => x.id === f.id); return m && !f.locked && !f.placement?.fixed && f.placement?.role !== 'mechanical' ? { ...f, x: m.x, y: m.y, rotation: m.rotation ?? f.rotation } : f; }) })));
}

/** Persist editable placement intent through the normal undo/redo history. */
export function setPlacementConstraints(id: string, placement: import('../model/board.js').BoardFootprint['placement']): Command {
  return command('Placement constraints', proj => updateBoard(proj, b => ({ ...b,
    footprints: b.footprints.map(f => f.id === id ? { ...f, placement } : f)
  })));
}

export function setNetClassConstraints(index: number, constraints: Pick<import('../model/board.js').NetClass, 'allowedLayers' | 'maxLength' | 'neckdown' | 'referenceLayer' | 'referenceNet' | 'engineering' | 'power'>): Command {
  return command('Routing constraints', proj => updateBoard(proj,b=>({...b,netClasses:b.netClasses.map((nc,i)=>i===index?{...nc,...constraints}:nc)})));
}

export function setDifferentialPairs(pairs: Board['differentialPairs']): Command {
  return command('Differential pair constraints',proj=>updateBoard(proj,b=>({...b,differentialPairs:pairs})));
}
