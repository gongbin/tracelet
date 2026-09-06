import { describe, it, expect } from 'vitest';
import { BUILTIN_PARTS, allParts, registerParts, searchParts, parsePartsCsv, parsePartsJson, partsToCsv, getSymbol, findFootprint, findSymbol, registeredSymbol } from '../src/index.js';

describe('零件库', () => {
  it('内置基础库：每个零件都有可用符号与封装，分类合法', () => {
    expect(BUILTIN_PARTS.length).toBeGreaterThan(100);
    const bad: string[] = [];
    for (const p of BUILTIN_PARTS) {
      if (!(findSymbol(p.symbolId) ?? registeredSymbol(p.symbolId))) bad.push(`${p.mpn}: 符号 ${p.symbolId}`);
      if (p.footprintId && !findFootprint(p.footprintId)) bad.push(`${p.mpn}: 封装 ${p.footprintId}`);
      if (!p.category) bad.push(`${p.mpn}: 无分类`);
    }
    expect(bad).toEqual([]);
    expect(searchParts('10k 0402')[0].mpn).toBe('0402WGF1002TCE');
    expect(searchParts('ch340').length).toBeGreaterThan(0);
    expect(getSymbol(searchParts('ch340')[0].symbolId).pins.length).toBe(16);
  });
  it('CSV 导入：中英文列名、自动分类 / 符号 / 封装，引脚列生成 IC 框符号', () => {
    const csv = ['型号,厂商,描述,封装,引脚,LCSC', 'STM32G030F6P6,ST,ARM Cortex-M0+ MCU 32KB Flash,TSSOP-20,20,C529327', 'AO3407A,AOS,P-MOS -30V -4.1A,SOT-23,3,', 'GRM188R61A106KE69D,Murata,10uF 10V X5R 电容,0603,,', ',,缺型号的行,0603,,', 'CP2102N-A02-GQFN28,SiLabs,USB转UART桥,QFN-28,1:DCD;2:RI;3:GND;4:D+;5:D-;6:VDD;7:REGIN;8:VBUS,'].join('\n');
    const r = parsePartsCsv(csv);
    expect(r.parts.length).toBe(4); expect(r.errors.length).toBe(1);
    const mcu = r.parts.find((p) => p.mpn === 'STM32G030F6P6')!;
    expect(mcu.category).toBe('microcontroller'); expect(mcu.lcsc).toBe('C529327'); expect(mcu.footprintId).toMatch(/TSSOP-20/);
    expect(getSymbol(mcu.symbolId).pins.length).toBe(20);
    const mos = r.parts.find((p) => p.mpn === 'AO3407A')!; expect(mos.symbolId).toBe('sym:Q_PMOS'); expect(mos.footprintId).toMatch(/SOT-23/);
    const cap = r.parts.find((p) => p.mpn.startsWith('GRM'))!; expect(cap.category).toBe('capacitor'); expect(cap.symbolId).toBe('sym:C'); expect(cap.footprintId).toMatch(/C_0603/);
    const cp = r.parts.find((p) => p.mpn.startsWith('CP2102'))!; const sym = getSymbol(cp.symbolId); expect(sym.pins.map((x) => x.name).slice(0, 3)).toEqual(['DCD', 'RI', 'GND']);
    registerParts(r.parts, 'user');
    expect(allParts().some((p) => p.id === mcu.id && p.source === 'user')).toBe(true);
    expect(searchParts('stm32g030')[0].mpn).toBe('STM32G030F6P6');
    // 往返：导出 CSV 再导入
    const again = parsePartsCsv(partsToCsv(r.parts)); expect(again.parts.length).toBe(4);
    registerParts([], 'user');
  });
  it('JSON 导入：{ version, parts } 与纯数组都接受', () => {
    const r = parsePartsJson(JSON.stringify({ version: '2026-09-06', parts: [{ mpn: 'NE555', maker: 'TI', description: '定时器', package: 'SOIC-8', pinCount: 8 }] }));
    expect(r.version).toBe('2026-09-06'); expect(r.parts.length).toBe(1); expect(r.parts[0].footprintId).toMatch(/SOIC-8/);
    expect(parsePartsJson('[{"mpn":"X","description":"电阻 1k","package":"0402"}]').parts[0].symbolId).toBe('sym:R');
    expect(parsePartsJson('nope').errors.length).toBe(1);
  });
});
