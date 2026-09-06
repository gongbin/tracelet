/**
 * 参数化封装生成：贴片两端（0201…2512）、SOIC/TSSOP 双列翼形、QFP 四边、QFN（可带散热焊盘）、DIP、排针、SOT-23 系列。
 * 命名遵循 KiCad 风格，便于与 KiCad 导入、3D 模型目录对齐；id 前缀 fp:gen:。
 */
import type { FootprintDef, PadDef } from '../model/board.js';
import { findFootprint, setFootprintResolver } from './footprints.js';
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
  // ---- 更多常见封装（近似尺寸，可手焊）----
  if ((m = /^(0201|0402|0603|0805|1206|1210|2010|2512)$/i.exec(name))) return { ...chip(m[1] as ChipSize, 'R'), name: `R_${m[1]}_${CHIP_SIZES[m[1] as ChipSize].metric}` };
  if ((m = /^(SOD-?123|SOD-?323|SOD-?523|SOD-?80|SMA|SMB|SMC|DO-214AC|DO-214AA|DO-214AB|SOD-?123F|SOD-?123FL)$/i.exec(name))) return twoPad(name, DIODE_PKGS[m[1].toUpperCase().replace(/-/g, '')] ?? DIODE_PKGS.SOD123);
  if (/^SOT-?89(-3)?$/i.test(name)) return sot89(name);
  if (/^SOT-?223(-3)?$/i.test(name)) return sot223(name);
  if (/^TO-?92$/i.test(name)) return to92(name);
  if (/^TO-?252|^DPAK/i.test(name)) return dpak(name, 6.5, 6.1, 4.57, 1.1, 2.5, 5.6);
  if (/^TO-?263|^D2PAK/i.test(name)) return dpak(name, 10.0, 9.0, 5.08, 1.6, 3.6, 8.7);
  if ((m = /^DIP-?(\d+)$/i.exec(name))) { const n = Number(m[1]); return { ...dip({ kind: 'dip', pins: n, span: n >= 24 ? 15.24 : 7.62 }), name, id: `fp:gen:${name}` }; }
  if ((m = /^(SOIC|SOP|SO)-?(\d+)(?:-EP|-1EP|-PP)?$/i.exec(name)) && /EP|PP/i.test(name)) { const n = Number(m[2]); const base = soic({ kind: 'soic', pins: n, pitch: 1.27 }); return { ...base, name, id: `fp:gen:${name}`, pads: [...base.pads, pad('EP', 0, 0, 2.3, 3.2)] }; }
  if ((m = /^E?SOP-?(\d+)$/i.exec(name))) { const n = Number(m[1]); const base = soic({ kind: 'soic', pins: n, pitch: 1.27 }); return { ...base, name, id: `fp:gen:${name}`, pads: /^E/i.test(name) ? [...base.pads, pad('EP', 0, 0, 2.3, 3.2)] : base.pads }; }
  if ((m = /^MSOP-?(\d+)$/i.exec(name))) return { ...soic({ kind: 'soic', pins: Number(m[1]), pitch: Number(m[1]) === 8 ? 0.65 : 0.5, bodyW: 3.0 }), name, id: `fp:gen:${name}` };
  if ((m = /^(LQFP|TQFP|QFP)-?(\d+)$/i.exec(name))) { const n = Number(m[2]); const spec = QFP_DEFAULT[n]; if (spec) return { ...qfp({ kind: 'qfp', pins: n, body: spec[0], pitch: spec[1] }), name, id: `fp:gen:${name}` }; }
  if ((m = /^(QFN|DFN|VQFN|WQFN|UQFN|UDFN|WSON|SON)-?(\d+)$/i.exec(name))) { const n = Number(m[2]); const spec = QFN_DEFAULT[n]; if (spec) return { ...qfn({ kind: 'qfn', pins: n, body: spec[0], pitch: spec[1], thermal: spec[2] }), name, id: `fp:gen:${name}` }; }
  if ((m = /^(SOT-?363|SC-?70-?6|SOT-?23-?6L)$/i.exec(name))) return { ...sot23(6), name, id: `fp:gen:${name}`, body: { w: 2.2, h: 2.4 }, pads: sot23(6).pads.map((q) => ({ ...q, x: r2(q.x * 0.65 / 0.95), y: r2(q.y * 0.9), w: r2(q.w * 0.6), h: r2(q.h * 0.75) })) };
  if ((m = /^(?:Crystal_SMD_)?(3225|2520|2016|1612)(?:-4Pin.*)?$/i.exec(name))) return xtal4(name, m[1]);
  if ((m = /^(?:Crystal_SMD_)?(5032|7050|3215|2012)(?:-2Pin.*)?$/i.exec(name))) return xtal2(name, m[1]);
  if (/^SW_SMD_3x4|^SW_SMD_6x6|^SW_Push|^TS-?1187/i.test(name)) return tact(name, /6x6/i.test(name) ? 6 : 3);
  if ((m = /^JST_?(PH|XH|ZH|SH)_?[BS]?(\d+)B?/i.exec(name))) { const pitch = { PH: 2.0, XH: 2.5, ZH: 1.5, SH: 1.0 }[m[1].toUpperCase()] ?? 2.0; const n = Number(m[2]); const base = header({ kind: 'header', rows: 1, cols: n, pitch }); return { ...base, name, id: `fp:gen:${name}`, description: `JST ${m[1].toUpperCase()} ${n}P（${pitch}mm）` }; }
  if ((m = /^SMD-?(0402|0603|0805|1206|1210)$/i.exec(name))) return { ...chip(m[1] as ChipSize, 'L'), name: `L_${m[1]}_${CHIP_SIZES[m[1] as ChipSize].metric}` };
  if ((m = /^CP_Elec_([\d.]+)x([\d.]+)$/i.exec(name))) return capElec(name, Number(m[1]));
  return undefined;
}

// ---------- 附加封装族 ----------
const DIODE_PKGS: Record<string, { body: [number, number]; pad: [number, number]; pitch: number; h: number }> = {
  SOD123: { body: [2.7, 1.6], pad: [1.0, 1.2], pitch: 3.4, h: 1.2 }, SOD123F: { body: [2.7, 1.6], pad: [1.2, 1.4], pitch: 3.2, h: 1.0 }, SOD123FL: { body: [2.7, 1.6], pad: [1.2, 1.4], pitch: 3.2, h: 1.0 },
  SOD323: { body: [1.7, 1.25], pad: [0.6, 0.7], pitch: 2.4, h: 1.0 }, SOD523: { body: [1.2, 0.8], pad: [0.5, 0.6], pitch: 1.6, h: 0.7 }, SOD80: { body: [3.5, 1.5], pad: [1.5, 1.6], pitch: 4.2, h: 1.6 },
  SMA: { body: [4.3, 2.6], pad: [2.5, 1.8], pitch: 4.4, h: 2.3 }, DO214AC: { body: [4.3, 2.6], pad: [2.5, 1.8], pitch: 4.4, h: 2.3 },
  SMB: { body: [4.3, 3.6], pad: [2.5, 2.3], pitch: 4.8, h: 2.4 }, DO214AA: { body: [4.3, 3.6], pad: [2.5, 2.3], pitch: 4.8, h: 2.4 },
  SMC: { body: [6.9, 6.0], pad: [3.0, 3.5], pitch: 7.6, h: 2.5 }, DO214AB: { body: [6.9, 6.0], pad: [3.0, 3.5], pitch: 7.6, h: 2.5 }
};
function twoPad(name: string, d: { body: [number, number]; pad: [number, number]; pitch: number; h: number }): FootprintDef {
  return { id: `fp:gen:${name}`, name, body: { w: d.body[0], h: d.body[1] }, height: d.h, description: `${name} 两端贴片（1 阴极 K）`, pads: [pad('1', -d.pitch / 2, 0, d.pad[0], d.pad[1], { shape: 'rect' }), pad('2', d.pitch / 2, 0, d.pad[0], d.pad[1])] };
}
function sot89(name: string): FootprintDef {
  return { id: `fp:gen:${name}`, name, body: { w: 4.6, h: 4.2 }, height: 1.6, description: 'SOT-89（3 脚，2 脚为散热片）', pads: [pad('1', -1.5, 1.5, 1.0, 1.6, { shape: 'rect' }), pad('2', 0, 0.55, 1.7, 3.5), pad('3', 1.5, 1.5, 1.0, 1.6)] };
}
function sot223(name: string): FootprintDef {
  return { id: `fp:gen:${name}`, name, body: { w: 6.7, h: 7.3 }, height: 1.8, description: 'SOT-223（4 脚，4 为散热片）', pads: [pad('1', -2.3, 3.15, 1.2, 2.0, { shape: 'rect' }), pad('2', 0, 3.15, 1.2, 2.0), pad('3', 2.3, 3.15, 1.2, 2.0), pad('4', 0, -3.15, 3.6, 2.0)] };
}
function to92(name: string): FootprintDef {
  return { id: `fp:gen:${name}`, name, body: { w: 5.2, h: 4.2 }, height: 5, description: 'TO-92 直插（1.27mm 间距）', pads: [pad('1', -1.27, 0, 1.4, 1.4, { shape: 'rect', drill: 0.8 }), pad('2', 0, 0, 1.4, 1.4, { shape: 'circle', drill: 0.8 }), pad('3', 1.27, 0, 1.4, 1.4, { shape: 'circle', drill: 0.8 })] };
}
function dpak(name: string, bw: number, bh: number, pitch: number, pw: number, ph: number, tabW: number): FootprintDef {
  return { id: `fp:gen:${name}`, name, body: { w: bw, h: bh + 3 }, height: 2.4, description: `${name}（2 脚为散热片）`, pads: [pad('1', -pitch / 2, bh / 2 + 1, pw, ph, { shape: 'rect' }), pad('3', pitch / 2, bh / 2 + 1, pw, ph), pad('2', 0, -bh / 4, tabW, bh / 2 + 1)] };
}
const QFP_DEFAULT: Record<number, [number, number]> = { 32: [7, 0.8], 44: [10, 0.8], 48: [7, 0.5], 64: [10, 0.5], 80: [12, 0.5], 100: [14, 0.5], 128: [14, 0.4], 144: [20, 0.5] };
const QFN_DEFAULT: Record<number, [number, number, number]> = { 6: [2, 0.65, 1.0], 8: [3, 0.65, 1.6], 10: [3, 0.5, 1.6], 12: [3, 0.5, 1.6], 16: [3, 0.5, 1.7], 20: [4, 0.5, 2.6], 24: [4, 0.5, 2.7], 28: [5, 0.5, 3.4], 32: [5, 0.5, 3.4], 40: [6, 0.5, 4.6], 48: [7, 0.5, 5.4], 56: [7, 0.4, 3.2], 64: [9, 0.5, 6.8] };
function xtal4(name: string, size: string): FootprintDef {
  const [L, W] = size === '3225' ? [3.2, 2.5] : size === '2520' ? [2.5, 2.0] : size === '2016' ? [2.0, 1.6] : [1.6, 1.2];
  const px = L / 2 - 0.55, py = W / 2 - 0.45, pw = size === '3225' ? 1.4 : 1.0, ph = size === '3225' ? 1.2 : 0.9;
  return { id: `fp:gen:${name}`, name, body: { w: L, h: W }, height: 0.8, description: `${size} 四脚晶振（1/3 晶体，2/4 接地）`, pads: [pad('1', -px, py, pw, ph, { shape: 'rect' }), pad('2', px, py, pw, ph), pad('3', px, -py, pw, ph), pad('4', -px, -py, pw, ph)] };
}
function xtal2(name: string, size: string): FootprintDef {
  const [L, W] = size === '5032' ? [5.0, 3.2] : size === '7050' ? [7.0, 5.0] : size === '3215' ? [3.2, 1.5] : [2.0, 1.2];
  return { id: `fp:gen:${name}`, name, body: { w: L, h: W }, height: 1.0, description: `${size} 两脚晶振`, pads: [pad('1', -(L / 2 - 0.6), 0, 1.6, W * 0.8, { shape: 'rect' }), pad('2', L / 2 - 0.6, 0, 1.6, W * 0.8)] };
}
function tact(name: string, size: number): FootprintDef {
  const px = size === 6 ? 4.5 : 3.0, py = size === 6 ? 2.25 : 1.6, pw = size === 6 ? 1.5 : 1.2, ph = size === 6 ? 1.2 : 1.0;
  return { id: `fp:gen:${name}`, name, body: { w: size === 6 ? 6 : 4.2, h: size === 6 ? 6 : 3.2 }, height: size === 6 ? 4.3 : 2, description: `贴片轻触开关 ${size === 6 ? '6x6' : '3x4'}（1/2 一组，3/4 一组）`, pads: [pad('1', -px, -py, pw, ph, { shape: 'rect' }), pad('2', px, -py, pw, ph), pad('3', -px, py, pw, ph), pad('4', px, py, pw, ph)] };
}
function capElec(name: string, d: number): FootprintDef {
  const pitch = d >= 8 ? 3.1 : d >= 6.3 ? 2.6 : 1.8;
  return { id: `fp:gen:${name}`, name, body: { w: d + 0.6, h: d + 0.6 }, height: d, description: `贴片铝电解 φ${d}（1 正极）`, pads: [pad('1', -pitch / 2 - 0.9, 0, 2.2, 1.4, { shape: 'rect' }), pad('2', pitch / 2 + 0.9, 0, 2.2, 1.4)] };
}

/** 生成并注册（已存在同 id 时直接返回已注册定义）。 */
export function ensureGenerated(spec: FootprintSpec): FootprintDef {
  const def = generateFootprint(spec);
  const existing = findFootprint(def.id);
  if (existing) return existing;
  registerFootprints([def]);
  return def;
}

/** 开孔封装：非金属化（螺丝孔）或金属化（带环宽的通孔焊盘，可接网络）。 */
export function holeFootprint(drill: number, plated = false, ring = 0.5): FootprintDef {
  const d = Math.round(drill * 100) / 100, pad = plated ? Math.round((d + 2 * ring) * 100) / 100 : d;
  const name = plated ? `PTH_${d}mm_Ring${ring}mm` : `Hole_${d}mm`;
  return { id: `fp:gen:${name}`, name, body: { w: pad + 0.6, h: pad + 0.6 }, height: 0, description: plated ? `金属化孔 ⌀${d}mm，环宽 ${ring}mm` : `非金属化孔 ⌀${d}mm`, pads: [{ number: '1', x: 0, y: 0, w: pad, h: pad, shape: 'circle', drill: d, npth: !plated }] };
}
/** 常用螺丝孔（孔径含间隙）。 */
export const SCREW_HOLES: { label: string; drill: number }[] = [{ label: 'M2', drill: 2.2 }, { label: 'M2.5', drill: 2.7 }, { label: 'M3', drill: 3.2 }, { label: 'M4', drill: 4.3 }];

// fp:gen:<名字> 按需生成：零件库 / 导入的封装 id 可以在使用时才实例化
setFootprintResolver((id) => { const name = id.replace(/^fp:gen:/, ''); const def = footprintFromName(name); if (!def) return undefined; const fixed = { ...def, id, name: def.name || name }; registerFootprints([fixed]); return fixed; });
