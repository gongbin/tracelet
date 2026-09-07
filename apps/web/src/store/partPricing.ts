/**
 * 在线元件报价（可选，默认关闭）：查 JLC / LCSC 装配库的实时库存与阶梯价。
 * 默认数据源 jlcsearch（社区服务，免密钥、允许跨域），只覆盖 JLC 装配库；
 * 其余分销商（Digi-Key / Mouser / Farnell / TME）浏览器端不允许跨域调用，只提供搜索深链。
 * 必须由用户显式开启——查询会把型号发送给第三方；结果缓存在浏览器本地，默认 24 小时。
 */
import { create } from 'zustand';
import { parsePriceTiers, type PartOffer } from '@tracelet/kernel';

export const DEFAULT_PRICING_URL = 'https://jlcsearch.tscircuit.com';
const KEY_CFG = 'tracelet:pricing:cfg', KEY_CACHE = 'tracelet:pricing:cache';
/** 报价缓存有效期：价格与库存变化快，过期即重新查询。 */
export const PRICING_TTL = 24 * 3600 * 1000;
const MAX_CACHE = 200;

export interface PricingEntry { offer: PartOffer | null; alternatives?: AltOffer[]; at: number; error?: string }
/** JLC 装配库里的同类可选：型号不同，参数相近，用于内置库里查不到原型号时给个价格参考。 */
export interface AltOffer { mpn: string; package?: string; description?: string; offer: PartOffer }
interface PricingCfg { enabled: boolean; url: string }

interface PricingState {
  enabled: boolean;
  url: string;
  cache: Record<string, PricingEntry>;
  /** 正在查询的型号 */
  busy: string[];
  setEnabled(v: boolean): void;
  setUrl(u: string): void;
  entry(mpn: string): PricingEntry | undefined;
  /** 缓存是否仍在有效期内 */
  fresh(mpn: string): boolean;
  /** 查询报价：命中新鲜缓存直接返回。alt 是查不到原型号时用的同类关键字（如 "10k 0603"）。 */
  lookup(mpn: string, opts?: { alt?: string; force?: boolean }): Promise<PricingEntry | undefined>;
  clear(): void;
}

const load = <T,>(k: string, d: T): T => { try { const raw = localStorage.getItem(k); return raw ? (JSON.parse(raw) as T) : d; } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
/** 只保留最近的若干条，避免长期使用把 localStorage 撑满。 */
const trim = (cache: Record<string, PricingEntry>): Record<string, PricingEntry> => {
  const keys = Object.keys(cache);
  if (keys.length <= MAX_CACHE) return cache;
  const kept = keys.sort((a, b) => cache[b].at - cache[a].at).slice(0, MAX_CACHE);
  return Object.fromEntries(kept.map((k) => [k, cache[k]]));
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
export const pricingKey = (mpn: string) => norm(mpn);

interface JlcRow { lcsc?: number; mfr?: string; package?: string; description?: string; stock?: number; price?: string | number; category?: string; subcategory?: string; is_basic?: boolean; is_preferred?: boolean }

/** 从候选里挑最贴近的一条：型号完全一致 > 前缀一致 > 库存最多。 */
export function pickRow(rows: JlcRow[], mpn: string): JlcRow | undefined {
  const want = norm(mpn);
  if (!want) return undefined;
  const named = rows.filter((r) => r.mfr);
  const exact = named.filter((r) => norm(r.mfr!) === want);
  const prefix = named.filter((r) => norm(r.mfr!).startsWith(want) || want.startsWith(norm(r.mfr!)));
  const pool = exact.length ? exact : prefix.length ? prefix : named;
  return pool.sort((a, b) => (b.stock ?? 0) - (a.stock ?? 0))[0];
}

/** jlcsearch 的一行 → 统一的报价结构。 */
export function rowToOffer(row: JlcRow, at: number): PartOffer {
  const sku = row.lcsc ? `C${row.lcsc}` : undefined;
  return {
    vendor: 'lcsc',
    sku,
    currency: 'USD',
    stock: row.stock,
    tiers: parsePriceTiers(row.price),
    url: sku ? `https://www.lcsc.com/product-detail/${sku}.html` : undefined,
    fetchedAt: at,
    note: row.is_basic ? 'JLC 基础库' : row.is_preferred ? 'JLC 优选库' : undefined
  };
}

const inflight = new Map<string, Promise<PricingEntry | undefined>>();

export const usePartPricing = create<PricingState>((set, get) => {
  const cfg = load<PricingCfg>(KEY_CFG, { enabled: false, url: DEFAULT_PRICING_URL });
  return {
    enabled: !!cfg.enabled,
    url: cfg.url || DEFAULT_PRICING_URL,
    cache: load<Record<string, PricingEntry>>(KEY_CACHE, {}),
    busy: [],
    setEnabled(enabled) { save(KEY_CFG, { enabled, url: get().url }); set({ enabled }); },
    setUrl(url) { const u = url.trim() || DEFAULT_PRICING_URL; save(KEY_CFG, { enabled: get().enabled, url: u }); set({ url: u }); },
    entry(mpn) { return get().cache[pricingKey(mpn)]; },
    fresh(mpn) { const e = get().cache[pricingKey(mpn)]; return !!e && Date.now() - e.at < PRICING_TTL; },
    clear() { save(KEY_CACHE, {}); set({ cache: {} }); },
    async lookup(mpn, opts = {}) {
      const key = pricingKey(mpn);
      if (!key) return undefined;
      const cached = get().cache[key];
      // 缓存里没有报价、也没查过同类时，若这次带了同类关键字就重查一次
      const needAlt = !!opts.alt && !!cached && !cached.offer && !cached.alternatives && !cached.error;
      if (!opts.force && !needAlt && get().fresh(mpn)) return cached;
      const running = inflight.get(key);
      if (running) return running;
      const task = (async (): Promise<PricingEntry> => {
        const base = get().url.replace(/\/+$/, '');
        const at = Date.now();
        const query = async (search: string): Promise<JlcRow[]> => {
          const q = new URLSearchParams({ search, limit: '8', full: 'true' });
          const res = await fetch(`${base}/components/list.json?${q}`, { cache: 'no-store' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return ((await res.json()) as { components?: JlcRow[] }).components ?? [];
        };
        let entry: PricingEntry;
        try {
          const row = pickRow(await query(mpn), mpn);
          let alternatives: AltOffer[] | undefined;
          if (!row && opts.alt) {
            const rows = (await query(opts.alt)).filter((r) => r.mfr).sort((a, b) => (b.stock ?? 0) - (a.stock ?? 0)).slice(0, 3);
            if (rows.length) alternatives = rows.map((r) => ({ mpn: r.mfr!, package: r.package, description: r.description, offer: rowToOffer(r, at) }));
          }
          entry = { offer: row ? rowToOffer(row, at) : null, ...(alternatives ? { alternatives } : {}), at };
        } catch (e) {
          entry = { offer: null, at, error: (e as Error).message };
        }
        const cache = trim({ ...get().cache, [key]: entry });
        save(KEY_CACHE, cache);
        set({ cache, busy: get().busy.filter((b) => b !== key) });
        return entry;
      })();
      inflight.set(key, task.finally(() => inflight.delete(key)) as Promise<PricingEntry | undefined>);
      set({ busy: [...get().busy, key] });
      return task;
    }
  };
});
