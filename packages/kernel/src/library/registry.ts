import type { SymbolDef } from '../model/schematic.js';
import type { FootprintDef } from '../model/board.js';

/** 运行时注册的额外符号 / 封装（项目内库、导入库）。 */
const symbols = new Map<string, SymbolDef>();
const footprints = new Map<string, FootprintDef>();

export function registerSymbols(defs: SymbolDef[]) { for (const d of defs) symbols.set(d.id, d); }
export function registerFootprints(defs: FootprintDef[]) { for (const d of defs) footprints.set(d.id, d); }
export function registeredSymbol(id: string) { return symbols.get(id); }
export function registeredFootprint(id: string) { return footprints.get(id); }
export function registeredSymbols(): SymbolDef[] { return [...symbols.values()]; }
export function registeredFootprints(): FootprintDef[] { return [...footprints.values()]; }
export function registerProjectLibrary(lib: { symbols: SymbolDef[]; footprints: FootprintDef[] } | undefined) {
  if (!lib) return;
  registerSymbols(lib.symbols);
  registerFootprints(lib.footprints);
}
