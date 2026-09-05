import type { FootprintDef, PadDef } from '../model/board.js';
import { registeredFootprint } from './registry.js';

function twoPad(id: string, name: string, pitch: number, pw: number, ph: number, bw: number, bh: number, height: number, desc: string): FootprintDef {
  return {
    id, name, body: { w: bw, h: bh }, height, description: desc,
    pads: [
      { number: '1', x: -pitch / 2, y: 0, w: pw, h: ph, shape: 'roundrect', drill: 0, npth: false },
      { number: '2', x: pitch / 2, y: 0, w: pw, h: ph, shape: 'roundrect', drill: 0, npth: false }
    ]
  };
}

function dualRow(numbers: string[], pitch: number, span: number, pw: number, ph: number): PadDef[] {
  const half = numbers.length / 2, pads: PadDef[] = [];
  for (let i = 0; i < half; i++) {
    const y = (i - (half - 1) / 2) * pitch;
    pads.push({ number: numbers[i], x: -span / 2, y, w: pw, h: ph, shape: 'rect', drill: 0, npth: false });
    pads.push({ number: numbers[i + half], x: span / 2, y, w: pw, h: ph, shape: 'rect', drill: 0, npth: false });
  }
  return pads;
}

export const BUILTIN_FOOTPRINTS: FootprintDef[] = [
  twoPad('fp:R_0402', 'R_0402', 0.96, 0.56, 0.62, 1.0, 0.5, 0.35, '0402 电阻'),
  twoPad('fp:R_0603', 'R_0603', 1.5, 0.8, 0.95, 1.6, 0.8, 0.45, '0603 电阻'),
  twoPad('fp:R_0805', 'R_0805', 1.9, 1.0, 1.25, 2.0, 1.25, 0.5, '0805 电阻'),
  twoPad('fp:C_0402', 'C_0402', 0.96, 0.56, 0.62, 1.0, 0.5, 0.5, '0402 电容'),
  twoPad('fp:C_0603', 'C_0603', 1.5, 0.8, 0.95, 1.6, 0.8, 0.8, '0603 电容'),
  twoPad('fp:C_0805', 'C_0805', 1.9, 1.0, 1.25, 2.0, 1.25, 1.0, '0805 电容'),
  twoPad('fp:LED_0603', 'LED_0603', 1.5, 0.8, 0.9, 1.6, 0.8, 0.6, '0603 LED'),
  twoPad('fp:LED_0805', 'LED_0805', 1.9, 1.0, 1.2, 2.0, 1.25, 0.8, '0805 LED'),
  {
    id: 'fp:ESP32-WROOM-32E', name: 'XCVR_ESP32-WROOM-32E', body: { w: 18, h: 25.5 }, height: 3.1, description: 'ESP32-WROOM-32E 模块（简化 8 焊盘）',
    pads: dualRow(['1', '2', '3', '4', '5', '6', '7', '8'], 2.54, 17, 1.5, 0.9)
  },
  {
    id: 'fp:ESP32-C3-MINI-1', name: 'ESP32-C3-MINI-1', body: { w: 13.2, h: 16.6 }, height: 2.4, description: 'ESP32-C3-MINI-1 模块（简化 6 焊盘）',
    pads: dualRow(['1', '2', '3', '4', '5', '6'], 2.0, 12.4, 1.2, 0.8)
  },
  {
    id: 'fp:SOT-223', name: 'SOT-223', body: { w: 6.5, h: 3.5 }, height: 1.8, description: 'SOT-223',
    pads: [
      { number: '1', x: -2.3, y: 3.1, w: 1.0, h: 2.0, shape: 'rect', drill: 0, npth: false },
      { number: '2', x: 0, y: 3.1, w: 1.0, h: 2.0, shape: 'rect', drill: 0, npth: false },
      { number: '3', x: 2.3, y: 3.1, w: 1.0, h: 2.0, shape: 'rect', drill: 0, npth: false },
      { number: '2', x: 0, y: -3.1, w: 3.6, h: 2.0, shape: 'rect', drill: 0, npth: false }
    ]
  },
  {
    id: 'fp:USB-C-16P', name: 'USB-C-16P', body: { w: 9.0, h: 7.4 }, height: 3.2, description: 'USB-C 16P 母座（简化）',
    pads: [
      { number: 'A1', x: -3.25, y: -2.0, w: 0.6, h: 1.2, shape: 'rect', drill: 0, npth: false },
      { number: 'A4', x: -2.25, y: -2.0, w: 0.6, h: 1.2, shape: 'rect', drill: 0, npth: false },
      { number: 'A5', x: -1.25, y: -2.0, w: 0.6, h: 1.2, shape: 'rect', drill: 0, npth: false },
      { number: 'A6', x: -0.25, y: -2.0, w: 0.6, h: 1.2, shape: 'rect', drill: 0, npth: false },
      { number: 'A7', x: 0.75, y: -2.0, w: 0.6, h: 1.2, shape: 'rect', drill: 0, npth: false },
      { number: 'S1', x: -4.32, y: 0.5, w: 1.0, h: 1.8, shape: 'oval', drill: 0.6, npth: false },
      { number: 'S1', x: 4.32, y: 0.5, w: 1.0, h: 1.8, shape: 'oval', drill: 0.6, npth: false }
    ]
  },
  {
    id: 'fp:MountingHole_3.2mm', name: 'MountingHole_3.2mm_M3', body: { w: 6.4, h: 6.4 }, height: 0, description: 'M3 定位孔（非金属化）',
    pads: [{ number: '1', x: 0, y: 0, w: 3.2, h: 3.2, shape: 'circle', drill: 3.2, npth: true }]
  },
  {
    id: 'fp:MountingHole_2.2mm', name: 'MountingHole_2.2mm_M2', body: { w: 4.4, h: 4.4 }, height: 0, description: 'M2 定位孔（非金属化）',
    pads: [{ number: '1', x: 0, y: 0, w: 2.2, h: 2.2, shape: 'circle', drill: 2.2, npth: true }]
  }
];

const byId = new Map(BUILTIN_FOOTPRINTS.map((f) => [f.id, f]));
export function getFootprint(id: string): FootprintDef {
  const f = byId.get(id) ?? registeredFootprint(id);
  if (!f) throw new Error(`未知封装: ${id}`);
  return f;
}
export function findFootprint(id: string): FootprintDef | undefined { return byId.get(id) ?? registeredFootprint(id); }
