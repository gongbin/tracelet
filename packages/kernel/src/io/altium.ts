/** Altium Designer 工程导入：多张 .SchDoc + 一个 .PcbDoc → 本工程 Project（与 KiCad 导入同样的关联方式）。 */
import { createProject, type Project } from '../model/project.js';
import type { Sheet, SymbolDef, SchComponent } from '../model/schematic.js';
import type { FootprintDef } from '../model/board.js';
import { registerSymbols, registerFootprints } from '../library/registry.js';
import { getSymbol } from '../library/symbols.js';
import { buildSchematicNetlist } from '../schematic/connectivity.js';
import { importAltiumSch } from './altiumSch.js';
import { importAltiumPcb } from './altiumPcb.js';
import type { ImportWarning } from './kicad.js';

export interface AltiumImportInput { name?: string; schematics?: { name: string; data: Uint8Array }[]; pcb?: Uint8Array }
export interface AltiumImportResult { project: Project; warnings: ImportWarning[]; stats: Record<string, number> }

/** 判断二进制是否是 OLE 复合文档（Altium 文件的容器） */
export function looksLikeOle(data: Uint8Array): boolean {
  const m = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return data.length > 512 && m.every((b, i) => data[i] === b);
}

export function importAltiumProject(input: AltiumImportInput): AltiumImportResult {
  const warnings: ImportWarning[] = [];
  const stats: Record<string, number> = {};
  const project = createProject({ name: input.name ?? 'Altium 导入' });
  const symbols: SymbolDef[] = [];
  const sheets: Sheet[] = [];
  for (const s of input.schematics ?? []) {
    try {
      const r = importAltiumSch(s.data, { sheetName: s.name });
      sheets.push(r.sheet);
      for (const sym of r.symbols) if (!symbols.some((x) => x.id === sym.id)) symbols.push(sym);
      warnings.push(...r.warnings.map((w) => ({ ...w, where: `${s.name}: ${w.where}` })));
      for (const [k, v] of Object.entries(r.stats)) stats[`sch.${k}`] = (stats[`sch.${k}`] ?? 0) + v;
    } catch (e) { warnings.push({ where: s.name, message: (e as Error).message }); }
  }
  registerSymbols(symbols);
  if (sheets.length) project.schematic.sheets = sheets;
  const counters: Record<string, number> = {};
  for (const sh of project.schematic.sheets) for (const c of sh.components) { const m = /^([A-Za-z#]+)(\d+)$/.exec(c.ref); if (m) counters[m[1]] = Math.max(counters[m[1]] ?? 1, Number(m[2]) + 1); }
  project.schematic.counters = counters;
  let footprints: FootprintDef[] = [];
  if (input.pcb) {
    try {
      const r = importAltiumPcb(input.pcb);
      project.board = r.board; footprints = r.footprints; warnings.push(...r.warnings);
      for (const [k, v] of Object.entries(r.stats)) stats[`pcb.${k}`] = v;
      const byRef = new Map<string, SchComponent>();
      for (const sh of project.schematic.sheets) for (const c of sh.components) if (!getSymbol(c.symbolId).power && !byRef.has(c.ref)) byRef.set(c.ref, c);
      for (const f of project.board.footprints) { const c = byRef.get(f.ref); if (c) { f.componentId = c.id; c.footprint = f.footprintId; if (!f.value && c.value) f.value = c.value; } }
      if (sheets.length) {
        const nl = buildSchematicNetlist(project.schematic);
        for (const f of project.board.footprints) {
          if (!f.componentId) continue;
          const def = footprints.find((d) => d.id === f.footprintId);
          for (const k of def?.pads.map((pd) => pd.number) ?? []) if (!f.padNets[k]) { const n = nl.pinNet.get(`${f.componentId}:${k}`); if (n) f.padNets[k] = n; }
        }
      }
    } catch (e) { warnings.push({ where: 'pcb', message: (e as Error).message }); }
  }
  // 原理图元件引用了 PCB 里没有的封装名：保留名字，留空让用户映射
  for (const sh of project.schematic.sheets) for (const c of sh.components) if (c.footprint && !footprints.some((d) => d.id === c.footprint)) { c.props = { ...c.props, altiumFootprint: c.footprint.replace(/^fp:altium:/, '') }; c.footprint = ''; }
  project.library = { symbols, footprints };
  registerSymbols(symbols); registerFootprints(footprints);
  return { project, warnings, stats };
}
