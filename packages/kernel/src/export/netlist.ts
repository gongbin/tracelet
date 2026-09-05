import type { Project } from '../model/project.js';
import { buildSchematicNetlist } from '../schematic/connectivity.js';
import { getSymbol } from '../library/symbols.js';
import { findFootprint } from '../library/footprints.js';

export interface NetlistJson {
  project: string;
  generatedAt: string;
  components: { ref: string; value: string; footprint: string; symbol: string }[];
  nets: { name: string; pins: { ref: string; pin: string; name: string }[] }[];
}

export function exportNetlistJson(project: Project): NetlistJson {
  const comps = project.schematic.sheets.flatMap((s) => s.components);
  const nl = buildSchematicNetlist(project.schematic);
  return {
    project: project.name,
    generatedAt: new Date().toISOString(),
    components: comps.filter((c) => !getSymbol(c.symbolId).power).map((c) => ({ ref: c.ref, value: c.value, footprint: findFootprint(c.footprint)?.name ?? c.footprint, symbol: getSymbol(c.symbolId).name })),
    nets: nl.nets.map((n) => ({ name: n.name, pins: n.pins.map((p) => ({ ref: p.ref, pin: p.pinNumber, name: p.pinName })) }))
  };
}

export interface BomRow { refs: string[]; qty: number; value: string; footprint: string; mpn: string; lcsc: string }

export function buildBom(project: Project): BomRow[] {
  const groups = new Map<string, BomRow>();
  for (const c of project.schematic.sheets.flatMap((s) => s.components)) {
    if (getSymbol(c.symbolId).power) continue;
    const fp = findFootprint(c.footprint)?.name ?? c.footprint;
    const k = `${c.value}|${fp}`;
    const row = groups.get(k) ?? { refs: [], qty: 0, value: c.value, footprint: fp, mpn: c.props.mpn ?? '', lcsc: c.props.lcsc ?? '' };
    row.refs.push(c.ref); row.qty++;
    groups.set(k, row);
  }
  return [...groups.values()].map((r) => ({ ...r, refs: r.refs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) }));
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** LCSC / 嘉立创模板 BOM。 */
export function exportBomCsv(project: Project): string {
  const rows = buildBom(project);
  const lines = ['Comment,Designator,Footprint,Quantity,MPN,LCSC Part #'];
  for (const r of rows) lines.push([r.value, r.refs.join(','), r.footprint, String(r.qty), r.mpn, r.lcsc].map(csvCell).join(','));
  return lines.join('\n') + '\n';
}

/** 坐标文件（贴片机）。嘉立创约定：mm，顶层 T / 底层 B。 */
export function exportPickAndPlaceCsv(project: Project): string {
  const lines = ['Designator,Mid X,Mid Y,Layer,Rotation'];
  for (const f of project.board.footprints) lines.push([f.ref, f.x.toFixed(3), f.y.toFixed(3), f.side === 'F' ? 'T' : 'B', String(f.rotation)].join(','));
  return lines.join('\n') + '\n';
}
