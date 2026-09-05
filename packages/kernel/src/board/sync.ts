import type { Project } from '../model/project.js';
import type { Board, BoardFootprint } from '../model/board.js';
import { buildNetlist } from '../schematic/connectivity.js';
import { getSymbol } from '../library/symbols.js';
import { findFootprint } from '../library/footprints.js';
import { newId } from '../ids.js';
import { boardBounds } from './geometry.js';

export interface SyncDiff {
  added: string[];
  removed: string[];
  updated: string[];
}

/** 计算同步差异（不修改）。 */
export function diffBoardFromSchematic(project: Project): SyncDiff {
  const sheet = project.schematic.sheets[0];
  const comps = sheet.components.filter((c) => !getSymbol(c.symbolId).power);
  const existing = new Map(project.board.footprints.filter((f) => f.componentId).map((f) => [f.componentId!, f]));
  const compIds = new Set(comps.map((c) => c.id));
  return {
    added: comps.filter((c) => !existing.has(c.id)).map((c) => c.ref),
    removed: project.board.footprints.filter((f) => f.componentId && !compIds.has(f.componentId)).map((f) => f.ref),
    updated: comps.filter((c) => existing.has(c.id)).map((c) => c.ref)
  };
}

export function syncBoardFromSchematic(project: Project): Board {
  const sheet = project.schematic.sheets[0];
  const board = project.board;
  const netlist = buildNetlist(sheet);
  const comps = sheet.components.filter((c) => !getSymbol(c.symbolId).power);
  const compIds = new Set(comps.map((c) => c.id));

  const kept = board.footprints.filter((f) => !f.componentId || compIds.has(f.componentId));
  const byComp = new Map(kept.filter((f) => f.componentId).map((f) => [f.componentId!, f]));

  const bb = boardBounds(board);
  let col = 0, row = 0;
  const staging = (): { x: number; y: number } => {
    const p = { x: bb.x + bb.w + 8 + col * 14, y: bb.y + 6 + row * 14 };
    col++; if (col >= 3) { col = 0; row++; }
    return p;
  };

  const out: BoardFootprint[] = [];
  for (const c of comps) {
    const fpId = c.footprint && findFootprint(c.footprint) ? c.footprint : getSymbol(c.symbolId).defaultFootprint;
    const def = findFootprint(fpId);
    if (!def) continue;
    const padNets: Record<string, string> = {};
    for (const pad of def.pads) padNets[pad.number] = netlist.pinNet.get(`${c.id}:${pad.number}`) ?? '';
    const prev = byComp.get(c.id);
    if (prev) {
      const changedFp = prev.footprintId !== fpId;
      out.push({ ...prev, ref: c.ref, value: c.value, footprintId: fpId, padNets: changedFp ? padNets : { ...prev.padNets, ...padNets } });
    } else {
      const pos = staging();
      out.push({ id: newId('fp'), ref: c.ref, componentId: c.id, footprintId: fpId, value: c.value, x: pos.x, y: pos.y, rotation: 0, side: 'F', padNets });
    }
  }
  for (const f of kept) if (!f.componentId) out.push(f);

  // 走线网络名可能因标签变化而改变：按起点焊盘重新标注
  return { ...board, footprints: out };
}
