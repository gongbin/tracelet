/**
 * 参数化封装生成：贴片两端（0201…2512）、SOIC/TSSOP 双列翼形、QFP 四边、QFN（可带散热焊盘）、DIP、排针、SOT-23 系列。
 * 命名遵循 KiCad 风格，便于与 KiCad 导入、3D 模型目录对齐；id 前缀 fp:gen:。
 */
import type { FootprintDef, PadDef } from '../model/board.js';
import { findFootprint } from './footprints.js';
import { registerFootprints } from './registry.js';

export type FootprintSpec =
  | { kind: 'chip'; size: ChipSize; prefix?: 'R' | 'C' | 'L' | 'LED' | 'D' | 'F' }
  | { kind: 'soic'; pins: number; pitch?: number; span?: number; bodyW?: number; bodyL?: number; padW?: number; padL?: number; name?: string }
  | { kind: 'qfp'; pins: number; pitch?: number; body?: number; span?: number; padW?: number; padL?: number; name?: string }
  | { kind: 'qfn'; pins: number; pitch?: number; body?: number; padW?: number; padL?: number; thermal?: number; name?: string }
  | { kind: 'dip'; pins: number; pitch?: number; span?: number; drill?: number; name?: string }
  | { kind: 'header'; rows: 1 | 2; cols: number; pitch?: number; socket?: boolean }
  | { kind: 'sot23'; pins: 3 | 5 | 6 };

export type ChipSize = '0201' | '0402' | '0603' | '0805' | '1206' | '1210' | '2010' | '2512';
/** 英制代号 → 公制代号 / 本体 / 焊盘（宽 × 高）/ 焊盘中心距（KiCad 手焊友好尺寸的近似）。 */
export const CHIP_SIZES: Record<ChipSize, { metric: string; body: [number, number]; pad: [number, number]; pitch: number; height: number }> = {
  '0201': { metric: '0603Metric', body: [0.6, 0.3], pad: [0.46, 0.4], pitch: 0.66, height: 0.3 },
  '0402': { metric: '1005Metric', body: [1.0, 0.5], pad: [0.54, 0.64], pitch: 1.02, height: 0.4 },
  '0603': { metric: '1608Metric', body: [1.6, 0.8], pad: [0.9, 0.95], pitch: 1.65, height: 0.5 },
  '0805': { metric: '2012Metric', body: [2.0, 1.25], pad: [1.15, 1.4], pitch: 1.9, height: 0.6 },
  '1206': { metric: '3216Metric', body: [3.2, 1.6], pad: [1.15, 1.8], pitch: 2.95, height: 0.7 },
  '1210': { metric: '3225Metric', body: [3.2, 2.5], pad: [1.15, 2.7], pitch: 2.95, height: 1.0 },
  '2010': { metric: '5025Metric', body: [5.0, 2.5], pad: [1.15, 2.7], pitch: 4.7, height: 0.7 },
  '2512': { metric: '6332Metric', body: [6.3, 3.2], pad: [1.7, 3.5], pitch: 5.95, height: 0.7 }
};

const r2 = (v: number) => Math.round(v * 1000) / 1000;
const pad = (number: string, x: number, y: number, w: number, h: number, extra: Partial<PadDef> = {}): PadDef => ({ number, x: r2(x), y: r2(y), w: r2(w), h: r2(h), shape: 'roundrect', drill: 0, npth: false, ...extra });

function chip(size: ChipSize, prefix = 'R'): FootprintDef {
  const s = CHIP_SIZES[size];
  const name = `${prefix}_${size}_${s.metric}`;
  return { id: `fp:gen:${name}`, name, body: { w: s.body[0], h: s.body[1] }, height: s.height, description: `${prefix} ${size} 贴片（${s.metric}）`, pads: [pad('1', -s.pitch / 2, 0, s.pad[0], s.pad[1]), pad('2', s.pitch / 2, 0, s.pad[0], s.pad[1])] };
}

/** 双列翼形：pin 1 左上，逆时针编号（左列自上而下，右列自下而上）。 */
function soic(o: Extract<FootprintSpec, { kind: 'soic' }>): FootprintDef {
  const n = o.pins, pitch = o.pitch ?? 1.27, half = n / 2;
  const bodyW = o.bodyW ?? (pitch >= 1.27 ? 3.9 : 4.4), bodyL = o.bodyL ?? r2((half - 1) * pitch + (pitch >= 1.27 ? 2.4 : 1.7));
  const padL = o.padL ?? (pitch >= 1.27 ? 1.95 : 1.45), padW = o.padW ?? r2(Math.min(0.6, pitch * 0.55));
  const span = o.span ?? r2(bodyW + padL - 0.9);
  const pads: PadDef[] = [];
  for (let i = 0; i < half; i++) { const y = (i - (half - 1) / 2) * pitch; pads.push(pad(String(i + 1), -span / 2, y, padL, padW, i === 0 ? { shape: 'rect' } : {})); }
  for (let i = 0; i < half; i++) { const y = ((half - 1) / 2 - i) * pitch; pads.push(pad(String(half + i + 1), span / 2, y, padL, padW)); }
  const family = pitch >= 1.27 ? 'SOIC' : pitch >= 0.65 ? 'TSSOP' : 'SSOP';
  const name = o.name ?? `${family}-${n}_${bodyW}x${bodyL}mm_P${pitch}mm`;
  return { id: `fp:gen:${name}`, name, body: { w: r2(span + padL + 0.4), h: r2(bodyL + 0.4) }, height: pitch >= 1.27 ? 1.75 : 1.2, description: `${family}-${n} 间距 ${pitch}mm`, pads };
}

/** 四边翼形：pin 1 左边最上，逆时针：左（上→下）、下（左→右）、右（下→上）、上（右→左）。 */
function quad(n: number, pitch: number, x: number, padL: number, padW: number, thermal?: number): PadDef[] {
  const per = n / 4, pads: PadDef[] = [];
  const pos = (i: number) => (i - (per - 1) / 2) * pitch;
  for (let i = 0; i < per; i++) pads.push(pad(String(i + 1), -x, pos(i), padL, padW, i === 0 ? { shape: 'rect' } : {}));
  for (let i = 0; i < per; i++) pads.push(pad(String(per + i + 1), pos(i), x, padW, padL));
  for (let i = 0; i < per; i++) pads.push(pad(String(2 * per + i + 1), x, -pos(i), padL, padW));
  for (let i = 0; i < per; i++) pads.push(pad(String(3 * per + i + 1), -pos(i), -x, padW, padL));
  if (thermal) pads.push(pad(String(n + 1), 0, 0, thermal, thermal, { shape: 'rect' }));
  return pads;
}
function qfp(o: Extract<FootprintSpec, { kind: 'qfp' }>): FootprintDef {
  const n = o.pins, pitch = o.pitch ?? 0.5, body = o.body ?? r2(((n / 4 - 1) * pitch + 1.0) / 0.86);
  const padL = o.padL ?? 1.5, padW = o.padW ?? r2(Math.min(0.3, pitch * 0.6)), span = o.span ?? r2(body + 1.5);
  const name = o.name ?? `LQFP-${n}_${body}x${body}mm_P${pitch}mm`;
  return { id: `fp:gen:${name}`, name, body: { w: r2(span + padL + 0.3), h: r2(span + padL + 0.3) }, height: 1.6, description: `LQFP-${n} ${body}×${body}mm 间距 ${pitch}mm`, pads: quad(n, pitch, span / 2, padL, padW) };
}
function qfn(o: Extract<FootprintSpec, { kind: 'qfn' }>): FootprintDef {
  const n = o.pins, pitch = o.pitch ?? 0.5, body = o.body ?? r2((n / 4 - 1) * pitch + 1.6);
  const padL = o.padL ?? 0.85, padW = o.padW ?? r2(Math.min(0.3, pitch * 0.55)), x = r2(body / 2 - padL / 2 + 0.2);
  const thermal = o.thermal ?? r2(body - 1.4);
  const name = o.name ?? `QFN-${n}-1EP_${body}x${body}mm_P${pitch}mm_EP${thermal}x${thermal}mm`;
  return { id: `fp:gen:${name}`, name, body: { w: r2(body + 0.5), h: r2(body + 0.5) }, height: 0.9, description: `QFN-${n} ${body}×${body}mm 带散热焊盘`, pads: quad(n, pitch, x, padL, padW, thermal) };
}
function dip(o: Extract<FootprintSpec, { kind: 'dip' }>): FootprintDef {
  const n = o.pins, pitch = o.pitch ?? 2.54, span = o.span ?? 7.62, drill = o.drill ?? 0.8, half = n / 2, d = r2(drill + 0.8);
  const pads: PadDef[] = [];
  for (let i = 0; i < half; i++) pads.push(pad(String(i + 1), -span / 2, (i - (half - 1) / 2) * pitch, d, d, { shape: i === 0 ? 'rect' : 'oval', drill }));
  for (let i = 0; i < half; i++) pads.push(pad(String(half + i + 1), span / 2, ((half - 1) / 2 - i) * pitch, d, d, { shape: 'oval', drill }));
  const name = o.name ?? `DIP-${n}_W${span}mm`;
  return { id: `fp:gen:${name}`, name, body: { w: r2(span - 1.3), h: r2(half * pitch + 0.6) }, height: 4, description: `DIP-${n} 列距 ${span}mm`, pads };
}
/** 排针 / 排母：以焊盘阵列中心为原点（便于旋转与本体计算），pin 1 在左上，列沿 +y，行沿 +x。 */
function header(o: Extract<FootprintSpec, { kind: 'header' }>): FootprintDef {
  const pitch = o.pitch ?? 2.54, d = pitch >= 2.54 ? 1.7 : pitch >= 2 ? 1.35 : 1.0, drill = pitch >= 2.54 ? 1.0 : pitch >= 2 ? 0.8 : 0.65;
  const pads: PadDef[] = []; let k = 1;
  const x0 = -((o.rows - 1) * pitch) / 2, y0 = -((o.cols - 1) * pitch) / 2;
  for (let c = 0; c < o.cols; c++) for (let r = 0; r < o.rows; r++) pads.push(pad(String(k++), x0 + r * pitch, y0 + c * pitch, d, d, { shape: k === 2 ? 'rect' : 'oval', drill }));
  const name = `Pin${o.socket ? 'Socket' : 'Header'}_${o.rows}x${String(o.cols).padStart(2, '0')}_P${pitch}mm_Vertical`;
  return { id: `fp:gen:${name}`, name, body: { w: r2(o.rows * pitch), h: r2(o.cols * pitch) }, height: o.socket ? 8.5 : 6, description: `${o.rows}×${o.cols} ${o.socket ? '排母' : '排针'} ${pitch}mm`, pads };
}
function sot23(pins: 3 | 5 | 6): FootprintDef {
  if (pins === 3) return { id: 'fp:gen:SOT-23', name: 'SOT-23', body: { w: 3.0, h: 1.4 }, height: 1.1, description: 'SOT-23 三脚', pads: [pad('1', -0.95, 1.0, 0.9, 0.8), pad('2', 0.95, 1.0, 0.9, 0.8), pad('3', 0, -1.0, 0.9, 0.8)] };
  const pads: PadDef[] = [];
  const left = pins === 5 ? 3 : 3, right = pins === 5 ? 2 : 3;
  for (let i = 0; i < left; i++) pads.push(pad(String(i + 1), -1.1, (i - 1) * 0.95, 1.06, 0.65, i === 0 ? { shape: 'rect' } : {}));
  if (pins === 5) { pads.push(pad('4', 1.1, 0.95, 1.06, 0.65)); pads.push(pad('5', 1.1, -0.95, 1.06, 0.65)); }
  else for (let i = 0; i < right; i++) pads.push(pad(String(4 + i), 1.1, (1 - i) * 0.95, 1.06, 0.65));
  const name = `SOT-23-${pins}`;
  return { id: `fp:gen:${name}`, name, body: { w: 3.2, h: 3.2 }, height: 1.1, description: `${name}`, pads };
}

export function generateFootprint(spec: FootprintSpec): FootprintDef {
  switch (spec.kind) {
    case 'chip': return chip(spec.size, spec.prefix ?? 'R');
    case 'soic': return soic(spec);
    case 'qfp': return qfp(spec);
    case 'qfn': return qfn(spec);
    case 'dip': return dip(spec);
    case 'header': return header(spec);
    case 'sot23': return sot23(spec.pins);
  }
}

/** 校验参数（引脚数奇偶 / 四的倍数等），返回错误信息或 null。 */
export function validateSpec(spec: FootprintSpec): string | null {
  const even = (n: number) => n >= 2 && n % 2 === 0;
  if (spec.kind === 'soic' || spec.kind === 'dip') return even(spec.pins) && spec.pins <= 64 ? null : '引脚数需为 2～64 的偶数';
  if (spec.kind === 'qfp' || spec.kind === 'qfn') return spec.pins >= 8 && spec.pins % 4 === 0 && spec.pins <= 256 ? null : '引脚数需为 4 的倍数（8～256）';
  if (spec.kind === 'header') return spec.cols >= 1 && spec.cols <= 40 ? null : '排数需为 1～40';
  return null;
}

/**
 * 按 KiCad 风格封装名生成：R_0603_1608Metric、SOIC-8_3.9x4.9mm_P1.27mm、TSSOP-20_4.4x6.5mm_P0.65mm、
 * LQFP-48_7x7mm_P0.5mm、QFN-32-1EP_5x5mm_P0.5mm_EP3.45x3.45mm、DIP-8_W7.62mm、PinHeader_1x04_P2.54mm_Vertical、SOT-23-5。
 * 认不出返回 undefined。
 */
export function footprintFromName(rawName: string): FootprintDef | undefined {
  const name = rawName.split(':').pop() ?? rawName;
  let m: RegExpExecArray | null;
  if ((m = /^(R|C|L|LED|D|F|Fuse)_(0201|0402|0603|0805|1206|1210|2010|2512)(?:_|$)/i.exec(name))) { const p = m[1].toUpperCase() === 'FUSE' ? 'F' : (m[1].toUpperCase() as 'R'); return { ...chip(m[2] as ChipSize, p), name }; }
  if ((m = /^(SOIC|SOP|TSSOP|SSOP|MSOP|SO)-(\d+)(?:-1EP)?_([\d.]+)x([\d.]+)mm_P([\d.]+)mm/i.exec(name))) return { ...soic({ kind: 'soic', pins: Number(m[2]), bodyW: Number(m[3]), bodyL: Number(m[4]), pitch: Number(m[5]) }), name, id: `fp:gen:${name}` };
  if ((m = /^(SOIC|SOP|TSSOP)-(\d+)(?:_|$)/i.exec(name))) return { ...soic({ kind: 'soic', pins: Number(m[2]), pitch: /^SOIC|^SOP/i.test(m[1]) ? 1.27 : 0.65 }), name, id: `fp:gen:${name}` };
  if ((m = /^(LQFP|TQFP|QFP)-(\d+)_([\d.]+)x([\d.]+)mm_P([\d.]+)mm/i.exec(name))) return { ...qfp({ kind: 'qfp', pins: Number(m[2]), body: Number(m[3]), pitch: Number(m[5]) }), name, id: `fp:gen:${name}` };
  if ((m = /^(QFN|DFN|VQFN|WQFN|UQFN)-(\d+)(?:-1EP)?_([\d.]+)x([\d.]+)mm_P([\d.]+)mm(?:_EP([\d.]+)x([\d.]+)mm)?/i.exec(name))) return { ...qfn({ kind: 'qfn', pins: Number(m[2]), body: Number(m[3]), pitch: Number(m[5]), thermal: m[6] ? Number(m[6]) : undefined }), name, id: `fp:gen:${name}` };
  if ((m = /^DIP-(\d+)_W([\d.]+)mm/i.exec(name))) return { ...dip({ kind: 'dip', pins: Number(m[1]), span: Number(m[2]) }), name, id: `fp:gen:${name}` };
  if ((m = /^Pin(Header|Socket)_(\d)x(\d{1,2})_P([\d.]+)mm/i.exec(name))) return header({ kind: 'header', rows: Number(m[2]) as 1 | 2, cols: Number(m[3]), pitch: Number(m[4]), socket: m[1].toLowerCase() === 'socket' });
  if ((m = /^SOT-23-?(5|6)?(?:_|$)/i.exec(name)) || /^SOT-23$/i.test(name)) { const n = m?.[1] ? (Number(m[1]) as 5 | 6) : 3; return { ...sot23(n), name: n === 3 ? 'SOT-23' : `SOT-23-${n}`, id: `fp:gen:SOT-23${n === 3 ? '' : '-' + n}` }; }
  if (/^TSOT-23-6|^SOT-23-6/i.test(name)) return { ...sot23(6), name, id: `fp:gen:${name}` };
  return undefined;
}

/** 生成并注册（已存在同 id 时直接返回已注册定义）。 */
export function ensureGenerated(spec: FootprintSpec): FootprintDef {
  const def = generateFootprint(spec);
  const existing = findFootprint(def.id);
  if (existing) return existing;
  registerFootprints([def]);
  return def;
}
