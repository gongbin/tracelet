/**
 * 零件库数据源：内置（内核 PARTS_BASE）+ 社区（从 URL 更新的 JSON）+ 我的（CSV / JSON 导入、手动录入）。
 * 社区与我的零件保存在浏览器本地，启动时注册到内核，搜索 / 放置 / BOM 都能用。
 */
import { create } from 'zustand';
import { registerParts, parsePartsCsv, parsePartsJson, partsToCsv, partsToJson, type Part } from '@tracelet/kernel';

export const DEFAULT_PARTS_URL = 'https://raw.githubusercontent.com/gongbin/tracelet/main/data/parts.json';
const KEY_USER = 'tracelet:parts:user', KEY_COMMUNITY = 'tracelet:parts:community', KEY_META = 'tracelet:parts:meta';
export interface PartsMeta { url: string; version?: string; updatedAt?: string; count?: number; lastError?: string }

interface PartsState {
  user: Part[]; community: Part[]; meta: PartsMeta; busy: boolean;
  importText(text: string, kind: 'csv' | 'json'): { added: number; errors: string[] };
  addPart(p: Part): void; removeUser(id: string): void; clearUser(): void;
  updateFromUrl(url?: string): Promise<{ count: number; version?: string }>;
  exportUser(kind: 'csv' | 'json'): string;
  setUrl(url: string): void;
}
const load = <T,>(k: string, d: T): T => { try { const raw = localStorage.getItem(k); return raw ? (JSON.parse(raw) as T) : d; } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

export const usePartsStore = create<PartsState>((set, get) => {
  const user = load<Part[]>(KEY_USER, []), community = load<Part[]>(KEY_COMMUNITY, []), meta = load<PartsMeta>(KEY_META, { url: DEFAULT_PARTS_URL });
  registerParts(community, 'community'); registerParts(user, 'user');
  return {
    user, community, meta, busy: false,
    importText(text, kind) {
      const r = kind === 'csv' ? parsePartsCsv(text) : parsePartsJson(text);
      if (!r.parts.length) return { added: 0, errors: r.errors };
      const byId = new Map(get().user.map((p) => [p.id, p])); for (const p of r.parts) byId.set(p.id, p);
      const next = [...byId.values()]; save(KEY_USER, next); registerParts(next, 'user'); set({ user: next });
      return { added: r.parts.length, errors: r.errors };
    },
    addPart(p) { const next = [...get().user.filter((x) => x.id !== p.id), p]; save(KEY_USER, next); registerParts(next, 'user'); set({ user: next }); },
    removeUser(id) { const next = get().user.filter((x) => x.id !== id); save(KEY_USER, next); registerParts(next, 'user'); set({ user: next }); },
    clearUser() { save(KEY_USER, []); registerParts([], 'user'); set({ user: [] }); },
    async updateFromUrl(url) {
      const u = (url ?? get().meta.url ?? DEFAULT_PARTS_URL).trim();
      set({ busy: true });
      try {
        const res = await fetch(u, { cache: 'no-store' }); if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text(); const r = parsePartsJson(text);
        if (!r.parts.length) throw new Error(r.errors[0] ?? '文件里没有零件');
        save(KEY_COMMUNITY, r.parts); registerParts(r.parts, 'community');
        const meta: PartsMeta = { url: u, version: r.version, updatedAt: new Date().toISOString(), count: r.parts.length }; save(KEY_META, meta);
        set({ community: r.parts, meta, busy: false });
        return { count: r.parts.length, version: r.version };
      } catch (e) { const meta = { ...get().meta, url: u, lastError: (e as Error).message }; save(KEY_META, meta); set({ meta, busy: false }); throw e; }
    },
    exportUser(kind) { return kind === 'csv' ? partsToCsv(get().user) : partsToJson(get().user, 'user'); },
    setUrl(url) { const meta = { ...get().meta, url }; save(KEY_META, meta); set({ meta }); }
  };
});
