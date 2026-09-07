import type { SchComponent } from '../model/schematic.js';
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

export function isAssemblyComponent(c: SchComponent, project: Project): boolean {
  const props = Object.fromEntries(Object.entries(c.props).map(([k,v]) => [k.toLowerCase(), v.toLowerCase().trim()]));
  const yes = (v?: string) => !!v && ['true', 'yes', '1', 'dnp'].includes(v);
  return !c.ref.startsWith('#') && !getSymbol(c.symbolId).power && !yes(props.exclude_from_bom) && !yes(props.exclude_from_board) && (project.settings.manufacturing?.includeDnp === true || !yes(props.dnp));
}

export function buildBom(project: Project): BomRow[] {
  const groups = new Map<string, BomRow>();
  for (const c of project.schematic.sheets.flatMap((s) => s.components)) {
    if (!isAssemblyComponent(c, project)) continue;
    const fp = findFootprint(c.footprint)?.name ?? c.footprint;
    const k = JSON.stringify([c.value, fp, c.props.mpn ?? c.props.MPN ?? '', c.props.lcsc ?? c.props.LCSC ?? c.props['LCSC Part #'] ?? '']);
    const row = groups.get(k) ?? { refs: [], qty: 0, value: c.value, footprint: fp, mpn: c.props.mpn ?? c.props.MPN ?? '', lcsc: c.props.lcsc ?? c.props.LCSC ?? c.props['LCSC Part #'] ?? '' };
    row.refs.push(c.ref); row.qty++;
    groups.set(k, row);
  }
  return [...groups.values()].map((r) => ({ ...r, refs: r.refs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) }));
}

const csvCell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

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
  const components = project.schematic.sheets.flatMap(s => s.components);
  const origin = project.settings.manufacturing?.origin ?? { x: 0, y: 0 };
  for (const f of project.board.footprints) {
    const c = components.find(c => f.componentId ? c.id === f.componentId : c.ref === f.ref);
    if (!c || !isAssemblyComponent(c, project)) continue;
    if (![f.x,f.y,f.rotation,origin.x,origin.y].every(Number.isFinite)) throw new Error(`Invalid placement: ${f.ref}`);
    const angle = f.side === 'B' && project.settings.manufacturing?.bottomRotation === 'bottom-view' ? 180 - f.rotation : -f.rotation;
    lines.push([f.ref, (f.x-origin.x).toFixed(3), (origin.y-f.y).toFixed(3), f.side === 'F' ? 'T' : 'B', String((angle % 360 + 360) % 360)].map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}
