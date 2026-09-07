/**
 * 元件报价：阶梯价解析 / 取价，以及分销商搜索深链。
 * 只做纯数据处理，不发任何请求——在线查询在 Web 端（apps/web/src/store/partPricing.ts），
 * 这样内核保持无网络依赖，CLI / 测试也能复用同一套解析与计价规则。
 */

/** 一档阶梯价：min ≤ 数量 ≤ max（max 缺省表示"及以上"）时的单价。 */
export interface PriceTier { min: number; max?: number; price: number }

/** 某个分销商对某个型号的报价快照。价格仅供参考，以分销商下单页为准。 */
export interface PartOffer {
  /** 分销商 id，见 DISTRIBUTORS */
  vendor: string;
  /** 分销商内部编号（如 LCSC 的 C529330） */
  sku?: string;
  /** 货币代码（ISO 4217，如 USD / CNY） */
  currency: string;
  stock?: number;
  tiers: PriceTier[];
  /** 该型号在分销商站点的链接 */
  url?: string;
  /** 抓取时间（毫秒时间戳），用于显示"数据更新于" */
  fetchedAt: number;
  /** 分销商侧的补充标记（如 JLC 基础库 / 优选库） */
  note?: string;
}

/**
 * 解析阶梯价字符串："1-9:0.8037,10-29:0.6671,1000-:0.4523"。
 * 也接受单一数字（视为 1 起订的单档），无法解析的片段跳过。
 */
export function parsePriceTiers(input: string | number | null | undefined): PriceTier[] {
  if (input == null) return [];
  if (typeof input === 'number') return Number.isFinite(input) && input >= 0 ? [{ min: 1, price: input }] : [];
  const text = input.trim();
  if (!text) return [];
  const single = Number(text);
  if (Number.isFinite(single) && single >= 0) return [{ min: 1, price: single }];
  const tiers: PriceTier[] = [];
  for (const part of text.split(',')) {
    const m = /^\s*(\d+)\s*-\s*(\d*)\s*:\s*([\d.]+)\s*$/.exec(part);
    if (!m) continue;
    const min = Number(m[1]), max = m[2] ? Number(m[2]) : undefined, price = Number(m[3]);
    if (!Number.isFinite(min) || !Number.isFinite(price) || price < 0) continue;
    if (max != null && (!Number.isFinite(max) || max < min)) continue;
    tiers.push(max == null ? { min, price } : { min, max, price });
  }
  return tiers.sort((a, b) => a.min - b.min);
}

/** 指定数量的单价：低于第一档按第一档，高于最后一档按最后一档。 */
export function unitPriceAt(tiers: PriceTier[], qty = 1): number | undefined {
  if (!tiers.length) return undefined;
  const hit = tiers.find((t) => qty >= t.min && (t.max == null || qty <= t.max));
  if (hit) return hit.price;
  return qty < tiers[0].min ? tiers[0].price : tiers[tiers.length - 1].price;
}

/** 阶梯价的展示区间，如 "0.4523 – 0.8037"（单档时只返回一个数）。 */
export function priceRange(tiers: PriceTier[]): { min: number; max: number } | undefined {
  if (!tiers.length) return undefined;
  const ps = tiers.map((t) => t.price);
  return { min: Math.min(...ps), max: Math.max(...ps) };
}

/** 分销商 / 商城：只提供搜索深链（用户点击后新窗口打开），不做后台抓取。 */
export interface Distributor { id: string; name: string; region: string; currency: string; search(query: string): string }

export const DISTRIBUTORS: Distributor[] = [
  { id: 'szlcsc', name: '立创商城', region: '中国大陆', currency: 'CNY', search: (q) => `https://so.szlcsc.com/global.html?k=${encodeURIComponent(q)}` },
  { id: 'lcsc', name: 'LCSC', region: '全球', currency: 'USD', search: (q) => `https://www.lcsc.com/search?q=${encodeURIComponent(q)}` },
  { id: 'jlcpcb', name: 'JLCPCB 元件库', region: '全球（贴片代购）', currency: 'USD', search: (q) => `https://jlcpcb.com/parts/componentSearch?searchTxt=${encodeURIComponent(q)}` },
  { id: 'digikey', name: 'Digi-Key', region: '美国 / 全球', currency: 'USD', search: (q) => `https://www.digikey.com/en/products/result?keywords=${encodeURIComponent(q)}` },
  { id: 'mouser', name: 'Mouser', region: '美国 / 全球', currency: 'USD', search: (q) => `https://www.mouser.com/c/?q=${encodeURIComponent(q)}` },
  { id: 'farnell', name: 'Farnell', region: '欧洲', currency: 'GBP', search: (q) => `https://uk.farnell.com/search?st=${encodeURIComponent(q)}` },
  { id: 'tme', name: 'TME', region: '欧洲', currency: 'EUR', search: (q) => `https://www.tme.eu/en/katalog/?search=${encodeURIComponent(q)}` },
  { id: 'octopart', name: 'Octopart', region: '全球比价', currency: 'USD', search: (q) => `https://octopart.com/search?q=${encodeURIComponent(q)}` }
];

/** 按 id 取搜索链接；未知 id 返回 Octopart 比价页。 */
export function distributorSearch(id: string, query: string): string {
  return (DISTRIBUTORS.find((d) => d.id === id) ?? DISTRIBUTORS[DISTRIBUTORS.length - 1]).search(query);
}
