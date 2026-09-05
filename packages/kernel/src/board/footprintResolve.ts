/**
 * 元件 → 封装解析：项目内 / 内置封装优先；KiCad 封装名按规则映射；都没有时生成占位封装（按引脚数双排 1.27mm）。
 */
import type { SchComponent } from '../model/schematic.js';
import type { FootprintDef, PadDef } from '../model/board.js';
import { findFootprint } from '../library/footprints.js';
import { getSymbol } from '../library/symbols.js';
import { registerFootprints } from '../library/registry.js';

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

export function resolveFootprint(c: SchComponent): ResolvedFootprint {
  if (c.footprint && findFootprint(c.footprint)) return { id: c.footprint, mapped: false, placeholder: false };
  const kicadName = (c.props.kicadFootprint ?? c.footprint ?? '').split(':').pop() ?? '';
  for (const [re, id] of KICAD_MAP) if (re.test(kicadName) && findFootprint(id)) return { id, mapped: true, placeholder: false };
  const sym = getSymbol(c.symbolId);
  if (sym.defaultFootprint && findFootprint(sym.defaultFootprint)) return { id: sym.defaultFootprint, mapped: false, placeholder: false };
  const pins = sym.pins.map((p) => p.number);
  const key = `${pins.length}p_${(kicadName || sym.name).replace(/[^\w.-]+/g, '_')}`.slice(0, 60);
  const existing = findFootprint(`fp:placeholder:${key}`);
  if (existing) return { id: existing.id, mapped: false, placeholder: true };
  const def = placeholderFootprint(pins, key);
  registerFootprints([def]);
  return { id: def.id, created: def, mapped: false, placeholder: true };
}
