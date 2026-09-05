import type { Project } from '../model/project.js';
import type { Board, CopperLayer, Layer, Trace, Zone } from '../model/board.js';
import type { Vec } from '../geometry.js';
import { newId } from '../ids.js';
import { command, type Command } from './types.js';
import { syncBoardFromSchematic } from '../board/sync.js';

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

export function addZone(z: Omit<Zone, 'id'>): Command {
  return command('铺铜', (proj) => updateBoard(proj, (b) => ({ ...b, zones: [...b.zones, { id: newId('z'), ...z }] })));
}

export function deleteZones(ids: string[]): Command {
  const set = new Set(ids);
  return command('删除铺铜', (proj) => updateBoard(proj, (b) => ({ ...b, zones: b.zones.filter((z) => !set.has(z.id)) })));
}

export function addBoardText(t: { layer: 'F.Silk' | 'B.Silk'; text: string; x: number; y: number; size?: number }): Command {
  return command('丝印文字', (proj) => updateBoard(proj, (b) => ({ ...b, texts: [...b.texts, { id: newId('x'), size: 1, ...t }] })));
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
  return command('同步到 PCB', (proj) => ({ ...proj, board: syncBoardFromSchematic(proj) }));
}
