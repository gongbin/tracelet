/**
 * 项目模板：空白 / ESP32 最小系统 / STM32F103 最小系统 / Arduino UNO 扩展板。
 * 全部用内核命令生成（可撤销、可重放），封装通过参数化生成器得到真实几何。
 */
import { createProject, type Project } from '../model/project.js';
import { ProjectEditor } from '../history.js';
import { placeComponent, connectPins, addGeneratedSheet, addLabel, addWire } from '../commands/schematic.js';
import { syncFromSchematic, moveFootprint, rotateFootprint, setOutline, setOutlineRect, addBoardText, addBoardFootprint, setBoardProps } from '../commands/board.js';
import { addLibraryItems } from '../commands/library.js';
import { generateSchematic, type ExtractedComponent } from '../schematic/generate.js';
import { footprintPads } from '../board/geometry.js';
import { registeredFootprint } from './registry.js';
import { BUILTIN_FOOTPRINTS } from './footprints.js';
import { findPin } from '../schematic/geometry.js';
import type { FootprintDef } from '../model/board.js';

export interface TemplateOptions { name?: string; unit?: 'mm' | 'mil'; ruleSetId?: string; fab?: string; copperCount?: 2 | 4 }
export interface ProjectTemplate { id: string; name: string; description: string; tags: string[]; create(opts?: TemplateOptions): Project }

function base(opts: TemplateOptions, fallbackName: string): ProjectEditor {
  return new ProjectEditor(createProject({ name: opts.name || fallbackName, copperCount: opts.copperCount ?? 2, unit: opts.unit, ruleSetId: opts.ruleSetId, fab: opts.fab }));
}
/** 把板上引用的、非内置封装写入项目库（模板生成的封装需要随项目保存）。 */
function persistFootprints(ed: ProjectEditor) {
  const defs: FootprintDef[] = [];
  for (const f of ed.project.board.footprints) {
    if (BUILTIN_FOOTPRINTS.some((d) => d.id === f.footprintId) || ed.project.library.footprints.some((d) => d.id === f.footprintId) || defs.some((d) => d.id === f.footprintId)) continue;
    const d = registeredFootprint(f.footprintId); if (d) defs.push(d);
  }
  if (defs.length) ed.dispatch(addLibraryItems({ footprints: defs }));
}
const fpOf = (ed: ProjectEditor, ref: string) => ed.project.board.footprints.find((f) => f.ref === ref);
function moveRef(ed: ProjectEditor, ref: string, x: number, y: number, rotation = 0) {
  const f = fpOf(ed, ref); if (!f) return;
  ed.dispatch(moveFootprint(f.id, { x, y }));
  if (rotation) ed.dispatch(rotateFootprint(f.id, rotation));
}

/** ESP32-WROOM 最小系统：USB-C 供电 → AMS1117 → 3V3，EN 上拉，去耦，指示 LED。 */
function esp32(opts: TemplateOptions = {}): Project {
  const ed = base(opts, 'ESP32 最小系统');
  const sheet = ed.project.schematic.sheets[0].id;
  const place = (symbolId: string, center: { x: number; y: number }, value?: string) => { const r = placeComponent(ed.project, { sheetId: sheet, symbolId, center, value }); ed.dispatch(r.command); return r.id; };
  const wire = (a: string, ap: string, b: string, bp: string) => ed.dispatch(connectPins(sheet, { componentId: a, pin: ap }, { componentId: b, pin: bp }));
  const label = (cid: string, pin: string, net: string) => { const c = ed.project.schematic.sheets[0].components.find((x) => x.id === cid)!; const g = findPin(c, pin)!; const dir = { x: Math.sign(g.end.x - g.base.x), y: Math.sign(g.end.y - g.base.y) }; const tip = { x: g.end.x + dir.x * 300, y: g.end.y + dir.y * 300 }; ed.dispatch(addWire(sheet, [g.end, tip])); ed.dispatch(addLabel(sheet, net, tip)); };
  // MCU 部分（先放，保证 U1 = ESP32）
  const U1 = place('sym:ESP32-WROOM-32E', { x: 8600, y: 2600 });
  // 电源部分
  const J1 = place('sym:USB-C-16P', { x: 1600, y: 2400 });
  const U2 = place('sym:AMS1117-3.3', { x: 4200, y: 2000 });
  const C1 = place('sym:C', { x: 3200, y: 2700 }, '10uF');
  const C2 = place('sym:C', { x: 5400, y: 2700 }, '10uF');
  const R3 = place('sym:R', { x: 2800, y: 3600 }, '5.1kΩ');
  const PWR5 = place('sym:PWR', { x: 3200, y: 1300 }, '+5V');
  const PWR3 = place('sym:PWR', { x: 5400, y: 1300 }, '+3V3');
  const G1 = place('sym:GND', { x: 3200, y: 3600 }); const G2 = place('sym:GND', { x: 5400, y: 3600 }); const G3 = place('sym:GND', { x: 4200, y: 3300 }); const G4 = place('sym:GND', { x: 2800, y: 4400 }); const G5 = place('sym:GND', { x: 1600, y: 3800 });
  wire(J1, 'A4', C1, '1'); wire(C1, '1', U2, '3'); wire(PWR5, '1', C1, '1'); wire(C1, '2', G1, '1');
  wire(U2, '2', C2, '1'); wire(PWR3, '1', C2, '1'); wire(C2, '2', G2, '1'); wire(U2, '1', G3, '1');
  wire(J1, 'A5', R3, '1'); wire(R3, '2', G4, '1'); wire(J1, 'A1', G5, '1');
  const R1 = place('sym:R', { x: 6800, y: 1600 }, '10kΩ');
  const C3 = place('sym:C', { x: 10600, y: 2600 }, '100nF');
  const PWR3b = place('sym:PWR', { x: 6800, y: 900 }, '+3V3'); const PWR3c = place('sym:PWR', { x: 10600, y: 1500 }, '+3V3');
  const G6 = place('sym:GND', { x: 10600, y: 3500 }); const G7 = place('sym:GND', { x: 11400, y: 3600 });
  wire(PWR3b, '1', R1, '1'); wire(R1, '2', U1, '1');
  wire(U1, '5', C3, '1'); wire(PWR3c, '1', C3, '1'); wire(C3, '2', G6, '1'); wire(U1, '8', G7, '1');
  label(U1, '6', 'TXD0'); label(U1, '7', 'RXD0'); label(U1, '3', 'SDA'); label(U1, '4', 'SCL'); label(J1, 'A6', 'USB_D+'); label(J1, 'A7', 'USB_D-');
  // LED
  const R2 = place('sym:R', { x: 6400, y: 4200 }, '330Ω');
  const D1 = place('sym:LED', { x: 7300, y: 4900 }, '红 0603');
  const G8 = place('sym:GND', { x: 8300, y: 5300 });
  wire(U1, '2', R2, '1'); wire(R2, '2', D1, '1'); wire(D1, '2', G8, '1');
  // 定位孔
  for (const xy of [[1400, 5400], [2200, 5400], [3000, 5400], [3800, 5400]]) place('sym:MountingHole', { x: xy[0], y: xy[1] }, 'M3');
  // PCB
  ed.dispatch(setOutlineRect(50, 40));
  ed.dispatch(syncFromSchematic());
  moveRef(ed, 'U1', 20, 18); moveRef(ed, 'J1', 43, 11.5); moveRef(ed, 'U2', 40, 20); moveRef(ed, 'C1', 34, 14); moveRef(ed, 'C2', 46, 26); moveRef(ed, 'C3', 31, 24); moveRef(ed, 'R1', 6, 14); moveRef(ed, 'R2', 8, 30); moveRef(ed, 'D1', 8, 35); moveRef(ed, 'R3', 46, 16);
  moveRef(ed, 'H1', 3.5, 3.5); moveRef(ed, 'H2', 46.5, 3.5); moveRef(ed, 'H3', 3.5, 36.5); moveRef(ed, 'H4', 46.5, 36.5);
  ed.dispatch(addBoardText({ layer: 'F.Silk', text: 'ESP32 MINI v1.0', x: 25, y: 38.5, size: 1 }));
  persistFootprints(ed);
  return ed.project;
}

const STM32_PINS: [string, string, string?][] = [
  ['1', 'VBAT', '+3V3'], ['2', 'PC13'], ['3', 'PC14'], ['4', 'PC15'], ['5', 'OSC_IN', 'OSC_IN'], ['6', 'OSC_OUT', 'OSC_OUT'], ['7', 'NRST', 'NRST'], ['8', 'VSSA', 'GND'], ['9', 'VDDA', '+3V3'], ['10', 'PA0'], ['11', 'PA1'], ['12', 'PA2', 'UART2_TX'], ['13', 'PA3', 'UART2_RX'], ['14', 'PA4'], ['15', 'PA5'], ['16', 'PA6'], ['17', 'PA7'], ['18', 'PB0'], ['19', 'PB1'], ['20', 'BOOT1'], ['21', 'PB10'], ['22', 'PB11'], ['23', 'VSS', 'GND'], ['24', 'VDD', '+3V3'],
  ['25', 'PB12'], ['26', 'PB13'], ['27', 'PB14'], ['28', 'PB15'], ['29', 'PA8'], ['30', 'PA9', 'UART1_TX'], ['31', 'PA10', 'UART1_RX'], ['32', 'PA11', 'USB_DM'], ['33', 'PA12', 'USB_DP'], ['34', 'SWDIO', 'SWDIO'], ['35', 'VSS', 'GND'], ['36', 'VDD', '+3V3'], ['37', 'SWCLK', 'SWCLK'], ['38', 'PA15'], ['39', 'PB3'], ['40', 'PB4'], ['41', 'PB5'], ['42', 'PB6', 'I2C1_SCL'], ['43', 'PB7', 'I2C1_SDA'], ['44', 'BOOT0', 'BOOT0'], ['45', 'PB8'], ['46', 'PB9'], ['47', 'VSS', 'GND'], ['48', 'VDD', '+3V3']
];

/** STM32F103C8T6 最小系统：LQFP-48、8MHz 晶振、复位、BOOT0、SWD、LDO、去耦。 */
function stm32(opts: TemplateOptions = {}): Project {
  const ed = base(opts, 'STM32F103 最小系统');
  const cap = (ref: string, value: string, a: string, b: string, fp = '0402'): ExtractedComponent => ({ ref, value, kind: 'capacitor', footprint: fp, pins: [{ number: '1', name: '1', net: a }, { number: '2', name: '2', net: b }] });
  const res = (ref: string, value: string, a: string, b: string): ExtractedComponent => ({ ref, value, kind: 'resistor', footprint: '0402', pins: [{ number: '1', name: '1', net: a }, { number: '2', name: '2', net: b }] });
  const comps: ExtractedComponent[] = [
    { ref: 'U1', value: 'STM32F103C8T6', kind: 'mcu', footprint: 'LQFP-48_7x7mm_P0.5mm', description: 'ARM Cortex-M3 72MHz 64KB Flash', pins: STM32_PINS.map(([n, name, net]) => ({ number: n, name, net: net ?? '' })) },
    { ref: 'U2', value: 'AMS1117-3.3', kind: 'ldo', footprint: 'SOT-223', pins: [{ number: '1', name: 'GND', net: 'GND' }, { number: '2', name: 'VOUT', net: '+3V3' }, { number: '3', name: 'VIN', net: '+5V' }] },
    { ref: 'Y1', value: '8MHz', kind: 'crystal', footprint: 'Crystal_SMD_3225-4Pin', pins: [{ number: '1', name: '1', net: 'OSC_IN' }, { number: '2', name: 'GND', net: 'GND' }, { number: '3', name: '3', net: 'OSC_OUT' }, { number: '4', name: 'GND', net: 'GND' }] },
    cap('C1', '100nF', '+3V3', 'GND'), cap('C2', '100nF', '+3V3', 'GND'), cap('C3', '100nF', '+3V3', 'GND'), cap('C4', '100nF', '+3V3', 'GND'), cap('C5', '20pF', 'OSC_IN', 'GND'), cap('C6', '20pF', 'OSC_OUT', 'GND'), cap('C7', '10uF', '+5V', 'GND', '0603'), cap('C8', '10uF', '+3V3', 'GND', '0603'), cap('C9', '100nF', 'NRST', 'GND'),
    res('R1', '10kΩ', 'BOOT0', 'GND'), res('R2', '10kΩ', 'NRST', '+3V3'), res('R3', '1kΩ', 'PC13', 'LED_K'),
    { ref: 'D1', value: '红 0603', kind: 'led', footprint: 'LED_0603', pins: [{ number: '1', name: 'A', net: 'LED_K' }, { number: '2', name: 'K', net: 'GND' }] },
    { ref: 'SW1', value: 'RESET', kind: 'switch', footprint: 'SW_SPST_TL3342', pins: [{ number: '1', name: '1', net: 'NRST' }, { number: '2', name: '2', net: 'GND' }] },
    { ref: 'J1', value: 'SWD', kind: 'connector', footprint: 'PinHeader_1x04_P2.54mm_Vertical', pins: [{ number: '1', name: '3V3', net: '+3V3' }, { number: '2', name: 'SWDIO', net: 'SWDIO' }, { number: '3', name: 'SWCLK', net: 'SWCLK' }, { number: '4', name: 'GND', net: 'GND' }] },
    { ref: 'J2', value: 'UART', kind: 'connector', footprint: 'PinHeader_1x04_P2.54mm_Vertical', pins: [{ number: '1', name: '5V', net: '+5V' }, { number: '2', name: 'TX', net: 'UART1_TX' }, { number: '3', name: 'RX', net: 'UART1_RX' }, { number: '4', name: 'GND', net: 'GND' }] }
  ];
  const r = generateSchematic({ title: 'STM32F103 最小系统', components: comps, notes: ['BOOT0 经 R1 下拉 = 从 Flash 启动；烧录时改接 3V3。', 'USB 需另加 1.5k 上拉与 ESD，本模板未包含。'] }, { sheetName: '主图' });
  ed.dispatch(addGeneratedSheet(r.sheet, r.symbols));
  // 删除自动创建的空白首页：addGeneratedSheet 追加新页，这里把主图放到第一页
  const sheets = ed.project.schematic.sheets;
  if (sheets.length > 1 && sheets[0].components.length === 0) ed.project.schematic.sheets = [sheets[1], ...sheets.slice(2)];
  ed.dispatch(setOutlineRect(45, 35));
  ed.dispatch(syncFromSchematic());
  moveRef(ed, 'U1', 22, 17); moveRef(ed, 'U2', 38, 8); moveRef(ed, 'Y1', 10, 17); moveRef(ed, 'C5', 10, 12); moveRef(ed, 'C6', 10, 22);
  moveRef(ed, 'C1', 14, 26); moveRef(ed, 'C2', 30, 26); moveRef(ed, 'C3', 14, 8); moveRef(ed, 'C4', 30, 8); moveRef(ed, 'C7', 38, 14); moveRef(ed, 'C8', 38, 20); moveRef(ed, 'C9', 6, 27);
  moveRef(ed, 'R1', 32, 30); moveRef(ed, 'R2', 6, 30); moveRef(ed, 'R3', 22, 30); moveRef(ed, 'D1', 26, 30); moveRef(ed, 'SW1', 12, 4);
  moveRef(ed, 'J1', 41.5, 26, 0); moveRef(ed, 'J2', 3, 8, 0);
  ed.dispatch(addBoardText({ layer: 'F.Silk', text: 'STM32F103 MIN v1.0', x: 22, y: 33.5, size: 1 }));
  persistFootprints(ed);
  return ed.project;
}

/** Arduino UNO R3 扩展板：四组排母 + 4 个定位孔，位置按 UNO R3 机械图（英寸栅格）。 */
function arduinoShield(opts: TemplateOptions = {}): Project {
  const ed = base(opts, 'Arduino 扩展板');
  const hdr = (ref: string, value: string, names: string[]): ExtractedComponent => ({ ref, value, kind: 'connector', footprint: `PinSocket_1x${String(names.length).padStart(2, '0')}_P2.54mm_Vertical`, pins: names.map((n, i) => ({ number: String(i + 1), name: n, net: /^NC/.test(n) ? '' : n })) });
  const comps: ExtractedComponent[] = [
    hdr('J1', 'DIGITAL 8-13', ['SCL', 'SDA', 'AREF', 'GND', 'D13', 'D12', 'D11', 'D10', 'D9', 'D8']),
    hdr('J2', 'DIGITAL 0-7', ['D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'D1', 'D0']),
    hdr('J3', 'POWER', ['NC', 'IOREF', 'RESET', '+3V3', '+5V', 'GND', 'GND', 'VIN']),
    hdr('J4', 'ANALOG', ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'])
  ];
  const r = generateSchematic({ title: 'Arduino UNO 扩展板', components: comps, notes: ['排母与定位孔位置为 UNO R3 参考值（英寸栅格），制作前请与实物 / 官方图纸核对。'] }, { sheetName: '主图' });
  ed.dispatch(addGeneratedSheet(r.sheet, r.symbols));
  const sheets = ed.project.schematic.sheets;
  if (sheets.length > 1 && sheets[0].components.length === 0) ed.project.schematic.sheets = [sheets[1], ...sheets.slice(2)];
  // 板框（mm，左上为原点）：UNO 右侧两处斜角
  ed.dispatch(setOutline([{ x: 0, y: 0 }, { x: 66.04, y: 0 }, { x: 68.58, y: 2.54 }, { x: 68.58, y: 33.02 }, { x: 66.04, y: 35.56 }, { x: 66.04, y: 50.8 }, { x: 63.5, y: 53.34 }, { x: 0, y: 53.34 }]));
  ed.dispatch(syncFromSchematic());
  // 排母：pin1 在指定位置，其余引脚沿 +x
  const placeRow = (ref: string, x1: number, y: number) => {
    const f = fpOf(ed, ref); if (!f) return;
    for (const rot of [90, 270, 0, 180]) {
      const trial = { ...f, x: 0, y: 0, rotation: rot };
      const pads = footprintPads(trial, ed.project.board);
      const p1 = pads.find((p) => p.number === '1')!, p2 = pads.find((p) => p.number === '2')!;
      if (p2.center.x > p1.center.x + 1 && Math.abs(p2.center.y - p1.center.y) < 0.01) { ed.dispatch(moveFootprint(f.id, { x: x1 - p1.center.x, y: y - p1.center.y })); ed.dispatch(rotateFootprint(f.id, rot - f.rotation)); return; }
    }
  };
  const IN = 25.4;
  placeRow('J1', 0.8 * IN, 0.1 * IN); placeRow('J2', 1.86 * IN, 0.1 * IN); placeRow('J3', 1.1 * IN, 2.0 * IN); placeRow('J4', 1.9 * IN, 2.0 * IN);
  for (const [x, y] of [[0.55, 2.0], [0.6, 0.1], [2.6, 0.7], [2.6, 1.8]]) { const h = addBoardFootprint(ed.project, { footprintId: 'fp:MountingHole_3.2mm', x: x * IN, y: y * IN }); ed.dispatch(h.command); }
  ed.dispatch(addBoardText({ layer: 'F.Silk', text: 'UNO SHIELD v1.0', x: 34, y: 27, size: 1.2 }));
  ed.dispatch(setBoardProps({ thickness: 1.6 }));
  persistFootprints(ed);
  return ed.project;
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  { id: 'blank', name: '空白', description: '空图纸 + 50×30mm 板框', tags: [], create: (opts = {}) => base(opts, '未命名项目').project },
  { id: 'esp32', name: 'ESP32 最小系统', description: 'ESP32-WROOM-32E · USB-C 供电 · AMS1117 LDO · EN 上拉 · 指示 LED · 4 定位孔', tags: ['esp32', 'wifi'], create: esp32 },
  { id: 'stm32', name: 'STM32F103 最小系统', description: 'STM32F103C8T6 LQFP-48 · 8MHz 晶振 · 复位 / BOOT0 · SWD & UART 排针 · 去耦', tags: ['stm32', 'arm'], create: stm32 },
  { id: 'arduino', name: 'Arduino UNO 扩展板', description: 'UNO R3 外形与四组排母（D0–D13 / 电源 / A0–A5）· 4 定位孔，直接在上面加你的电路', tags: ['arduino', 'shield'], create: arduinoShield }
];

export function createFromTemplate(id: string, opts: TemplateOptions = {}): Project {
  const t = PROJECT_TEMPLATES.find((x) => x.id === id) ?? PROJECT_TEMPLATES[0];
  return t.create(opts);
}
