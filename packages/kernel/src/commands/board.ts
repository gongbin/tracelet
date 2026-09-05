import type { Project } from '../model/project.js';
import type { Board, BoardText, CopperLayer, Layer, Trace, Via, Zone, Stackup } from '../model/board.js';
import { DEFAULT_STACKUP } from '../model/board.js';
import { findFootprint, BUILTIN_FOOTPRINTS } from '../library/footprints.js';
import { registeredFootprint } from '../library/registry.js';
import { ensureFootprintDef } from '../board/footprintResolve.js';
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

export function setViaProps(id: string, props: Partial<Pick<Via, 'x' | 'y' | 'size' | 'drill' | 'net'>>): Command {
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
  return command('板框', (proj) => (points.length < 3 ? proj : updateBoard(proj, (b) => ({ ...b, outline: points }))));
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

export function setOutlineRect(w: number, h: number): Command {
  return command('板框', (proj) => updateBoard(proj, (b) => ({ ...b, outline: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }] })));
}

export function setCopperCount(count: 2 | 4): Command {
  return command(count === 4 ? '改为 4 层' : '改为 2 层', (proj) => updateBoard(proj, (b) => {
    const inner: CopperLayer[] = ['In1.Cu', 'In2.Cu'];
    return { ...b, copperCount: count, traces: count === 2 ? b.traces.filter((t) => !inner.includes(t.layer)) : b.traces, zones: count === 2 ? b.zones.filter((z) => !inner.includes(z.layer)) : b.zones };
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
