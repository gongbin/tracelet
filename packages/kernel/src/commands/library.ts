/** 项目内库命令：导入的符号 / 封装随项目保存，并注册到运行时以便立即使用。 */
import type { Project } from '../model/project.js';
import type { SymbolDef } from '../model/schematic.js';
import type { FootprintDef } from '../model/board.js';
import { registerSymbols, registerFootprints } from '../library/registry.js';
import { command, type Command } from './types.js';

export function addLibraryItems(items: { symbols?: SymbolDef[]; footprints?: FootprintDef[] }): Command {
  const symbols = items.symbols ?? [], footprints = items.footprints ?? [];
  const label = `导入库：${symbols.length} 符号 · ${footprints.length} 封装`;
  return command(label, (proj: Project) => {
    registerSymbols(symbols); registerFootprints(footprints);
    const sid = new Set(symbols.map((s) => s.id)), fid = new Set(footprints.map((f) => f.id));
    return { ...proj, library: { symbols: [...proj.library.symbols.filter((s) => !sid.has(s.id)), ...symbols], footprints: [...proj.library.footprints.filter((f) => !fid.has(f.id)), ...footprints] } };
  });
}

/** 从项目库移除（仍在使用的定义留在运行时注册表，不会导致画面崩溃）。 */
export function removeLibraryItems(ids: string[]): Command {
  const set = new Set(ids);
  return command('移除库项', (proj: Project) => ({ ...proj, library: { symbols: proj.library.symbols.filter((s) => !set.has(s.id)), footprints: proj.library.footprints.filter((f) => !set.has(f.id)) } }));
}

/** 项目内库使用统计：哪些定义正在被元件 / 封装引用。 */
export function libraryUsage(proj: Project): { symbols: Map<string, string[]>; footprints: Map<string, string[]> } {
  const symbols = new Map<string, string[]>(), footprints = new Map<string, string[]>();
  for (const sh of proj.schematic.sheets) for (const c of sh.components) { symbols.set(c.symbolId, [...(symbols.get(c.symbolId) ?? []), c.ref]); if (c.footprint) footprints.set(c.footprint, [...(footprints.get(c.footprint) ?? []), c.ref]); }
  for (const f of proj.board.footprints) if (!footprints.get(f.footprintId)?.includes(f.ref)) footprints.set(f.footprintId, [...(footprints.get(f.footprintId) ?? []), f.ref]);
  return { symbols, footprints };
}
