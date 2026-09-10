import { describe, it, expect } from 'vitest';
import { MCU_PARTS, MCU_SYMBOLS, MCU_FOOTPRINTS, allParts, getSymbol, findFootprint, searchParts } from '../src/index.js';

/** 引脚数 / 焊盘数按数据手册（模块符号不画底部散热焊盘，故符号引脚少于焊盘）。 */
const EXPECTED: Record<string, { pins: number; pads: number; lcsc?: string }> = {
  'ESP32-S3-WROOM-1-N16R8': { pins: 40, pads: 51, lcsc: 'C2913202' },
  'ESP32-S3-MINI-1-N8': { pins: 46, pads: 73, lcsc: 'C2913206' },
  'ESP32-C3-MINI-1-N4': { pins: 36, pads: 61, lcsc: 'C2838502' },
  'ESP32-C3-WROOM-02-N4': { pins: 19, pads: 27, lcsc: 'C2934560' },
  'ESP32-C6-WROOM-1-N8': { pins: 28, pads: 37, lcsc: 'C5366877' },
  'ESP32-C5-WROOM-1-N8': { pins: 28, pads: 37 },
  'ESP32-S31-WROOM-3': { pins: 92, pads: 107 },
  'ESP32-S3FH4R2': { pins: 57, pads: 73, lcsc: 'C3013940' },
  'ESP32-C3FH4': { pins: 33, pads: 42, lcsc: 'C2858491' },
  'ESP32-C6FH4': { pins: 41, pads: 50 },
  'ESP32-C5': { pins: 49, pads: 58 },
  'ESP32-H2FH4': { pins: 33, pads: 37, lcsc: 'C22470214' },
  'STM32F103C8T6': { pins: 48, pads: 48, lcsc: 'C8734' },
  'STM32F103CBT6': { pins: 48, pads: 48, lcsc: 'C8304' },
  'STM32F030F4P6': { pins: 20, pads: 20, lcsc: 'C32908' },
  'STM32G030F6P6': { pins: 20, pads: 20, lcsc: 'C724040' },
  'STM32F411CEU6': { pins: 49, pads: 49, lcsc: 'C60420' },
  'STM32L432KCU6': { pins: 33, pads: 33, lcsc: 'C1337280' }
};

describe('常用 MCU 库', () => {
  it('12 个零件都在内置库里，型号 / LCSC 不丢', () => {
    expect(MCU_PARTS).toHaveLength(18);
    const builtin = new Map(allParts().map((p) => [p.mpn, p]));
    for (const [mpn, want] of Object.entries(EXPECTED)) {
      const part = builtin.get(mpn);
      expect(part, mpn).toBeTruthy();
      expect(part!.lcsc ?? undefined, mpn).toBe(want.lcsc);
      expect(part!.category === 'microcontroller' || part!.category === 'communication-module').toBe(true);
    }
  });

  it('每个零件的符号存在、引脚数对得上，且每个引脚都能在封装里找到焊盘', () => {
    for (const part of MCU_PARTS) {
      const sym = getSymbol(part.symbolId);
      expect(sym.source, part.mpn).not.toBe('missing');
      expect(sym.pins.length, `${part.mpn} 引脚数`).toBe(EXPECTED[part.mpn].pins);
      const fp = findFootprint(part.footprintId);
      expect(fp, `${part.mpn} 封装`).toBeTruthy();
      expect(fp!.pads.length, `${part.mpn} 焊盘数`).toBe(EXPECTED[part.mpn].pads);
      const pads = new Set(fp!.pads.map((p) => p.number));
      const missing = sym.pins.filter((p) => p.type !== 'no_connect' && !pads.has(p.number)).map((p) => p.number);
      expect(missing, `${part.mpn} 缺焊盘`).toEqual([]);
    }
  });

  it('ESP32-S3 裸片的关键引脚与数据手册一致（QFN-56，最后一脚是散热焊盘）', () => {
    const pins = new Map(getSymbol('sym:ESP32-S3').pins.map((p) => [p.number, p.name]));
    expect(pins.get('2')).toBe('VDD3P3');
    expect(pins.get('4')).toBe('CHIP_PU');
    expect(pins.get('5')).toBe('IO0');
    expect(pins.get('57')).toBe('GND');
  });

  it('ESP32-S3-WROOM-1 的关键引脚与数据手册一致', () => {
    const pins = new Map(getSymbol('sym:ESP32-S3-WROOM-1').pins.map((p) => [p.number, p.name]));
    expect(pins.get('1')).toBe('GND');
    expect(pins.get('2')).toBe('3V3');
    expect(pins.get('3')).toBe('EN');
    expect(pins.get('27')).toBe('IO0');       // BOOT
    expect(pins.get('37')).toBe('IO43/U0TXD');
    expect(pins.get('36')).toBe('IO44/U0RXD');
    expect(pins.get('13')).toBe('IO19/D-');
    expect(pins.get('14')).toBe('IO20/D+');
  });

  it('STM32F103C8T6 的关键引脚与数据手册一致（SWD / BOOT0 / 晶振）', () => {
    const pins = new Map(getSymbol('sym:STM32F103C8T6').pins.map((p) => [p.number, p.name]));
    expect(pins.get('1')).toBe('VBAT');
    expect(pins.get('5')).toBe('PD0');
    expect(pins.get('7')).toBe('NRST');
    expect(pins.get('34')).toBe('PA13');      // SWDIO
    expect(pins.get('37')).toBe('PA14');      // SWCLK
    expect(pins.get('44')).toBe('BOOT0');
    expect(pins.get('48')).toBe('VDD');
  });

  it('封装 / 符号 id 不与内置简化件冲突，且能被搜索命中', () => {
    const ids = [...MCU_SYMBOLS.map((s) => s.id), ...MCU_FOOTPRINTS.map((f) => f.id)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(searchParts('c6').some((p) => p.mpn.startsWith('ESP32-C6'))).toBe(true);
    expect(searchParts('stm32 m4').some((p) => p.mpn === 'STM32F411CEU6')).toBe(true);
    expect(searchParts('单片机', allParts(), 'microcontroller').length).toBeGreaterThanOrEqual(11);
    // 同一颗芯片有「模块」和「裸片」两种形态，各自独立成条目
    expect(MCU_PARTS.filter((p) => p.kind === '模块').length).toBe(7);
    expect(MCU_PARTS.filter((p) => p.kind === '芯片').length).toBe(5);
  });
});
