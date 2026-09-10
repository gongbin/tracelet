import type { Project } from '../model/project.js';
import type { Board, BoardFootprint } from '../model/board.js';
import { buildSchematicNetlist } from '../schematic/connectivity.js';
import { getSymbol } from '../library/symbols.js';
import { findFootprint } from '../library/footprints.js';
import { resolveFootprint } from './footprintResolve.js';
import type { FootprintDef } from '../model/board.js';
import { newId } from '../ids.js';
import { boardBounds } from './geometry.js';
import { componentPackages } from '../schematic/units.js';

export interface SyncDiff {
  added: string[];
  removed: string[];
  updated: string[];
}

/** 计算同步差异（不修改）。 */
export function diffBoardFromSchematic(project: Project): SyncDiff {
  const packages = componentPackages(project.schematic.sheets.flatMap((s) => s.components).filter((c) => !getSymbol(c.symbolId).power));
  const existing = new Map(project.board.footprints.filter((f) => f.componentId).map((f) => [f.componentId!, f]));
  const compIds = new Set(packages.flatMap(group => group.map(c => c.id)));
  return {
    added: packages.filter(group => !group.some(c => existing.has(c.id))).map(group => group[0].ref),
    removed: project.board.footprints.filter((f) => f.componentId && !compIds.has(f.componentId)).map((f) => f.ref),
    updated: packages.filter(group => group.some(c => existing.has(c.id))).map(group => group[0].ref)
  };
}

export interface SyncOutcome { board: Board; createdFootprints: FootprintDef[]; placeholders: string[]; mapped: string[] }

export function syncBoardFromSchematic(project: Project): Board {
  return syncBoardDetailed(project).board;
}

/** 同步并返回细节：新建的占位封装、使用占位/映射封装的位号。 */
export function syncBoardDetailed(project: Project): SyncOutcome {
  const board = project.board;
  const createdFootprints: FootprintDef[] = [];
  const placeholders: string[] = [], mapped: string[] = [];
  const netlist = buildSchematicNetlist(project.schematic);
  const comps = project.schematic.sheets.flatMap((s) => s.components).filter((c) => !getSymbol(c.symbolId).power);
  const packages = componentPackages(comps);
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
  for (const group of packages) {
    const c = group[0];
    const packagePins = group.length > 1 ? [...new Set(group.flatMap(unit => getSymbol(unit.symbolId).pins.map(p => p.number)))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : undefined;
    const res = resolveFootprint(c, packagePins);
    const fpId = res.id;
    if (res.created && !createdFootprints.some((d) => d.id === res.created!.id)) createdFootprints.push(res.created);
    if (res.placeholder) placeholders.push(c.ref);
    if (res.mapped) mapped.push(c.ref);
    const def = findFootprint(fpId);
    if (!def) continue;
    for (const unit of group) if (unit.pinMap) {
      const targets=Object.values(unit.pinMap);
      if (new Set(targets).size!==targets.length || targets.some(n=>!def.pads.some(p=>p.number===n && !p.npth)) || getSymbol(unit.symbolId).pins.some(p=>p.type!=='no_connect' && !unit.pinMap![p.number])) throw new Error(`Invalid pin mapping: ${unit.ref}`);
    }
    const padNets: Record<string, string> = {};
    for (const pad of def.pads) {
      const names = new Set(group.flatMap(unit => {
        const pin = unit.pinMap ? Object.keys(unit.pinMap).find(pin => unit.pinMap![pin] === pad.number) : pad.number;
        const name = pin ? netlist.pinNet.get(`${unit.id}:${pin}`) : '';
        return name ? [name] : [];
      }));
      if (names.size > 1) throw new Error(`Conflicting pad nets: ${c.ref}.${pad.number}`);
      padNets[pad.number] = [...names][0] ?? '';
    }
    const prev = group.map(unit => byComp.get(unit.id)).find(Boolean);
    if (prev) {
      const changedFp = prev.footprintId !== fpId;
      out.push({ ...prev, componentId: c.id, ref: c.ref, value: c.value, footprintId: fpId, padNets: changedFp ? padNets : { ...prev.padNets, ...padNets } });
    } else {
      const pos = staging();
      out.push({ id: newId('fp'), ref: c.ref, componentId: c.id, footprintId: fpId, value: c.value, x: pos.x, y: pos.y, rotation: 0, side: 'F', padNets });
    }
  }
  for (const f of kept) if (!f.componentId) out.push(f);

  return { board: { ...board, footprints: out }, createdFootprints, placeholders, mapped };
}
