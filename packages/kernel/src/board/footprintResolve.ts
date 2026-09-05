/**
 * 元件 → 封装解析：项目内 / 内置封装优先；KiCad 封装名按规则映射；都没有时生成占位封装（按引脚数双排 1.27mm）。
 */
import type { SchComponent } from '../model/schematic.js';
import type { FootprintDef, PadDef } from '../model/board.js';
import { findFootprint } from '../library/footprints.js';
import { getSymbol } from '../library/symbols.js';
import { registerFootprints } from '../library/registry.js';
import { footprintFromName, generateFootprint } from '../library/generators.js';

const KICAD_MAP: [RegExp, string][] = [
  [/^R_0402/i, 'fp:R_0402'], [/^R_0603/i, 'fp:R_0603'], [/^R_0805/i, 'fp:R_0805'],
  [/^C_0402/i, 'fp:C_0402'], [/^C_0603/i, 'fp:C_0603'], [/^C_0805/i, 'fp:C_0805'],
  [/^LED_0603/i, 'fp:LED_0603'], [/^LED_0805/i, 'fp:LED_0805'],
  [/^SOT-223/i, 'fp:SOT-223'], [/MountingHole_3\.2mm/i, 'fp:MountingHole_3.2mm'], [/MountingHole_2\.2mm/i, 'fp:MountingHole_2.2mm'],
  [/ESP32-WROOM-32/i, 'fp:ESP32-WROOM-32E'], [/ESP32-C3-MINI/i, 'fp:ESP32-C3-MINI-1'], [/USB_C_Receptacle|USB-C/i, 'fp:USB-C-16P']
];

export interface ResolvedFootprint { id: string; created?: FootprintDef; mapped: boolean; placeholder: boolean }

export function placeholderFootprint(pinNumbers: string[], name: string): FootprintDef {
  const n = Math.max(1, pinNumbers.length);
  const pitch = 1.27, pads: PadDef[] = [];
  if (n <= 2) {
    pinNumbers.forEach((num, i) => pads.push({ number: num, x: (i - (n - 1) / 2) * 2.0, y: 0, w: 1.2, h: 1.5, shape: 'rect', drill: 0, npth: false }));
    return { id: `fp:placeholder:${name}`, name: `占位_${name}`, body: { w: n * 2 + 1, h: 2.5 }, pads, height: 1, description: '占位封装（请替换）' };
  }
  const half = Math.ceil(n / 2), span = 7.62;
  pinNumbers.forEach((num, i) => { const col = i < half ? 0 : 1; const row = col === 0 ? i : i - half; const y = (row - (half - 1) / 2) * pitch; pads.push({ number: num, x: col === 0 ? -span / 2 : span / 2, y, w: 1.6, h: 0.8, shape: 'rect', drill: 0, npth: false }); });
  return { id: `fp:placeholder:${name}`, name: `占位_${name}`, body: { w: span - 2, h: half * pitch + 1 }, pads, height: 1.5, description: '占位封装（按引脚数生成，请替换）' };
}

/** 2.54mm 排针 / 排母：PinHeader_1x04_P2.54mm_Vertical 等直接生成真实封装（委托参数化生成器）。 */
export function pinHeaderFootprint(rows: number, cols: number, pitch = 2.54): FootprintDef {
  return generateFootprint({ kind: 'header', rows: rows === 2 ? 2 : 1, cols, pitch });
}

export function resolveFootprint(c: SchComponent): ResolvedFootprint {
  if (c.footprint && findFootprint(c.footprint)) return { id: c.footprint, mapped: false, placeholder: false };
  const kicadName = (c.props.kicadFootprint ?? c.footprint ?? '').split(':').pop() ?? '';
  for (const [re, id] of KICAD_MAP) if (re.test(kicadName) && findFootprint(id)) return { id, mapped: true, placeholder: false };
  const ph = /^Pin(?:Header|Socket)_(\d)x(\d{1,2})_P(2\.54|2\.00|1\.27)mm/i.exec(kicadName);
  if (ph) {
    const def = pinHeaderFootprint(Number(ph[1]), Number(ph[2]), Number(ph[3]));
    const existing = findFootprint(def.id);
    if (!existing) registerFootprints([def]);
    return { id: def.id, created: existing ?? def, mapped: true, placeholder: false };
  }
  // KiCad 风格命名的常见封装（0603 / SOIC / LQFP / QFN / DIP / SOT-23…）按参数直接生成真实几何
  const gen = kicadName ? footprintFromName(kicadName) : undefined;
  if (gen) { const existing = findFootprint(gen.id); if (!existing) registerFootprints([gen]); return { id: gen.id, created: existing ?? gen, mapped: true, placeholder: false }; }
  const sym = getSymbol(c.symbolId);
  if (sym.defaultFootprint && findFootprint(sym.defaultFootprint)) return { id: sym.defaultFootprint, mapped: false, placeholder: false };
  const genDefault = sym.defaultFootprint ? footprintFromName(sym.defaultFootprint) : undefined;
  if (genDefault) { const existing = findFootprint(genDefault.id); if (!existing) registerFootprints([genDefault]); return { id: genDefault.id, created: existing ?? genDefault, mapped: true, placeholder: false }; }
  const pins = sym.pins.map((p) => p.number);
  const key = `${pins.length}p_${(kicadName || sym.name).replace(/[^\w.-]+/g, '_')}`.slice(0, 60);
  const existing = findFootprint(`fp:placeholder:${key}`);
  if (existing) return { id: existing.id, created: existing, mapped: false, placeholder: true };
  const def = placeholderFootprint(pins, key);
  registerFootprints([def]);
  return { id: def.id, created: def, mapped: false, placeholder: true };
}

/** 板上封装引用的定义缺失时（旧文件 / 注册表为空）按焊盘网络表生成占位，避免整个界面崩溃。 */
export function ensureFootprintDef(fp: { footprintId: string; padNets: Record<string, string>; ref: string }): FootprintDef {
  const existing = findFootprint(fp.footprintId);
  if (existing) return existing;
  const numbers = Object.keys(fp.padNets);
  const def = { ...placeholderFootprint(numbers.length ? numbers : ['1', '2'], fp.footprintId.replace(/^fp:(placeholder:)?/, '')), id: fp.footprintId, description: '缺失的封装定义，已按焊盘生成占位（请替换）' };
  registerFootprints([def]);
  return def;
}
