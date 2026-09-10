/**
 * 生成 packages/kernel/src/library/mcu.ts：常用 ESP32 模块与 STM32 芯片的引脚表 / 封装 / 目录条目。
 *
 * 引脚与模块封装来自两个上游库，用内核自带的 KiCad 导入器解析，避免手抄出错：
 *   - Espressif KiCad Libraries  https://github.com/espressif/kicad-libraries
 *   - KiCad official symbols     https://gitlab.com/kicad/libraries/kicad-symbols
 * 两者均为 CC-BY-SA 4.0 + KiCad 设计例外；CC-BY-SA 4.0 单向兼容 GPLv3，生成结果随本仓库以 GPL-3.0-or-later 分发，来源见本文件与生成文件头。
 *
 * 用法：node scripts/build-mcu-lib.mjs [--cache <目录>]   （联网下载上游库；缓存目录默认 .mcu-cache，已在 .gitignore）
 */
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const root = resolve(new URL('.', import.meta.url).pathname, '..');
const cacheDir = (() => { const i = process.argv.indexOf('--cache'); return resolve(root, i > 0 ? process.argv[i + 1] : '.mcu-cache'); })();

const ESP_SYM = 'https://raw.githubusercontent.com/espressif/kicad-libraries/main/symbols/Espressif.kicad_sym';
const ESP_FP = (n) => `https://raw.githubusercontent.com/espressif/kicad-libraries/main/footprints/Espressif.pretty/${n}.kicad_mod`;
const KICAD_SYM = (n) => `https://gitlab.com/kicad/libraries/kicad-symbols/-/raw/v8/${n}.kicad_sym`;
const KICAD_FP = (n) => `https://gitlab.com/kicad/libraries/kicad-footprints/-/raw/v8/Package_DFN_QFN.pretty/${n}.kicad_mod`;

/** ESP32 模块：symbol/footprint 名取自 Espressif 库，height 为数据手册模块厚度。 */
const MODULES = [
  { sym: 'ESP32-S3-WROOM-1', fp: 'ESP32-S3-WROOM-1', height: 3.1, mpn: 'ESP32-S3-WROOM-1-N16R8', lcsc: 'C2913202', kind: '模块',
    description: 'Xtensa 双核 240MHz Wi-Fi + BLE5，16MB Flash + 8MB PSRAM', params: 'Xtensa LX7 双核 240MHz · 16MB Flash · 8MB PSRAM · WiFi4/BLE5', keywords: ['esp32', 's3', 'wifi', 'ble', 'psram', 'mcu', '单片机'] },
  { sym: 'ESP32-S3-MINI-1', fp: 'ESP32-S3-MINI-1', height: 2.4, mpn: 'ESP32-S3-MINI-1-N8', lcsc: 'C2913206', kind: '模块',
    description: 'S3 小尺寸模块，8MB Flash，15.4x20.5mm', params: 'Xtensa LX7 双核 240MHz · 8MB Flash · WiFi4/BLE5 · 小封装', keywords: ['esp32', 's3', 'mini', 'wifi', 'mcu', '单片机'] },
  { sym: 'ESP32-C3-MINI-1', fp: 'ESP32-C3-MINI-1', height: 2.4, mpn: 'ESP32-C3-MINI-1-N4', lcsc: 'C2838502', kind: '模块',
    description: 'RISC-V 160MHz Wi-Fi + BLE5，4MB Flash', params: 'RISC-V 160MHz · 4MB Flash · 400KB SRAM · WiFi4/BLE5', keywords: ['esp32', 'c3', 'riscv', 'wifi', 'ble', 'mcu', '单片机'] },
  { sym: 'ESP32-C3-WROOM-02', fp: 'ESP32-C3-WROOM-02', height: 3.1, mpn: 'ESP32-C3-WROOM-02-N4', lcsc: 'C2934560', kind: '模块',
    description: 'C3 直插式 18 脚模块（与 ESP-12 同尺寸），4MB Flash', params: 'RISC-V 160MHz · 4MB Flash · 18 引脚 · WiFi4/BLE5', keywords: ['esp32', 'c3', 'wroom', 'riscv', 'mcu', '单片机'] },
  { sym: 'ESP32-C6-WROOM-1', fp: 'ESP32-C6-WROOM-1', height: 3.1, mpn: 'ESP32-C6-WROOM-1-N8', lcsc: 'C5366877', kind: '模块',
    description: 'Wi-Fi 6 + BLE5 + 802.15.4（Thread / Zigbee），8MB Flash', params: 'RISC-V 160MHz · 8MB Flash · WiFi6 · BLE5 · Thread/Zigbee', keywords: ['esp32', 'c6', 'wifi6', 'thread', 'zigbee', 'riscv', 'mcu', '单片机'] },
  { sym: 'ESP32-S31-WROOM-3', fp: 'ESP32-S31-WROOM-3', height: 3.1, mpn: 'ESP32-S31-WROOM-3', lcsc: '', kind: '模块',
    description: 'RISC-V 双核，Wi-Fi 6 + BT5.4（LE / Classic）+ 802.15.4，54 个 GPIO', params: 'RISC-V 双核 · WiFi6 · BT5.4 · Thread/Zigbee · 54 GPIO', keywords: ['esp32', 's31', 'wifi6', 'bt5.4', 'riscv', 'mcu', '单片机'] },
  { sym: 'ESP32-C5-WROOM-1', fp: 'ESP32-C5-WROOM-1', height: 3.1, mpn: 'ESP32-C5-WROOM-1-N8', lcsc: '', kind: '模块',
    description: '2.4 / 5GHz 双频 Wi-Fi 6 + BLE5 + 802.15.4，8MB Flash', params: 'RISC-V 240MHz · 8MB Flash · 双频 WiFi6 · BLE5 · Thread', keywords: ['esp32', 'c5', 'wifi6', '5ghz', 'riscv', 'mcu', '单片机'] }
];

/** ESP32 SoC 裸片：封装名就是乐鑫符号里 Footprint 属性指向的那一个（kicad = KiCad 官方 QFN 库，espressif = 乐鑫自带）。 */
const SOCS = [
  { sym: 'ESP32-S3', fp: 'QFN-56-1EP_7x7mm_P0.4mm_EP5.6x5.6mm', fpSource: 'kicad', height: 0.9, mpn: 'ESP32-S3FH4R2', lcsc: 'C3013940',
    description: 'Xtensa 双核 240MHz SoC，QFN-56，片内 4MB Flash + 2MB PSRAM', params: 'Xtensa LX7 双核 240MHz · QFN-56 7x7 · 4MB Flash · 2MB PSRAM', keywords: ['esp32', 's3', 'soc', '裸片', 'qfn', 'mcu', '单片机'] },
  { sym: 'ESP32-C3', fp: 'QFN-32-1EP_5x5mm_P0.5mm_EP3.45x3.45mm', fpSource: 'kicad', height: 0.9, mpn: 'ESP32-C3FH4', lcsc: 'C2858491',
    description: 'RISC-V 160MHz SoC，QFN-32，片内 4MB Flash', params: 'RISC-V 160MHz · QFN-32 5x5 · 4MB Flash · WiFi4/BLE5', keywords: ['esp32', 'c3', 'soc', '裸片', 'qfn', 'riscv', 'mcu', '单片机'] },
  { sym: 'ESP32-C6', fp: 'QFN-40-1EP_5x5mm_P0.4mm_EP3.6x3.6mm', fpSource: 'kicad', height: 0.9, mpn: 'ESP32-C6FH4', lcsc: '',
    description: 'RISC-V 160MHz SoC，QFN-40，Wi-Fi 6 + BLE5 + 802.15.4', params: 'RISC-V 160MHz · QFN-40 5x5 · WiFi6 · Thread/Zigbee', keywords: ['esp32', 'c6', 'soc', '裸片', 'qfn', 'wifi6', 'mcu', '单片机'] },
  { sym: 'ESP32-C5', fp: 'QFN-48-1EP_6x6mm_P0.4mm_EP4.6x4.6mm', fpSource: 'kicad', height: 0.9, mpn: 'ESP32-C5', lcsc: '',
    description: 'RISC-V 240MHz SoC，QFN-48，2.4 / 5GHz 双频 Wi-Fi 6', params: 'RISC-V 240MHz · QFN-48 6x6 · 双频 WiFi6 · BLE5', keywords: ['esp32', 'c5', 'soc', '裸片', 'qfn', '5ghz', 'mcu', '单片机'] },
  { sym: 'ESP32-H2', fp: 'QFN-32-1EP_4x4mm_P0.4mm_EP2.9x2.9mm', fpSource: 'espressif', height: 0.9, mpn: 'ESP32-H2FH4', lcsc: 'C22470214',
    description: 'RISC-V 96MHz SoC，QFN-32，BLE5 + 802.15.4（无 Wi-Fi）', params: 'RISC-V 96MHz · QFN-32 4x4 · 4MB Flash · Thread/Zigbee/BLE5', keywords: ['esp32', 'h2', 'soc', '裸片', 'qfn', 'zigbee', 'thread', 'mcu', '单片机'] }
];

/** STM32：引脚表取自 KiCad 官方符号，封装用内核参数化生成（KiCad 命名）。 */
const STM32 = [
  { lib: 'MCU_ST_STM32F1', sym: 'STM32F103C8Tx', mpn: 'STM32F103C8T6', lcsc: 'C8734', footprint: 'LQFP-48_7x7mm_P0.5mm', category: 'microcontroller',
    description: 'Cortex-M3 72MHz，64KB Flash / 20KB RAM，LQFP-48', params: 'M3 72MHz · 64KB Flash · 20KB RAM · 2–3.6V', keywords: ['stm32', 'f103', 'arm', 'cortex-m3', 'bluepill', '单片机', 'mcu'] },
  { lib: 'MCU_ST_STM32F1', sym: 'STM32F103CBTx', mpn: 'STM32F103CBT6', lcsc: 'C8304', footprint: 'LQFP-48_7x7mm_P0.5mm', category: 'microcontroller',
    description: 'Cortex-M3 72MHz，128KB Flash / 20KB RAM，LQFP-48', params: 'M3 72MHz · 128KB Flash · 20KB RAM', keywords: ['stm32', 'f103', 'arm', 'cortex-m3', '单片机', 'mcu'] },
  { lib: 'MCU_ST_STM32F0', sym: 'STM32F030F4Px', mpn: 'STM32F030F4P6', lcsc: 'C32908', footprint: 'TSSOP-20_4.4x6.5mm_P0.65mm', category: 'microcontroller',
    description: 'Cortex-M0 48MHz，16KB Flash / 4KB RAM，TSSOP-20', params: 'M0 48MHz · 16KB Flash · 4KB RAM · 2.4–3.6V', keywords: ['stm32', 'f030', 'arm', 'cortex-m0', '单片机', 'mcu'] },
  { lib: 'MCU_ST_STM32G0', sym: 'STM32G030F6Px', mpn: 'STM32G030F6P6', lcsc: 'C724040', footprint: 'TSSOP-20_4.4x6.5mm_P0.65mm', category: 'microcontroller',
    description: 'Cortex-M0+ 64MHz，32KB Flash / 8KB RAM，TSSOP-20', params: 'M0+ 64MHz · 32KB Flash · 8KB RAM · 2–3.6V', keywords: ['stm32', 'g030', 'arm', 'cortex-m0+', '单片机', 'mcu'] },
  { lib: 'MCU_ST_STM32F4', sym: 'STM32F411CEUx', mpn: 'STM32F411CEU6', lcsc: 'C60420', footprint: 'UFQFPN-48-1EP_7x7mm_P0.5mm_EP5.6x5.6mm', category: 'microcontroller',
    description: 'Cortex-M4F 100MHz，512KB Flash / 128KB RAM，UFQFPN-48', params: 'M4F 100MHz · 512KB Flash · 128KB RAM · 1.7–3.6V', keywords: ['stm32', 'f411', 'arm', 'cortex-m4', 'blackpill', '单片机', 'mcu'] },
  { lib: 'MCU_ST_STM32L4', sym: 'STM32L432KCUx', mpn: 'STM32L432KCU6', lcsc: 'C1337280', footprint: 'UFQFPN-32-1EP_5x5mm_P0.5mm_EP3.5x3.5mm', category: 'microcontroller',
    description: '低功耗 Cortex-M4F 80MHz，256KB Flash / 64KB RAM，UFQFPN-32', params: 'M4F 80MHz · 256KB Flash · 64KB RAM · 低功耗', keywords: ['stm32', 'l432', 'arm', 'low power', '单片机', 'mcu', '低功耗'] }
];

async function download(url, file) {
  const path = join(cacheDir, file);
  if (existsSync(path)) return path;
  mkdirSync(cacheDir, { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  console.log(`  ↓ ${file}`);
  return path;
}

console.log('下载上游库到', cacheDir);
await download(ESP_SYM, 'Espressif.kicad_sym');
for (const m of MODULES) await download(ESP_FP(m.fp), `${m.fp}.kicad_mod`);
for (const c of SOCS) await download(c.fpSource === 'kicad' ? KICAD_FP(c.fp) : ESP_FP(c.fp), `${c.fp}.kicad_mod`);
for (const lib of [...new Set(STM32.map((s) => s.lib))]) await download(KICAD_SYM(lib), `${lib}.kicad_sym`);

// 用内核的 KiCad 导入器解析，输出 JSON
const tmp = resolve(root, 'packages/kernel/.build-mcu.tmp.ts');
writeFileSync(tmp, `
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { importLibraryFile } from './src/index.js';
const cache = ${JSON.stringify(cacheDir)};
const modules = ${JSON.stringify(MODULES)};
const stm32 = ${JSON.stringify(STM32)};
const socs = ${JSON.stringify(SOCS)};
const read = (f: string) => importLibraryFile(f, readFileSync(join(cache, f), 'utf8'));
// KiCad 库里的引脚按字符串排序（1,10,11,…,2,20），按引脚号数值重排，符号上下顺序才与实物一致
const byNumber = (pins: { number: string; name: string; type: string }[]) =>
  [...pins].sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0)).map((p) => [p.number, p.name, p.type]);
const esp = read('Espressif.kicad_sym');
const out: Record<string, unknown> = {};
out.modules = modules.map((m) => {
  const sym = esp.symbols.find((s) => s.name === m.sym);
  if (!sym) throw new Error('缺少符号 ' + m.sym);
  const fp = read(m.fp + '.kicad_mod').footprints[0];
  if (!fp) throw new Error('缺少封装 ' + m.fp);
  return { ...m, pins: byNumber(sym.pins), fpDef: { name: fp.name, body: fp.body, pads: fp.pads } };
});
out.socs = socs.map((c) => {
  const sym = esp.symbols.find((s) => s.name === c.sym);
  if (!sym) throw new Error('缺少符号 ' + c.sym);
  const fp = read(c.fp + '.kicad_mod').footprints[0];
  if (!fp) throw new Error('缺少封装 ' + c.fp);
  return { ...c, pins: byNumber(sym.pins), fpDef: { name: fp.name, body: fp.body, pads: fp.pads } };
});
const libs: Record<string, ReturnType<typeof read>> = {};
out.stm32 = stm32.map((s) => {
  libs[s.lib] ??= read(s.lib + '.kicad_sym');
  const sym = libs[s.lib].symbols.find((x) => x.name === s.sym);
  if (!sym) throw new Error('缺少符号 ' + s.sym);
  return { ...s, pins: byNumber(sym.pins) };
});
process.stdout.write(JSON.stringify(out));
`);
let data;
try {
  data = JSON.parse(execFileSync('npx', ['tsx', tmp], { cwd: resolve(root, 'packages/kernel'), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }));
} finally { try { rmSync(tmp); } catch { /* ignore */ } }

/** GPIO4/TOUCH4/ADC1_CH3 → IO4；U0RXD/GPIO44/CLK_OUT2 → IO44/U0RXD；保留 EN / 3V3 / GND / NC。 */
function shortPinName(name) {
  if (/^(GND|3V3|EN|NC)$/.test(name)) return name;
  if (name === 'EN/CHIP_PU') return 'EN';
  const parts = name.split('/');
  const gpio = parts.find((p) => /^GPIO\d+$/.test(p));
  if (!gpio) return parts[0];
  const io = 'IO' + gpio.slice(4);
  const extra = parts.find((p) => /^U0(TXD|RXD)$/.test(p)) ?? (parts.some((p) => p === 'USB_D-') ? 'D-' : parts.some((p) => p === 'USB_D+') ? 'D+' : undefined);
  return extra ? `${io}/${extra}` : io;
}
/** 末尾连续的同名 GND（模块底部散热焊盘）只保留第一个，其余焊盘留在封装里、符号上不画。 */
function trimTrailingGnd(pins) {
  let end = pins.length;
  while (end > 1 && pins[end - 1][1] === 'GND') end--;
  return end < pins.length ? [...pins.slice(0, end), pins[end]] : pins;
}
const num = (v) => (Math.round(v * 1000) / 1000);
const padTuple = (p) => `[${JSON.stringify(p.number)},${num(p.x)},${num(p.y)},${num(p.w)},${num(p.h)}${p.shape === 'rect' ? ",'rect'" : ''}]`;
const pinTuple = ([n, name, type]) => `['${n}','${name}','${type}']`;

const socBlocks = data.socs.map((c) => {
  const pins = trimTrailingGnd(c.pins.map(([n, name, type]) => [n, shortPinName(name), type]));
  return { c, pins, fp: c.fpDef };
});

const moduleBlocks = data.modules.map((m) => {
  const pins = trimTrailingGnd(m.pins.map(([n, name, type]) => [n, shortPinName(name), type]));
  const fp = m.fpDef;
  return { m, pins, fp };
});

const body = `/**
 * 常用 MCU：ESP32 模块（完整引脚 + 官方 castellated 封装）与 STM32 芯片（完整引脚 + 参数化封装）。
 *
 * 本文件由 scripts/build-mcu-lib.mjs 生成，请勿手改；引脚与模块封装解析自上游库：
 *   Espressif KiCad Libraries — https://github.com/espressif/kicad-libraries
 *   KiCad official symbols    — https://gitlab.com/kicad/libraries/kicad-symbols
 * 两者为 CC-BY-SA 4.0 + KiCad 设计例外（CC-BY-SA 4.0 单向兼容 GPLv3）。
 * 模块符号只画 castellated 引脚，底部散热焊盘保留在封装里但不出现在符号上（铺 GND 时覆盖即可）。
 */
import type { Part } from './parts.js';
import type { SymbolDef, PinType } from '../model/schematic.js';
import type { FootprintDef, PadDef } from '../model/board.js';
import { icSymbol } from './partsBase.js';

type PinRow = [number: string, name: string, type: PinType];
type PadRow = [number: string, x: number, y: number, w: number, h: number, shape?: 'rect'];

const pads = (rows: PadRow[]): PadDef[] => rows.map(([number, x, y, w, h, shape]) => ({ number, x, y, w, h, shape: shape ?? 'roundrect', drill: 0, npth: false }));

/** ESP32 模块封装（Espressif 官方库，单位 mm）。 */
export const MCU_FOOTPRINTS: FootprintDef[] = [
${[...moduleBlocks.map(({ m, fp }) => ({ id: `fp:${m.sym}`, fp, height: m.height, desc: `${m.mpn} 模块封装（Espressif 官方库）` })),
   ...socBlocks.map(({ c, fp }) => ({ id: `fp:${c.fp}`, fp, height: c.height, desc: `${c.mpn} 裸片封装（${c.fpSource === 'kicad' ? 'KiCad 官方库' : 'Espressif 官方库'}）` }))]
  .map(({ id, fp, height, desc }) => `  { id: '${id}', name: ${JSON.stringify(fp.name)}, body: { w: ${num(fp.body.w)}, h: ${num(fp.body.h)}${fp.body.x ? `, x: ${num(fp.body.x)}` : ''}${fp.body.y ? `, y: ${num(fp.body.y)}` : ''} }, height: ${height}, description: ${JSON.stringify(desc)},
    pads: pads([${fp.pads.map(padTuple).join(', ')}]) }`).join(',\n')}
];

const MODULE_PINS: Record<string, PinRow[]> = {
${moduleBlocks.map(({ m, pins }) => `  '${m.sym}': [${pins.map(pinTuple).join(', ')}]`).join(',\n')}
};

const SOC_PINS: Record<string, PinRow[]> = {
${socBlocks.map(({ c, pins }) => `  '${c.sym}': [${pins.map(pinTuple).join(', ')}]`).join(',\n')}
};

const STM32_PINS: Record<string, PinRow[]> = {
${data.stm32.map((s) => `  '${s.mpn}': [${s.pins.map(pinTuple).join(', ')}]`).join(',\n')}
};

const MODULE_META = ${JSON.stringify(data.modules.map(({ sym, fp, mpn, lcsc, kind, description, params, keywords }) => ({ sym, fp, mpn, lcsc, kind, description, params, keywords })), null, 2).replace(/\n/g, '\n')} as const;

const SOC_META = ${JSON.stringify(data.socs.map(({ sym, fp, mpn, lcsc, description, params, keywords }) => ({ sym, fp, mpn, lcsc, description, params, keywords })), null, 2)} as const;

const STM32_META = ${JSON.stringify(data.stm32.map(({ sym, mpn, lcsc, footprint, category, description, params, keywords }) => ({ sym, mpn, lcsc, footprint, category, description, params, keywords })), null, 2)} as const;

export const MCU_SYMBOLS: SymbolDef[] = [
  ...MODULE_META.map((m) => icSymbol(\`sym:\${m.sym}\`, m.sym, MODULE_PINS[m.sym].map(([n, name, type]) => [n, name, type]), { kind: '模块', description: \`\${m.description}（完整引脚；底部散热焊盘只在封装上）\`, footprint: \`fp:\${m.sym}\`, value: m.mpn })),
  ...SOC_META.map((c) => icSymbol(\`sym:\${c.sym}\`, c.sym, SOC_PINS[c.sym].map(([n, name, type]) => [n, name, type]), { kind: '芯片', description: \`\${c.description}（完整引脚；底部散热焊盘只在封装上）\`, footprint: \`fp:\${c.fp}\`, value: c.mpn })),
  ...STM32_META.map((s) => icSymbol(\`sym:\${s.mpn}\`, s.mpn, STM32_PINS[s.mpn].map(([n, name, type]) => [n, name, type]), { kind: '微控制器', description: s.description, footprint: \`fp:gen:\${s.footprint}\`, value: s.mpn }))
];

export const MCU_PARTS: Part[] = [
  ...MODULE_META.map((m): Part => ({ id: \`part:\${m.sym.toLowerCase()}\`, category: 'communication-module', mpn: m.mpn, maker: 'Espressif', kind: m.kind, description: m.description, symbolId: \`sym:\${m.sym}\`, footprintId: \`fp:\${m.sym}\`, value: m.mpn, params: m.params, pinCount: MODULE_PINS[m.sym].length, ...(m.lcsc ? { lcsc: m.lcsc } : {}), has3d: false, keywords: [...m.keywords, m.mpn.toLowerCase(), '模块'] })),
  ...SOC_META.map((c): Part => ({ id: \`part:\${c.mpn.toLowerCase()}\`, category: 'microcontroller', mpn: c.mpn, maker: 'Espressif', kind: '芯片', description: c.description, symbolId: \`sym:\${c.sym}\`, footprintId: \`fp:\${c.fp}\`, value: c.mpn, params: c.params, pinCount: SOC_PINS[c.sym].length, ...(c.lcsc ? { lcsc: c.lcsc } : {}), has3d: false, keywords: [...c.keywords, c.mpn.toLowerCase()] })),
  ...STM32_META.map((s): Part => ({ id: \`part:\${s.mpn.toLowerCase()}\`, category: s.category, mpn: s.mpn, maker: 'ST', kind: '微控制器', description: s.description, symbolId: \`sym:\${s.mpn}\`, footprintId: \`fp:gen:\${s.footprint}\`, value: s.mpn, params: s.params, pinCount: STM32_PINS[s.mpn].length, ...(s.lcsc ? { lcsc: s.lcsc } : {}), has3d: false, keywords: [...s.keywords, s.mpn.toLowerCase()] }))
];
`;

writeFileSync(resolve(root, 'packages/kernel/src/library/mcu.ts'), body);
console.log(`packages/kernel/src/library/mcu.ts: ${data.modules.length} 个模块 · ${data.socs.length} 个 SoC 裸片 · ${data.stm32.length} 个 STM32`);
