import { describe, it, expect } from 'vitest';
import { parsePriceTiers, unitPriceAt, priceRange, DISTRIBUTORS, distributorSearch } from '../src/index.js';

describe('阶梯价解析', () => {
  it('解析 JLC 风格的阶梯价字符串', () => {
    const tiers = parsePriceTiers('1-9:0.8037,10-29:0.6671,30-99:0.5711,1000-:0.4523');
    expect(tiers).toEqual([
      { min: 1, max: 9, price: 0.8037 },
      { min: 10, max: 29, price: 0.6671 },
      { min: 30, max: 99, price: 0.5711 },
      { min: 1000, price: 0.4523 }
    ]);
  });
  it('接受单一数字与数值类型，空值返回空表', () => {
    expect(parsePriceTiers('0.955')).toEqual([{ min: 1, price: 0.955 }]);
    expect(parsePriceTiers(0.5)).toEqual([{ min: 1, price: 0.5 }]);
    expect(parsePriceTiers('')).toEqual([]);
    expect(parsePriceTiers(undefined)).toEqual([]);
    expect(parsePriceTiers(null)).toEqual([]);
  });
  it('跳过坏片段并按起订量排序', () => {
    expect(parsePriceTiers('10-29:0.6,abc,1-9:0.8,5-1:9')).toEqual([{ min: 1, max: 9, price: 0.8 }, { min: 10, max: 29, price: 0.6 }]);
  });
});

describe('按数量取单价', () => {
  const tiers = parsePriceTiers('1-9:0.8,10-99:0.6,100-:0.4');
  it('落在对应档位', () => {
    expect(unitPriceAt(tiers, 1)).toBe(0.8);
    expect(unitPriceAt(tiers, 9)).toBe(0.8);
    expect(unitPriceAt(tiers, 10)).toBe(0.6);
    expect(unitPriceAt(tiers, 5000)).toBe(0.4);
  });
  it('低于最小起订量按第一档，空表返回 undefined', () => {
    expect(unitPriceAt(parsePriceTiers('50-99:0.6,100-:0.4'), 1)).toBe(0.6);
    expect(unitPriceAt([], 10)).toBeUndefined();
  });
  it('价格区间取最低与最高档', () => {
    expect(priceRange(tiers)).toEqual({ min: 0.4, max: 0.8 });
    expect(priceRange([])).toBeUndefined();
  });
});

describe('分销商搜索深链', () => {
  it('型号里的特殊字符被转义', () => {
    expect(distributorSearch('lcsc', 'CL10B104KB8NNNC')).toBe('https://www.lcsc.com/search?q=CL10B104KB8NNNC');
    expect(distributorSearch('mouser', 'FRC0603J103 TS')).toContain('FRC0603J103%20TS');
  });
  it('未知 id 回落到比价站，所有链接都是 https', () => {
    expect(distributorSearch('nope', 'R')).toContain('octopart.com');
    for (const d of DISTRIBUTORS) expect(d.search('X')).toMatch(/^https:\/\//);
  });
});
