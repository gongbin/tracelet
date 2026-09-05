import type { SymbolDef } from '../model/schematic.js';
import { registeredSymbol, registerSymbols } from './registry.js';

/** 内置符号库（单位 mil，栅格 100）。后续通过 KiCad 库导入扩充。 */
export const BUILTIN_SYMBOLS: SymbolDef[] = [
  {
    id: 'sym:R', name: '电阻', kind: '电阻', prefix: 'R', width: 240, height: 600, graphic: 'resistor', showPinNames: false, power: false,
    defaultValue: '10kΩ', defaultFootprint: 'fp:R_0402', description: '通用电阻',
    pins: [
      { number: '1', name: '1', side: 'T', offset: 120, length: 200, type: 'passive' },
      { number: '2', name: '2', side: 'B', offset: 120, length: 200, type: 'passive' }
    ]
  },
  {
    id: 'sym:C', name: '电容', kind: '电容', prefix: 'C', width: 300, height: 400, graphic: 'capacitor', showPinNames: false, power: false,
    defaultValue: '100nF', defaultFootprint: 'fp:C_0402', description: '通用无极性电容',
    pins: [
      { number: '1', name: '1', side: 'T', offset: 150, length: 200, type: 'passive' },
      { number: '2', name: '2', side: 'B', offset: 150, length: 200, type: 'passive' }
    ]
  },
  {
    id: 'sym:LED', name: 'LED', kind: 'LED', prefix: 'D', width: 400, height: 300, graphic: 'led', showPinNames: false, power: false,
    defaultValue: '红 0603', defaultFootprint: 'fp:LED_0603', description: '发光二极管',
    pins: [
      { number: '1', name: 'A', side: 'L', offset: 150, length: 200, type: 'passive' },
      { number: '2', name: 'K', side: 'R', offset: 150, length: 200, type: 'passive' }
    ]
  },
  {
    id: 'sym:GND', name: 'GND', kind: '地', prefix: '#GND', width: 300, height: 200, graphic: 'gnd', showPinNames: false, power: true, color: '#1F5F2B',
    defaultValue: 'GND', defaultFootprint: '', description: '地符号',
    pins: [{ number: '1', name: 'GND', side: 'T', offset: 150, length: 200, type: 'power_out' }]
  },
  {
    id: 'sym:PWR', name: '电源', kind: '电源', prefix: '#PWR', width: 400, height: 200, graphic: 'power', showPinNames: false, power: true, color: '#C0392B',
    defaultValue: '+3V3', defaultFootprint: '', description: '电源符号，值即网络名',
    pins: [{ number: '1', name: '+', side: 'B', offset: 200, length: 200, type: 'power_out' }]
  },
  {
    id: 'sym:ESP32-WROOM-32E', name: 'ESP32-WROOM-32E', kind: '模块', prefix: 'U', width: 1600, height: 2000, graphic: 'box', showPinNames: true, power: false,
    defaultValue: 'ESP32-WROOM-32E', defaultFootprint: 'fp:ESP32-WROOM-32E', description: 'Wi-Fi/BLE 模块（简化 8 脚符号）',
    pins: [
      { number: '1', name: 'EN', side: 'L', offset: 500, length: 200, type: 'input' },
      { number: '2', name: 'IO0', side: 'L', offset: 900, length: 200, type: 'bidirectional' },
      { number: '3', name: 'SDA', side: 'L', offset: 1300, length: 200, type: 'bidirectional' },
      { number: '4', name: 'SCL', side: 'L', offset: 1700, length: 200, type: 'bidirectional' },
      { number: '5', name: '3V3', side: 'R', offset: 500, length: 200, type: 'power_in' },
      { number: '6', name: 'TXD0', side: 'R', offset: 900, length: 200, type: 'output' },
      { number: '7', name: 'RXD0', side: 'R', offset: 1300, length: 200, type: 'input' },
      { number: '8', name: 'GND', side: 'R', offset: 1700, length: 200, type: 'power_in' }
    ]
  },
  {
    id: 'sym:ESP32-C3-MINI-1', name: 'ESP32-C3-MINI-1', kind: '模块', prefix: 'U', width: 1600, height: 1600, graphic: 'box', showPinNames: true, power: false,
    defaultValue: 'ESP32-C3-MINI-1', defaultFootprint: 'fp:ESP32-C3-MINI-1', description: 'RISC-V Wi-Fi/BLE 模块（简化 6 脚符号）',
    pins: [
      { number: '1', name: 'EN', side: 'L', offset: 400, length: 200, type: 'input' },
      { number: '2', name: 'IO8', side: 'L', offset: 800, length: 200, type: 'bidirectional' },
      { number: '3', name: 'IO9', side: 'L', offset: 1200, length: 200, type: 'bidirectional' },
      { number: '4', name: '3V3', side: 'R', offset: 400, length: 200, type: 'power_in' },
      { number: '5', name: 'TXD', side: 'R', offset: 800, length: 200, type: 'output' },
      { number: '6', name: 'GND', side: 'R', offset: 1200, length: 200, type: 'power_in' }
    ]
  },
  {
    id: 'sym:AMS1117-3.3', name: 'AMS1117-3.3', kind: 'LDO', prefix: 'U', width: 1000, height: 800, graphic: 'box', showPinNames: true, power: false,
    defaultValue: 'AMS1117-3.3', defaultFootprint: 'fp:SOT-223', description: '3.3V 线性稳压器',
    pins: [
      { number: '3', name: 'VIN', side: 'L', offset: 300, length: 200, type: 'power_in' },
      { number: '1', name: 'GND', side: 'B', offset: 500, length: 200, type: 'power_in' },
      { number: '2', name: 'VOUT', side: 'R', offset: 300, length: 200, type: 'power_out' }
    ]
  },
  {
    id: 'sym:USB-C-16P', name: 'USB-C 16P', kind: '连接器', prefix: 'J', width: 1000, height: 1200, graphic: 'box', showPinNames: true, power: false,
    defaultValue: 'USB-C 16P', defaultFootprint: 'fp:USB-C-16P', description: 'USB Type-C 母座（简化）',
    pins: [
      { number: 'A4', name: 'VBUS', side: 'R', offset: 300, length: 200, type: 'power_out' },
      { number: 'A5', name: 'CC1', side: 'R', offset: 500, length: 200, type: 'bidirectional' },
      { number: 'A6', name: 'D+', side: 'R', offset: 700, length: 200, type: 'bidirectional' },
      { number: 'A7', name: 'D-', side: 'R', offset: 900, length: 200, type: 'bidirectional' },
      { number: 'A1', name: 'GND', side: 'B', offset: 500, length: 200, type: 'power_in' }
    ]
  },
  {
    id: 'sym:MountingHole', name: '定位孔', kind: '机械', prefix: 'H', width: 300, height: 300, graphic: 'box', showPinNames: false, power: false,
    defaultValue: 'M3', defaultFootprint: 'fp:MountingHole_3.2mm', description: '定位孔（无电气连接）',
    pins: []
  }
];

const byId = new Map(BUILTIN_SYMBOLS.map((s) => [s.id, s]));
export function getSymbol(id: string): SymbolDef {
  const s = byId.get(id) ?? registeredSymbol(id);
  if (s) return s;
  // 定义缺失（旧文件 / 未随项目保存）：生成一个无引脚的占位盒，避免界面崩溃
  const fallback: SymbolDef = { id, name: `缺失符号 ${id.replace(/^sym:(kicad:|gen:)?/, '')}`, kind: '缺失', prefix: 'U', width: 1000, height: 600, graphic: 'box', pins: [], showPinNames: false, power: false, defaultValue: '', defaultFootprint: '', description: '符号定义缺失，请重新导入或替换', source: 'missing' };
  registerSymbols([fallback]);
  console.warn(`[tracelet] 未知符号 ${id}，已用占位符号代替`);
  return fallback;
}
export function findSymbol(id: string): SymbolDef | undefined { return byId.get(id) ?? registeredSymbol(id); }
