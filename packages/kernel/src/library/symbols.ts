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
    id: 'sym:GND', name: 'GND', kind: '地', prefix: '#GND', width: 300, height: 200, graphic: 'gnd', showPinNames: false, power: true, color: '#800000',
    defaultValue: 'GND', defaultFootprint: '', description: '地符号',
    pins: [{ number: '1', name: 'GND', side: 'T', offset: 150, length: 200, type: 'power_out' }]
  },
  {
    id: 'sym:PWR', name: '电源', kind: '电源', prefix: '#PWR', width: 400, height: 200, graphic: 'power', showPinNames: false, power: true, color: '#800000',
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
  },
  // ---- 常用分立器件（矢量图形，单位 mil，栅格 100）----
  {
    id: 'sym:L', name: '电感', kind: '电感', prefix: 'L', width: 200, height: 600, graphic: 'shapes', showPinNames: false, power: false,
    defaultValue: '10uH', defaultFootprint: 'fp:gen:L_0805_2012Metric', description: '电感 / 磁珠',
    shapes: [{ kind: 'arc', start: { x: 100, y: 0 }, mid: { x: 175, y: 75 }, end: { x: 100, y: 150 }, width: 12 }, { kind: 'arc', start: { x: 100, y: 150 }, mid: { x: 175, y: 225 }, end: { x: 100, y: 300 }, width: 12 }, { kind: 'arc', start: { x: 100, y: 300 }, mid: { x: 175, y: 375 }, end: { x: 100, y: 450 }, width: 12 }, { kind: 'arc', start: { x: 100, y: 450 }, mid: { x: 175, y: 525 }, end: { x: 100, y: 600 }, width: 12 }],
    pins: [{ number: '1', name: '1', side: 'T', offset: 100, length: 200, type: 'passive' }, { number: '2', name: '2', side: 'B', offset: 100, length: 200, type: 'passive' }]
  },
  {
    id: 'sym:D', name: '二极管', kind: '二极管', prefix: 'D', width: 400, height: 300, graphic: 'shapes', showPinNames: false, power: false,
    defaultValue: '1N4148W', defaultFootprint: 'fp:gen:SOD-123', description: '通用二极管（A 阳极 → K 阴极）',
    shapes: [{ kind: 'polyline', fill: 'none', points: [{ x: 0, y: 150 }, { x: 120, y: 150 }], width: 12 }, { kind: 'polyline', points: [{ x: 120, y: 50 }, { x: 280, y: 150 }, { x: 120, y: 250 }, { x: 120, y: 50 }], fill: 'background', width: 12 }, { kind: 'polyline', fill: 'none', points: [{ x: 280, y: 50 }, { x: 280, y: 250 }], width: 14 }, { kind: 'polyline', fill: 'none', points: [{ x: 280, y: 150 }, { x: 400, y: 150 }], width: 12 }],
    pins: [{ number: '1', name: 'K', side: 'R', offset: 150, length: 200, type: 'passive' }, { number: '2', name: 'A', side: 'L', offset: 150, length: 200, type: 'passive' }]
  },
  {
    id: 'sym:D_Schottky', name: '肖特基二极管', kind: '二极管', prefix: 'D', width: 400, height: 300, graphic: 'shapes', showPinNames: false, power: false,
    defaultValue: 'SS34', defaultFootprint: 'fp:gen:SMA', description: '肖特基二极管（A → K）',
    shapes: [{ kind: 'polyline', fill: 'none', points: [{ x: 0, y: 150 }, { x: 120, y: 150 }], width: 12 }, { kind: 'polyline', points: [{ x: 120, y: 50 }, { x: 280, y: 150 }, { x: 120, y: 250 }, { x: 120, y: 50 }], fill: 'background', width: 12 }, { kind: 'polyline', fill: 'none', points: [{ x: 240, y: 80 }, { x: 240, y: 50 }, { x: 280, y: 50 }, { x: 280, y: 250 }, { x: 320, y: 250 }, { x: 320, y: 220 }], width: 14 }, { kind: 'polyline', fill: 'none', points: [{ x: 280, y: 150 }, { x: 400, y: 150 }], width: 12 }],
    pins: [{ number: '1', name: 'K', side: 'R', offset: 150, length: 200, type: 'passive' }, { number: '2', name: 'A', side: 'L', offset: 150, length: 200, type: 'passive' }]
  },
  {
    id: 'sym:D_Zener', name: '稳压二极管', kind: '二极管', prefix: 'D', width: 400, height: 300, graphic: 'shapes', showPinNames: false, power: false,
    defaultValue: '5.1V', defaultFootprint: 'fp:gen:SOD-123', description: '稳压（齐纳）二极管',
    shapes: [{ kind: 'polyline', fill: 'none', points: [{ x: 0, y: 150 }, { x: 120, y: 150 }], width: 12 }, { kind: 'polyline', points: [{ x: 120, y: 50 }, { x: 280, y: 150 }, { x: 120, y: 250 }, { x: 120, y: 50 }], fill: 'background', width: 12 }, { kind: 'polyline', fill: 'none', points: [{ x: 250, y: 50 }, { x: 280, y: 50 }, { x: 280, y: 250 }, { x: 310, y: 250 }], width: 14 }, { kind: 'polyline', fill: 'none', points: [{ x: 280, y: 150 }, { x: 400, y: 150 }], width: 12 }],
    pins: [{ number: '1', name: 'K', side: 'R', offset: 150, length: 200, type: 'passive' }, { number: '2', name: 'A', side: 'L', offset: 150, length: 200, type: 'passive' }]
  },
  {
    id: 'sym:Q_NPN', name: 'NPN 三极管', kind: '三极管', prefix: 'Q', width: 400, height: 500, graphic: 'shapes', showPinNames: true, power: false,
    defaultValue: 'SS8050', defaultFootprint: 'fp:gen:SOT-23', description: 'NPN（B 基极 / C 集电极 / E 发射极），SOT-23 脚序 1B 2E 3C',
    shapes: [{ kind: 'circle', fill: 'none', c: { x: 220, y: 250 }, r: 180, width: 10 }, { kind: 'polyline', fill: 'none', points: [{ x: 0, y: 250 }, { x: 140, y: 250 }], width: 12 }, { kind: 'polyline', fill: 'none', points: [{ x: 140, y: 130 }, { x: 140, y: 370 }], width: 20 }, { kind: 'polyline', fill: 'none', points: [{ x: 140, y: 200 }, { x: 320, y: 60 }, { x: 320, y: 0 }], width: 12 }, { kind: 'polyline', fill: 'none', points: [{ x: 140, y: 300 }, { x: 320, y: 440 }, { x: 320, y: 500 }], width: 12 }, { kind: 'polyline', points: [{ x: 320, y: 440 }, { x: 250, y: 430 }, { x: 290, y: 380 }, { x: 320, y: 440 }], fill: 'outline', width: 8 }],
    pins: [{ number: '1', name: 'B', side: 'L', offset: 250, length: 200, type: 'input' }, { number: '2', name: 'E', side: 'B', offset: 320, length: 200, type: 'passive' }, { number: '3', name: 'C', side: 'T', offset: 320, length: 200, type: 'passive' }]
  },
  {
    id: 'sym:Q_PNP', name: 'PNP 三极管', kind: '三极管', prefix: 'Q', width: 400, height: 500, graphic: 'shapes', showPinNames: true, power: false,
    defaultValue: 'SS8550', defaultFootprint: 'fp:gen:SOT-23', description: 'PNP，SOT-23 脚序 1B 2E 3C',
    shapes: [{ kind: 'circle', fill: 'none', c: { x: 220, y: 250 }, r: 180, width: 10 }, { kind: 'polyline', fill: 'none', points: [{ x: 0, y: 250 }, { x: 140, y: 250 }], width: 12 }, { kind: 'polyline', fill: 'none', points: [{ x: 140, y: 130 }, { x: 140, y: 370 }], width: 20 }, { kind: 'polyline', fill: 'none', points: [{ x: 140, y: 200 }, { x: 320, y: 60 }, { x: 320, y: 0 }], width: 12 }, { kind: 'polyline', fill: 'none', points: [{ x: 140, y: 300 }, { x: 320, y: 440 }, { x: 320, y: 500 }], width: 12 }, { kind: 'polyline', points: [{ x: 140, y: 300 }, { x: 210, y: 310 }, { x: 170, y: 360 }, { x: 140, y: 300 }], fill: 'outline', width: 8 }],
    pins: [{ number: '1', name: 'B', side: 'L', offset: 250, length: 200, type: 'input' }, { number: '2', name: 'E', side: 'B', offset: 320, length: 200, type: 'passive' }, { number: '3', name: 'C', side: 'T', offset: 320, length: 200, type: 'passive' }]
  },
  {
    id: 'sym:Q_NMOS', name: 'N-MOS', kind: 'MOS 管', prefix: 'Q', width: 400, height: 500, graphic: 'shapes', showPinNames: true, power: false,
    defaultValue: 'AO3400A', defaultFootprint: 'fp:gen:SOT-23', description: 'N 沟道 MOSFET（G 栅 / D 漏 / S 源），SOT-23 脚序 1G 2S 3D',
    shapes: [{ kind: 'circle', fill: 'none', c: { x: 220, y: 250 }, r: 180, width: 10 }, { kind: 'polyline', fill: 'none', points: [{ x: 0, y: 250 }, { x: 110, y: 250 }, { x: 110, y: 130 }, { x: 110, y: 370 }], width: 12 }, { kind: 'polyline', fill: 'none', points: [{ x: 150, y: 120 }, { x: 150, y: 190 }], width: 18 }, { kind: 'polyline', fill: 'none', points: [{ x: 150, y: 215 }, { x: 150, y: 285 }], width: 18 }, { kind: 'polyline', fill: 'none', points: [{ x: 150, y: 310 }, { x: 150, y: 380 }], width: 18 }, { kind: 'polyline', fill: 'none', points: [{ x: 150, y: 155 }, { x: 320, y: 155 }, { x: 320, y: 0 }], width: 12 }, { kind: 'polyline', fill: 'none', points: [{ x: 150, y: 345 }, { x: 320, y: 345 }, { x: 320, y: 500 }], width: 12 }, { kind: 'polyline', fill: 'none', points: [{ x: 150, y: 250 }, { x: 320, y: 250 }, { x: 320, y: 345 }], width: 12 }, { kind: 'polyline', points: [{ x: 150, y: 250 }, { x: 220, y: 215 }, { x: 220, y: 285 }, { x: 150, y: 250 }], fill: 'outline', width: 8 }],
    pins: [{ number: '1', name: 'G', side: 'L', offset: 250, length: 200, type: 'input' }, { number: '2', name: 'S', side: 'B', offset: 320, length: 200, type: 'passive' }, { number: '3', name: 'D', side: 'T', offset: 320, length: 200, type: 'passive' }]
  },
  {
    id: 'sym:Q_PMOS', name: 'P-MOS', kind: 'MOS 管', prefix: 'Q', width: 400, height: 500, graphic: 'shapes', showPinNames: true, power: false,
    defaultValue: 'AO3401A', defaultFootprint: 'fp:gen:SOT-23', description: 'P 沟道 MOSFET，SOT-23 脚序 1G 2S 3D',
    shapes: [{ kind: 'circle', fill: 'none', c: { x: 220, y: 250 }, r: 180, width: 10 }, { kind: 'polyline', fill: 'none', points: [{ x: 0, y: 250 }, { x: 110, y: 250 }, { x: 110, y: 130 }, { x: 110, y: 370 }], width: 12 }, { kind: 'polyline', fill: 'none', points: [{ x: 150, y: 120 }, { x: 150, y: 190 }], width: 18 }, { kind: 'polyline', fill: 'none', points: [{ x: 150, y: 215 }, { x: 150, y: 285 }], width: 18 }, { kind: 'polyline', fill: 'none', points: [{ x: 150, y: 310 }, { x: 150, y: 380 }], width: 18 }, { kind: 'polyline', fill: 'none', points: [{ x: 150, y: 155 }, { x: 320, y: 155 }, { x: 320, y: 0 }], width: 12 }, { kind: 'polyline', fill: 'none', points: [{ x: 150, y: 345 }, { x: 320, y: 345 }, { x: 320, y: 500 }], width: 12 }, { kind: 'polyline', fill: 'none', points: [{ x: 150, y: 250 }, { x: 320, y: 250 }, { x: 320, y: 345 }], width: 12 }, { kind: 'polyline', points: [{ x: 220, y: 250 }, { x: 150, y: 215 }, { x: 150, y: 285 }, { x: 220, y: 250 }], fill: 'outline', width: 8 }],
    pins: [{ number: '1', name: 'G', side: 'L', offset: 250, length: 200, type: 'input' }, { number: '2', name: 'S', side: 'B', offset: 320, length: 200, type: 'passive' }, { number: '3', name: 'D', side: 'T', offset: 320, length: 200, type: 'passive' }]
  },
  {
    id: 'sym:SW', name: '轻触开关', kind: '开关', prefix: 'SW', width: 400, height: 200, graphic: 'shapes', showPinNames: false, power: false,
    defaultValue: 'TS-1187A', defaultFootprint: 'fp:gen:SW_SMD_3x4', description: '轻触按键（两端）',
    shapes: [{ kind: 'polyline', fill: 'none', points: [{ x: 0, y: 100 }, { x: 100, y: 100 }], width: 12 }, { kind: 'polyline', fill: 'none', points: [{ x: 300, y: 100 }, { x: 400, y: 100 }], width: 12 }, { kind: 'circle', fill: 'none', c: { x: 100, y: 100 }, r: 20, width: 10 }, { kind: 'circle', fill: 'none', c: { x: 300, y: 100 }, r: 20, width: 10 }, { kind: 'polyline', fill: 'none', points: [{ x: 110, y: 90 }, { x: 290, y: 20 }], width: 12 }, { kind: 'polyline', fill: 'none', points: [{ x: 200, y: 55 }, { x: 200, y: 0 }], width: 12 }],
    pins: [{ number: '1', name: '1', side: 'L', offset: 100, length: 200, type: 'passive' }, { number: '2', name: '2', side: 'R', offset: 100, length: 200, type: 'passive' }]
  },
  {
    id: 'sym:Y', name: '晶振', kind: '晶振', prefix: 'Y', width: 400, height: 300, graphic: 'shapes', showPinNames: false, power: false,
    defaultValue: '8MHz', defaultFootprint: 'fp:gen:Crystal_SMD_3225-4Pin', description: '两脚晶振（四脚封装的 2/4 脚接地）',
    shapes: [{ kind: 'polyline', fill: 'none', points: [{ x: 0, y: 150 }, { x: 120, y: 150 }], width: 12 }, { kind: 'polyline', fill: 'none', points: [{ x: 120, y: 60 }, { x: 120, y: 240 }], width: 14 }, { kind: 'rect', a: { x: 160, y: 40 }, b: { x: 240, y: 260 }, fill: 'background', width: 12 }, { kind: 'polyline', fill: 'none', points: [{ x: 280, y: 60 }, { x: 280, y: 240 }], width: 14 }, { kind: 'polyline', fill: 'none', points: [{ x: 280, y: 150 }, { x: 400, y: 150 }], width: 12 }],
    pins: [{ number: '1', name: '1', side: 'L', offset: 150, length: 200, type: 'passive' }, { number: '2', name: '2', side: 'R', offset: 150, length: 200, type: 'passive' }]
  },
  {
    id: 'sym:F', name: '保险丝', kind: '保护', prefix: 'F', width: 400, height: 200, graphic: 'shapes', showPinNames: false, power: false,
    defaultValue: '1A', defaultFootprint: 'fp:gen:F_1206_3216Metric', description: '保险丝 / 自恢复保险丝',
    shapes: [{ kind: 'rect', a: { x: 0, y: 60 }, b: { x: 400, y: 140 }, fill: 'background', width: 12 }, { kind: 'polyline', fill: 'none', points: [{ x: 0, y: 100 }, { x: 400, y: 100 }], width: 12 }],
    pins: [{ number: '1', name: '1', side: 'L', offset: 100, length: 200, type: 'passive' }, { number: '2', name: '2', side: 'R', offset: 100, length: 200, type: 'passive' }]
  },
  {
    id: 'sym:FB', name: '磁珠', kind: '电感', prefix: 'FB', width: 400, height: 200, graphic: 'shapes', showPinNames: false, power: false,
    defaultValue: '600Ω@100MHz', defaultFootprint: 'fp:gen:L_0603_1608Metric', description: '铁氧体磁珠',
    shapes: [{ kind: 'rect', a: { x: 100, y: 40 }, b: { x: 300, y: 160 }, fill: 'background', width: 12 }, { kind: 'polyline', fill: 'none', points: [{ x: 0, y: 100 }, { x: 100, y: 100 }], width: 12 }, { kind: 'polyline', fill: 'none', points: [{ x: 300, y: 100 }, { x: 400, y: 100 }], width: 12 }, { kind: 'polyline', fill: 'none', points: [{ x: 140, y: 140 }, { x: 260, y: 60 }], width: 10 }],
    pins: [{ number: '1', name: '1', side: 'L', offset: 100, length: 200, type: 'passive' }, { number: '2', name: '2', side: 'R', offset: 100, length: 200, type: 'passive' }]
  },
  {
    id: 'sym:C_POL', name: '电解电容', kind: '电容', prefix: 'C', width: 300, height: 400, graphic: 'shapes', showPinNames: false, power: false,
    defaultValue: '100uF', defaultFootprint: 'fp:gen:CP_Elec_6.3x5.4', description: '有极性电容（1 正极 / 2 负极）',
    shapes: [{ kind: 'polyline', fill: 'none', points: [{ x: 150, y: 0 }, { x: 150, y: 140 }], width: 12 }, { kind: 'polyline', fill: 'none', points: [{ x: 30, y: 140 }, { x: 270, y: 140 }], width: 16 }, { kind: 'rect', a: { x: 30, y: 200 }, b: { x: 270, y: 260 }, fill: 'outline', width: 8 }, { kind: 'polyline', fill: 'none', points: [{ x: 150, y: 260 }, { x: 150, y: 400 }], width: 12 }, { kind: 'polyline', fill: 'none', points: [{ x: 40, y: 60 }, { x: 80, y: 60 }], width: 8 }, { kind: 'polyline', fill: 'none', points: [{ x: 60, y: 40 }, { x: 60, y: 80 }], width: 8 }],
    pins: [{ number: '1', name: '+', side: 'T', offset: 150, length: 200, type: 'passive' }, { number: '2', name: '-', side: 'B', offset: 150, length: 200, type: 'passive' }]
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
