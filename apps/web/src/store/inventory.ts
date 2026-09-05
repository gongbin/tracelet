/**
 * 我的库存：用户自己手头的元件（型号、值、封装、数量、存放位置），保存在浏览器本地，跨项目可用。
 * 支持 CSV 导入导出（型号,值,符号,封装,LCSC,数量,位置,备注）。
 */
import { create } from 'zustand';

export interface InventoryItem { id: string; name: string; value: string; symbolId: string; footprintId: string; lcsc?: string; qty: number; location?: string; note?: string; category?: string }
interface InventoryState { items: InventoryItem[]; add(item: Omit<InventoryItem, 'id'>): InventoryItem; update(id: string, patch: Partial<InventoryItem>): void; remove(id: string): void; importCsv(text: string): number; exportCsv(): string }
const KEY = 'tracelet:inventory';
const load = (): InventoryItem[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as InventoryItem[]; } catch { return []; } };
const persist = (items: InventoryItem[]) => { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* ignore */ } };
const esc = (v: string | number | undefined) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export const useInventory = create<InventoryState>((set, get) => ({
  items: load(),
  add(item) { const it = { ...item, id: `inv_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` }; const items = [...get().items, it]; persist(items); set({ items }); return it; },
  update(id, patch) { const items = get().items.map((i) => (i.id === id ? { ...i, ...patch } : i)); persist(items); set({ items }); },
  remove(id) { const items = get().items.filter((i) => i.id !== id); persist(items); set({ items }); },
  importCsv(text) {
    const rows = parseCsv(text); if (!rows.length) return 0;
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const has = head.some((h) => /型号|name|mpn|value|值/.test(h));
    const body = has ? rows.slice(1) : rows;
    const col = (names: string[], fallback: number) => { const i = head.findIndex((h) => names.some((n) => h.includes(n))); return has && i >= 0 ? i : fallback; };
    const ci = { name: col(['型号', 'mpn', 'name', 'part'], 0), value: col(['值', 'value'], 1), symbol: col(['符号', 'symbol'], 2), fp: col(['封装', 'footprint', 'package'], 3), lcsc: col(['lcsc', '立创'], 4), qty: col(['数量', 'qty', 'quantity'], 5), loc: col(['位置', 'location', 'bin'], 6), note: col(['备注', 'note'], 7) };
    let n = 0;
    const items = [...get().items];
    for (const r of body) {
      const name = (r[ci.name] ?? '').trim(); if (!name) continue;
      const qty = Number(r[ci.qty]) || 0;
      const existing = items.find((i) => i.name === name && i.value === (r[ci.value] ?? '').trim());
      if (existing) { existing.qty = qty; existing.location = r[ci.loc]?.trim() || existing.location; continue; }
      items.push({ id: `inv_${Date.now().toString(36)}${n}${Math.random().toString(36).slice(2, 5)}`, name, value: (r[ci.value] ?? '').trim(), symbolId: (r[ci.symbol] ?? '').trim(), footprintId: (r[ci.fp] ?? '').trim(), lcsc: r[ci.lcsc]?.trim() || undefined, qty, location: r[ci.loc]?.trim() || undefined, note: r[ci.note]?.trim() || undefined });
      n++;
    }
    persist(items); set({ items }); return n;
  },
  exportCsv() { return ['型号,值,符号,封装,LCSC,数量,位置,备注', ...get().items.map((i) => [i.name, i.value, i.symbolId, i.footprintId, i.lcsc, i.qty, i.location, i.note].map(esc).join(','))].join('\n'); }
}));
