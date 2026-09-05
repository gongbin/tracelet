/**
 * KiCad 库文件导入：.kicad_sym（符号库，可含多个符号 / 多单元）与 .kicad_mod（单个封装）。
 * 导入结果进入项目内库（随项目保存），并注册到运行时注册表以便立即放置。
 */
import { parseSExpr, children, str, child, type SList } from './sexpr.js';
import { parseSymbolNodes, buildSymbolDef, parseFootprintNode } from './kicad.js';
import type { SymbolDef } from '../model/schematic.js';
import type { FootprintDef } from '../model/board.js';
import { registerSymbols, registerFootprints } from '../library/registry.js';
import { findEasyEdaDocs, importEasyEdaSymbolDoc, importEasyEdaFootprintDoc, looksLikeEasyEda } from './easyeda.js';

export interface LibImportResult { symbols: SymbolDef[]; footprints: FootprintDef[]; warnings: string[] }

const safe = (s: string) => s.replace(/[^\w.+-]+/g, '_');

/** .kicad_sym → 符号定义列表。多单元符号每个单元一个定义（#u1、#u2…），单单元符号不带后缀。 */
export function importKicadSymbolLib(text: string, libName = 'lib'): SymbolDef[] {
  const root = parseSExpr(text);
  if (root[0] !== 'kicad_symbol_lib') throw new Error('不是 KiCad 符号库文件（kicad_symbol_lib）');
  const raws = parseSymbolNodes(children(root, 'symbol'));
  const out: SymbolDef[] = [];
  const lib = safe(libName.replace(/\.kicad_sym$/i, ''));
  for (const raw of raws.values()) {
    const units = [...raw.units.keys()].filter((u) => u > 0);
    const unitList = units.length ? units.sort((a, b) => a - b) : [1];
    for (const unit of unitList) {
      const id = unitList.length > 1 ? `sym:kicad:${lib}:${safe(raw.name)}#u${unit}` : `sym:kicad:${lib}:${safe(raw.name)}`;
      const def = buildSymbolDef(raw, unit, id) as SymbolDef & { anchor?: unknown };
      delete def.anchor;
      if (!def.pins.length && !(def.shapes?.length)) continue;
      const fpProp = raw.props.Footprint;
      def.name = unitList.length > 1 ? `${raw.name} (${unit}/${unitList.length})` : raw.name;
      def.kind = raw.power ? '电源' : (raw.props.ki_keywords ?? '').split(/\s+/)[0] || 'KiCad';
      def.defaultFootprint = fpProp ? `fp:kicad:${fpProp.split(':').pop()}` : '';
      def.source = `kicad:${lib}:${raw.name}`;
      out.push(def);
    }
  }
  registerSymbols(out);
  return out;
}

/** .kicad_mod → 单个封装定义。 */
export function importKicadFootprintMod(text: string, fileName?: string): FootprintDef {
  const root = parseSExpr(text);
  if (root[0] !== 'footprint' && root[0] !== 'module') throw new Error('不是 KiCad 封装文件（footprint / module）');
  const r = parseFootprintNode(root as SList);
  const name = r.shortName || (fileName ?? 'footprint').replace(/\.kicad_mod$/i, '');
  const def: FootprintDef = { ...r.def, id: `fp:kicad:${name}`, name };
  registerFootprints([def]);
  return def;
}

/** 按文件名分派：.kicad_sym / .kicad_mod / 旧版 .lib 提示。返回导入的定义。 */
export function importLibraryFile(fileName: string, text: string): LibImportResult {
  const lower = fileName.toLowerCase();
  const res: LibImportResult = { symbols: [], footprints: [], warnings: [] };
  if (lower.endsWith('.kicad_sym')) res.symbols = importKicadSymbolLib(text, fileName.split('/').pop()!);
  else if (lower.endsWith('.kicad_mod')) res.footprints = [importKicadFootprintMod(text, fileName.split('/').pop()!)];
  else if (lower.endsWith('.lib') || lower.endsWith('.dcm')) res.warnings.push(`${fileName}: KiCad 5 旧版库请先用 KiCad 6+ 另存为 .kicad_sym`);
  else if (lower.endsWith('.json') && looksLikeEasyEda(text)) {
    let docs: ReturnType<typeof findEasyEdaDocs> = [];
    try { docs = findEasyEdaDocs(JSON.parse(text), fileName.replace(/\.json$/i, '')); } catch (e) { res.warnings.push(`${fileName}: ${(e as Error).message}`); }
    for (const d of docs) { const t = String(d.head.docType); if (t === '2') res.symbols.push(importEasyEdaSymbolDoc(d)); else if (t === '4') res.footprints.push(importEasyEdaFootprintDoc(d)); else res.warnings.push(`${fileName}: docType ${t} 不是符号 / 封装文档，请在首页「导入项目」里导入`); }
    if (!docs.length) res.warnings.push(`${fileName}: 没有找到 EasyEDA 文档`);
  }
  else res.warnings.push(`${fileName}: 不支持的库文件类型（支持 .kicad_sym / .kicad_mod）`);
  return res;
}

/** 供 UI 用的库文件类型说明。 */
export const LIBRARY_FILE_HINT = '支持 KiCad 6+ 的 .kicad_sym（符号库）与 .kicad_mod（封装），.pretty 目录里可多选；嘉立创 EDA 标准版的符号 / 封装 JSON（文件 → 导出 → EasyEDA 源码）。';
// 预留：确保 child 被引用（用于将来读取库级别属性）
void child;
