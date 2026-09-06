/** 零件目录：一条记录同时绑定符号、封装、供应商信息。 */
export interface Part {
  id: string;
  mpn: string;
  maker: string;
  kind: string;
  /** 分类 id，对应 assets/component-icons/manifest.json */
  category: string;
  description: string;
  symbolId: string;
  footprintId: string;
  value: string;
  params: string;
  pinCount: number;
  lcsc?: string;
  price?: string;
  stock?: '有货' | '缺货';
  datasheet?: string;
  has3d: boolean;
  keywords: string[];
  /** 来源：内置 / 社区（URL 更新）/ 我的（导入 / 录入） */
  source?: PartSource;
  /** 导入时给出的引脚（number:name），用于为没有内置符号的 IC / 连接器生成框符号 */
  pins?: { number: string; name: string }[];
}
export type PartSource = 'builtin' | 'community' | 'user';

export const PART_CATEGORIES: { id: string; name: string; group: string }[] = [
  { id: 'resistor', name: '电阻', group: '无源器件' }, { id: 'capacitor', name: '电容', group: '无源器件' }, { id: 'inductor', name: '电感', group: '无源器件' },
  { id: 'microcontroller', name: '微控制器', group: '集成电路' }, { id: 'logic', name: '逻辑器件', group: '集成电路' }, { id: 'memory', name: '存储器', group: '集成电路' }, { id: 'interface-ic', name: '接口芯片', group: '集成电路' }, { id: 'amplifier', name: '放大器', group: '集成电路' }, { id: 'data-converter', name: '数据转换', group: '集成电路' }, { id: 'clock-timing', name: '时钟', group: '集成电路' },
  { id: 'diode', name: '二极管', group: '半导体' }, { id: 'transistor', name: '晶体管', group: '半导体' },
  { id: 'power-management', name: '电源管理', group: '电源与保护' }, { id: 'circuit-protection', name: '电路保护', group: '电源与保护' }, { id: 'fuse', name: '保险丝', group: '电源与保护' }, { id: 'battery', name: '电池', group: '电源与保护' },
  { id: 'connector', name: '连接器', group: '机电与连接' }, { id: 'terminal', name: '端子', group: '机电与连接' }, { id: 'switch', name: '开关', group: '机电与连接' }, { id: 'relay', name: '继电器', group: '机电与连接' }, { id: 'mechanical', name: '机械件', group: '机电与连接' },
  { id: 'optoelectronics', name: '光电器件', group: '光电与显示' }, { id: 'display', name: '显示', group: '光电与显示' },
  { id: 'communication-module', name: '通信模块', group: '模块与开发' }, { id: 'functional-module', name: '功能模块', group: '模块与开发' }, { id: 'development-board', name: '开发板', group: '模块与开发' },
  { id: 'rf-wireless', name: '射频无线', group: '通信' }, { id: 'antenna', name: '天线', group: '通信' },
  { id: 'crystal', name: '晶振', group: '无源器件' }, { id: 'sensor', name: '传感器', group: '模块与开发' }
];

import { PARTS_BASE, icSymbol } from './partsBase.js';
import { registerSymbols, registeredSymbol } from './registry.js';
import { findSymbol } from './symbols.js';
import { footprintFromName } from './generators.js';
import { findFootprint } from './footprints.js';

/** 内置基础零件库（见 partsBase.ts）。 */
export const BUILTIN_PARTS: Part[] = PARTS_BASE.map((p) => ({ ...p, source: 'builtin' as const }));

const extra = new Map<PartSource, Part[]>();
/** 注册社区 / 用户零件（整体替换该来源），没有符号的会按 pins / 类别自动补一个符号。 */
export function registerParts(parts: Part[], source: 'community' | 'user'): void {
  extra.set(source, parts.map((p) => ensureSymbol({ ...p, source })));
}
/** 全部零件：内置 + 社区 + 我的（同 id 后者覆盖前者）。 */
export function allParts(): Part[] {
  const m = new Map<string, Part>();
  for (const p of BUILTIN_PARTS) m.set(p.id, p);
  for (const p of extra.get('community') ?? []) m.set(p.id, p);
  for (const p of extra.get('user') ?? []) m.set(p.id, p);
  return [...m.values()];
}
export function findPart(id: string): Part | undefined { return allParts().find((p) => p.id === id); }

/** 简单的关键字搜索：匹配 MPN、厂商、描述、参数、关键词。 */
export function searchParts(query: string, parts: Part[] = allParts(), category?: string): Part[] {
  if (category) parts = parts.filter((p) => p.category === category);
  const q = query.trim().toLowerCase();
  if (!q) return parts;
  const terms = q.split(/\s+/);
  return parts
    .map((p) => {
      const hay = [p.mpn, p.maker, p.description, p.params, p.kind, p.value, p.lcsc ?? '', ...p.keywords].join(' ').toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (!hay.includes(t)) return null;
        score += p.mpn.toLowerCase().startsWith(t) ? 3 : p.mpn.toLowerCase().includes(t) ? 2 : 1;
      }
      return { p, score };
    })
    .filter((x): x is { p: Part; score: number } => !!x)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.p);
}

// ---------- 导入：CSV / JSON → Part ----------
const CATEGORY_RULES: [RegExp, string][] = [
  [/stm32|esp32-?[sc]?\d|rp2040|atmega|\bmcu\b|单片机|microcontroller|nrf52|ch32v|gd32|cortex-m/i, 'microcontroller'],
  [/电阻|resistor|\bres\b/i, 'resistor'], [/电解|tantalum|钽/i, 'capacitor'], [/电容|capacitor|mlcc/i, 'capacitor'], [/磁珠|ferrite|bead/i, 'inductor'], [/电感|inductor/i, 'inductor'],
  [/\bled\b|发光/i, 'optoelectronics'], [/tvs|esd|瞬态|静电/i, 'circuit-protection'], [/保险|fuse|ptc/i, 'fuse'], [/肖特基|schottky|齐纳|zener|稳压二极管|二极管|diode/i, 'diode'],
  [/mos|mosfet|三极管|transistor|npn|pnp|bjt/i, 'transistor'], [/晶振|crystal|oscillator|谐振/i, 'crystal'], [/开关|switch|按键|button|tact/i, 'switch'],
  [/ldo|稳压器|regulator|dc-dc|dcdc|buck|boost|升压|降压|充电|charger|电源/i, 'power-management'], [/usb|uart|rs485|rs232|can|接口|interface|transceiver|收发/i, 'interface-ic'],
 [/运放|op ?amp|amplifier|比较器|comparator/i, 'amplifier'], [/adc|dac|数据转换/i, 'data-converter'], [/74hc|74lvc|逻辑|logic|shift|移位/i, 'logic'],
  [/stm32|esp32|rp2040|atmega|mcu|单片机|microcontroller|nrf52|ch32|gd32|cortex/i, 'microcontroller'], [/flash|eeprom|sram|fram|存储/i, 'memory'], [/传感|sensor|温度|湿度|气压|加速度|陀螺/i, 'sensor'], [/模块|module/i, 'communication-module'],
  [/连接器|connector|排针|header|座|jst|terminal|端子|type-c|插座/i, 'connector'], [/天线|antenna/i, 'antenna'], [/继电器|relay/i, 'relay'], [/电池|battery/i, 'battery'], [/安装孔|mounting|hole/i, 'mechanical']
];
export function inferCategory(text: string): string { for (const [re, id] of CATEGORY_RULES) if (re.test(text)) return id; return 'functional-module'; }
const SYMBOL_BY_CATEGORY: Record<string, string> = { resistor: 'sym:R', capacitor: 'sym:C', inductor: 'sym:L', optoelectronics: 'sym:LED', diode: 'sym:D', crystal: 'sym:Y', switch: 'sym:SW', fuse: 'sym:F', mechanical: 'sym:MountingHole' };
function symbolForImported(p: Part, text: string): string {
  if (p.symbolId && (findSymbol(p.symbolId) || registeredSymbol(p.symbolId))) return p.symbolId;
  if (p.pins?.length) { const id = `sym:part:${p.mpn.replace(/[^\w.-]+/g, '_')}`; if (!registeredSymbol(id)) registerSymbols([icSymbol(id, p.mpn, p.pins.map((x) => [x.number, x.name || x.number]), { prefix: prefixFor(p.category), kind: p.kind, description: p.description })]); return id; }
  if (p.category === 'capacitor' && /电解|tantalum|钽|polar/i.test(text)) return 'sym:C_POL';
  if (p.category === 'inductor' && /磁珠|ferrite|bead/i.test(text)) return 'sym:FB';
  if (p.category === 'diode') return /肖特基|schottky/i.test(text) ? 'sym:D_Schottky' : /zener|齐纳|稳压|tvs|esd/i.test(text) ? 'sym:D_Zener' : 'sym:D';
  if (p.category === 'transistor') return /pnp/i.test(text) ? 'sym:Q_PNP' : /p-?ch|p沟|pmos|p-mos/i.test(text) ? 'sym:Q_PMOS' : /mos|fet|n-?ch/i.test(text) ? 'sym:Q_NMOS' : 'sym:Q_NPN';
  if (SYMBOL_BY_CATEGORY[p.category]) return SYMBOL_BY_CATEGORY[p.category];
  const n = p.pinCount || 0;
  if (n > 0 && n <= 200) { const id = `sym:part:${p.mpn.replace(/[^\w.-]+/g, '_')}`; if (!registeredSymbol(id)) registerSymbols([icSymbol(id, p.mpn, Array.from({ length: n }, (_, i) => [String(i + 1), String(i + 1)] as [string, string]), { prefix: prefixFor(p.category), kind: p.kind, description: p.description })]); return id; }
  return '';
}
function prefixFor(category: string): string { return ({ resistor: 'R', capacitor: 'C', inductor: 'L', optoelectronics: 'D', diode: 'D', transistor: 'Q', crystal: 'Y', switch: 'SW', fuse: 'F', connector: 'J', terminal: 'J', antenna: 'ANT', mechanical: 'H', relay: 'K', battery: 'BT' } as Record<string, string>)[category] ?? 'U';
}
function footprintForImported(pkg: string, category: string): string {
  const name = pkg.trim(); if (!name) return '';
  const prefix = ({ resistor: 'R', capacitor: 'C', inductor: 'L', optoelectronics: 'LED', diode: 'D', fuse: 'F' } as Record<string, string>)[category];
  const m = /^(0201|0402|0603|0805|1206|1210|2010|2512)$/i.exec(name);
  if (m && prefix) { const g = footprintFromName(`${prefix}_${m[1]}`); if (g) return g.id; } // 裸尺寸按类别补前缀：电容 0603 → C_0603_1608Metric
  const direct = findFootprint(name) ?? findFootprint(`fp:${name}`) ?? findFootprint(`fp:gen:${name}`); if (direct) return direct.id;
  const gen = footprintFromName(name);
  return gen ? gen.id : '';
}
function ensureSymbol(p: Part): Part { const text = `${p.kind} ${p.description} ${p.params} ${p.mpn}`; const category = p.category || inferCategory(text); return { ...p, category, symbolId: symbolForImported({ ...p, category }, text) || p.symbolId }; }

const HEADERS: Record<string, RegExp> = {
  mpn: /^(mpn|型号|manufacturer part number|mfr\.? ?part|part number|partnumber|part no|料号)$/i, maker: /^(maker|manufacturer|厂商|品牌|制造商|mfr)$/i, description: /^(description|描述|desc|说明)$/i,
  category: /^(category|分类|类别|type|first category|second category|类型)$/i, package: /^(package|封装|footprint|encapsulation)$/i, value: /^(value|值|参数值)$/i,
  lcsc: /^(lcsc|lcsc part number|lcsc part|立创编号|立创料号|supplier part|c编号)$/i, price: /^(price|单价|unit price)$/i, datasheet: /^(datasheet|数据手册|规格书)$/i, pins: /^(pins|pin count|引脚数|引脚|pinout)$/i,
  symbol: /^(symbol|符号)$/i, keywords: /^(keywords|关键词|tags)$/i, params: /^(params|参数|specs)$/i, kind: /^(kind|种类)$/i
};
function csvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) { const ch = text[i]; if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; } else if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch; }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9.+-]+/g, '-').replace(/^-|-$/g, '');
/** 把一行（列名 → 值）变成零件；缺型号时返回错误。 */
export function partFromRecord(rec: Record<string, string>, index = 0): { part?: Part; error?: string } {
  const get = (key: keyof typeof HEADERS) => { for (const [k, v] of Object.entries(rec)) if (HEADERS[key].test(k.trim())) return v.trim(); return ''; };
  const mpn = get('mpn') || get('value'); if (!mpn) return { error: `第 ${index + 1} 行没有型号（mpn / 型号 / Manufacturer Part Number）` };
  const description = get('description'), pkg = get('package'), maker = get('maker') || '—';
  const catText = `${get('category')} ${description} ${mpn} ${get('kind')}`;
  const category = inferCategory(catText);
  const pinsRaw = get('pins');
  let pins: { number: string; name: string }[] | undefined; let pinCount = 0;
  if (/^\d+$/.test(pinsRaw)) pinCount = Number(pinsRaw);
  else if (pinsRaw) { pins = pinsRaw.split(/[;\n|]/).map((x) => x.trim()).filter(Boolean).map((x, i) => { const m = /^([^:=]+)[:=](.+)$/.exec(x); return m ? { number: m[1].trim(), name: m[2].trim() } : { number: String(i + 1), name: x }; }); pinCount = pins.length; }
  if (!pinCount) pinCount = ['resistor', 'capacitor', 'inductor', 'optoelectronics', 'diode', 'crystal', 'fuse'].includes(category) ? 2 : category === 'transistor' ? 3 : 0;
  const part: Part = { id: `part:${get('lcsc') ? slug(get('lcsc')) : slug(mpn) || `row-${index}`}`, mpn, maker, kind: get('kind') || (PART_CATEGORIES.find((c) => c.id === category)?.name ?? '元件'), category, description: description || mpn, symbolId: get('symbol'), footprintId: footprintForImported(pkg, category), value: get('value') || mpn, params: get('params') || [pkg, description].filter(Boolean).join(' · '), pinCount, lcsc: get('lcsc') || undefined, price: get('price') || undefined, datasheet: get('datasheet') || undefined, has3d: false, keywords: get('keywords').split(/[;,\s]+/).filter(Boolean), pins };
  return { part: ensureSymbol(part) };
}
export function parsePartsCsv(text: string): { parts: Part[]; errors: string[] } {
  const rows = csvRows(text.replace(/^\uFEFF/, '')); if (rows.length < 2) return { parts: [], errors: ['CSV 至少需要表头和一行数据'] };
  const head = rows[0].map((h) => h.trim()); const parts: Part[] = []; const errors: string[] = [];
  rows.slice(1).forEach((r, i) => { const rec: Record<string, string> = {}; head.forEach((h, j) => { rec[h] = r[j] ?? ''; }); const x = partFromRecord(rec, i + 1); if (x.part) parts.push(x.part); else if (x.error) errors.push(x.error); });
  return { parts, errors };
}
export function parsePartsJson(text: string): { parts: Part[]; errors: string[]; version?: string } {
  let raw: unknown; try { raw = JSON.parse(text); } catch { return { parts: [], errors: ['不是合法的 JSON'] }; }
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { parts?: unknown }).parts) ? (raw as { parts: unknown[] }).parts : null;
  if (!list) return { parts: [], errors: ['JSON 应为零件数组或 { version, parts: [] }'] };
  const parts: Part[] = []; const errors: string[] = [];
  list.forEach((item, i) => {
    const o = item as Partial<Part> & Record<string, string>;
    if (o && typeof o === 'object' && typeof o.mpn === 'string' && o.mpn) { const p: Part = { id: o.id || `part:${slug(o.mpn)}`, mpn: o.mpn, maker: o.maker || '—', kind: o.kind || '元件', category: o.category || inferCategory(`${o.description ?? ''} ${o.mpn}`), description: o.description || o.mpn, symbolId: o.symbolId || '', footprintId: o.footprintId || footprintForImported(String(o.package ?? ''), o.category || ''), value: o.value || o.mpn, params: o.params || '', pinCount: Number(o.pinCount) || (o.pins?.length ?? 0), lcsc: o.lcsc, price: o.price, datasheet: o.datasheet, has3d: !!o.has3d, keywords: Array.isArray(o.keywords) ? o.keywords : [], pins: o.pins }; parts.push(ensureSymbol(p)); }
    else { const x = partFromRecord(o as Record<string, string>, i); if (x.part) parts.push(x.part); else if (x.error) errors.push(x.error); }
  });
  return { parts, errors, version: typeof (raw as { version?: unknown }).version === 'string' ? (raw as { version: string }).version : undefined };
}
const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function partsToCsv(parts: Part[]): string {
  const cols = ['mpn', 'maker', 'category', 'description', 'value', 'package', 'pins', 'lcsc', 'price', 'datasheet', 'keywords'];
  const rows = parts.map((p) => [p.mpn, p.maker, p.category, p.description, p.value, p.footprintId.replace(/^fp:(gen:)?/, ''), p.pins?.length ? p.pins.map((x) => `${x.number}:${x.name}`).join(';') : String(p.pinCount || ''), p.lcsc ?? '', p.price ?? '', p.datasheet ?? '', p.keywords.join(' ')].map(esc).join(','));
  return [cols.join(','), ...rows].join('\n');
}
export function partsToJson(parts: Part[], version = new Date().toISOString().slice(0, 10)): string {
  return JSON.stringify({ version, parts: parts.map(({ source: _s, ...p }) => p) }, null, 2);
}
