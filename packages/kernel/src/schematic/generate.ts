/**
 * 从结构化抽取结果（AI 识别 PDF / 图片，或手工描述）生成原理图：
 * 自动建通用符号、网格布局、每个已命名引脚接一段短线 + 网络标签，靠标签实现连通性。
 */
import type { Sheet, SymbolDef, PinDef, SchComponent, Wire, NetLabel } from '../model/schematic.js';
import { DEFAULT_FRAME } from '../model/schematic.js';
import { newId } from '../ids.js';
import { registerSymbols } from '../library/registry.js';
import { getSymbol, findSymbol } from '../library/symbols.js';
import { findFootprint } from '../library/footprints.js';
import { registerFootprints } from '../library/registry.js';
import { footprintFromName } from '../library/generators.js';
import { pinGeoms, snapComponentOrigin, componentBounds } from './geometry.js';
import type { Vec } from '../geometry.js';

export interface ExtractedPin { number: string; name?: string; net?: string }
export interface ExtractedComponent { ref: string; value?: string; kind?: string; footprint?: string; description?: string; pins: ExtractedPin[] }
export interface ExtractedSchematic { title?: string; components: ExtractedComponent[]; notes?: string[] }

export interface GenerateResult { sheet: Sheet; symbols: SymbolDef[]; stats: { components: number; labeledPins: number; nets: number } }

const POWER_RE = /^(gnd|vss|agnd|dgnd|pgnd)$/i;
const RAIL_RE = /^(\+?\d+(\.\d+)?v\d*|vcc\w*|vdd\w*|vbus|vin|v_?bat\w*|\+?3v3|\+?5v|avdd|dvdd)$/i;

function kindToBuiltin(c: ExtractedComponent): string | null {
  const k = `${c.kind ?? ''} ${c.value ?? ''} ${c.ref}`.toLowerCase();
  if (c.pins.length !== 2) return null;
  if (/^r\d/i.test(c.ref) || /resistor|电阻/.test(k)) return 'sym:R';
  if (/^c\d/i.test(c.ref) || /capacitor|电容/.test(k)) return 'sym:C';
  if (/^d\d|^led\d/i.test(c.ref) && /led|发光/.test(k)) return 'sym:LED';
  return null;
}

function footprintFor(c: ExtractedComponent, builtin: string | null): string {
  const fp = (c.footprint ?? '').toLowerCase();
  const size = /0402|0603|0805/.exec(fp)?.[0];
  if (builtin === 'sym:R') return `fp:R_${size ?? '0402'}`;
  if (builtin === 'sym:C') return `fp:C_${size ?? '0402'}`;
  if (builtin === 'sym:LED') return `fp:LED_${size === '0805' ? '0805' : '0603'}`;
  const name = (c.footprint ?? '').trim();
  if (!name) return '';
  // 已知 id / 内置名 → 直接用；KiCad 风格名（LQFP-48_7x7mm_P0.5mm、PinHeader_1x04…）→ 参数化生成
  const direct = findFootprint(name) ?? findFootprint(`fp:${name}`) ?? findFootprint(`fp:gen:${name}`);
  if (direct) return direct.id;
  const gen = footprintFromName(name);
  if (gen) { if (!findFootprint(gen.id)) registerFootprints([gen]); return gen.id; }
  return '';
}

/** 为多引脚元件生成一个盒子符号：引脚前半在左、后半在右，200mil 间距，引脚端点落在 100mil 栅格。 */
function boxSymbol(c: ExtractedComponent): SymbolDef {
  const n = c.pins.length;
  const left = c.pins.slice(0, Math.ceil(n / 2)), right = c.pins.slice(Math.ceil(n / 2));
  const rows = Math.max(left.length, right.length, 1);
  const longest = Math.max(4, ...c.pins.map((p) => (p.name ?? p.number).length));
  const width = Math.max(1200, Math.ceil((longest * 2 * 70 + 400) / 200) * 200);
  const height = 200 * (rows + 1);
  const pins: PinDef[] = [];
  left.forEach((p, i) => pins.push({ number: p.number, name: p.name ?? p.number, side: 'L', offset: 200 * (i + 1), length: 200, type: pinType(p) }));
  right.forEach((p, i) => pins.push({ number: p.number, name: p.name ?? p.number, side: 'R', offset: 200 * (i + 1), length: 200, type: pinType(p) }));
  const prefix = c.ref.replace(/\d+$/, '') || 'U';
  return { id: `sym:gen:${c.ref}:${newId('s')}`, name: c.value || c.ref, kind: c.kind || '导入', prefix, width, height, graphic: 'box', pins, showPinNames: true, power: false, defaultValue: c.value ?? '', defaultFootprint: '', description: c.description ?? '', source: 'ai-extract' };
}
function pinType(p: ExtractedPin): PinDef['type'] {
  const n = (p.name ?? '').toLowerCase();
  if (/gnd|vss/.test(n) || /vcc|vdd|3v3|5v|vin|vbus/.test(n)) return 'power_in';
  if (/^(tx|out|do|sdo|miso)/.test(n)) return 'output';
  if (/^(rx|in|di|sdi|mosi|en|rst|reset)/.test(n)) return 'input';
  return 'bidirectional';
}

export function generateSchematic(spec: ExtractedSchematic, opts: { sheetName?: string; sheetId?: string } = {}): GenerateResult {
  const symbols: SymbolDef[] = [];
  const components: SchComponent[] = [];
  const wires: Wire[] = [];
  const labels: NetLabel[] = [];
  const usedRefs = new Set<string>();
  const comps = spec.components.filter((c) => c.ref && c.pins?.length);
  // 布局：按元件宽度自适应换行，行内 800mil 间距
  const COLS_WIDTH = 12000;
  let x = 800, y = 800, rowH = 0;
  let labeledPins = 0;
  const nets = new Set<string>();
  for (const c of comps) {
    let ref = c.ref; let k = 2; while (usedRefs.has(ref)) ref = `${c.ref}_${k++}`; usedRefs.add(ref);
    const builtin = kindToBuiltin(c);
    let sym: SymbolDef;
    if (builtin && findSymbol(builtin)) sym = getSymbol(builtin);
    else { sym = boxSymbol({ ...c, ref }); symbols.push(sym); registerSymbols([sym]); }
    const w = sym.width + 1400, h = sym.height + 1000;
    if (x + w > COLS_WIDTH && x > 800) { x = 800; y += rowH + 600; rowH = 0; }
    const origin = snapComponentOrigin(sym, { x: x + w / 2, y: y + h / 2 });
    const comp: SchComponent = { id: newId('c'), ref, symbolId: sym.id, value: c.value ?? sym.defaultValue, footprint: footprintFor(c, builtin), x: origin.x, y: origin.y, rotation: 0, mirror: false, props: c.footprint ? { sourceFootprint: c.footprint } : {} };
    components.push(comp);
    const geoms = pinGeoms(comp, sym);
    for (const p of c.pins) {
      if (!p.net) continue;
      const g = geoms.find((gg) => gg.def.number === p.number) ?? geoms.find((gg) => gg.def.name === p.name);
      if (!g) continue;
      const dir: Vec = { x: Math.sign(g.end.x - g.base.x), y: Math.sign(g.end.y - g.base.y) };
      const tip = { x: g.end.x + dir.x * 200, y: g.end.y + dir.y * 200 };
      wires.push({ id: newId('w'), points: [g.end, tip] });
      const net = normalizeNet(p.net);
      if (net === 'GND') {
        // 地符号：引脚端点在符号中心上方 300mil
        components.push({ id: newId('c'), ref: `#GND${components.length + 1}`, symbolId: 'sym:GND', value: 'GND', footprint: '', x: tip.x - 150, y: tip.y + 300 - 100, rotation: 0, mirror: false, props: {} });
      } else if (RAIL_RE.test(net) || /^\+/.test(net)) {
        // 电源符号：引脚端点在符号中心下方 300mil
        components.push({ id: newId('c'), ref: `#PWR${components.length + 1}`, symbolId: 'sym:PWR', value: net, footprint: '', x: tip.x - 200, y: tip.y - 300 - 100, rotation: 0, mirror: false, props: {} });
      } else labels.push({ id: newId('l'), text: net, x: tip.x, y: tip.y });
      nets.add(net); labeledPins++;
    }
    const b = componentBounds(comp, sym);
    x += w; rowH = Math.max(rowH, b.h + 600);
  }
  const sheet: Sheet = { id: opts.sheetId ?? newId('sheet'), name: opts.sheetName ?? spec.title ?? 'AI 识别', frame: { ...DEFAULT_FRAME, title: spec.title ?? '' }, components, wires, labels, junctions: [], buses: [], graphics: (spec.notes ?? []).slice(0, 5).map((t, i) => ({ id: newId('g'), kind: 'text' as const, x: 800, y: 400 + i * 0, text: t, size: 100 })).slice(0, 1) };
  return { sheet, symbols, stats: { components: components.length, labeledPins, nets: nets.size } };
}

/** 网络名规范化：GND 家族统一为 GND，电源轨保留原名（去空格、大写）。 */
export function normalizeNet(n: string): string {
  const t = n.trim().replace(/\s+/g, '');
  if (POWER_RE.test(t)) return 'GND';
  if (RAIL_RE.test(t)) return t.toUpperCase().replace(/^3V3$/, '+3V3').replace(/^5V$/, '+5V');
  return t;
}
