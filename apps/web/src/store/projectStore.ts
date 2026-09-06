import { normalizeStorageToken, storageBaseUrl, storageHttpError } from './remoteStorage.js';
import { type Project, parseProject, serializeProject, createDemoProject } from '@tracelet/kernel';

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: string;
  copperCount: 2 | 4 | 6;
  componentCount: number;
}

/**
 * 项目存储接口。
 * - 个人用户：LocalProjectStore（浏览器本地，拿来即用；桌面版可换 PGlite/SQLite）
 * - 小团队：RemoteProjectStore（指向自建 Postgres 服务，支持协同）
 * 两者共用同一套项目 JSON 与（后续）同一套 Drizzle schema。
 */
export interface ProjectStore {
  readonly kind: 'local' | 'remote';
  list(): Promise<ProjectMeta[]>;
  load(id: string): Promise<Project | null>;
  save(project: Project): Promise<void>;
  remove(id: string): Promise<void>;
  /** 远程模式：服务器上的当前用户（种子用户） */
  me?(): Promise<{ name: string; email?: string } | null>;
  setMe?(name: string): Promise<void>;
}

export interface StoreConfig { mode: 'local' | 'remote'; url?: string; token?: string }
const CONFIG_KEY = 'tracelet:store-config';

export function loadStoreConfig(): StoreConfig {
  try { const raw = localStorage.getItem(CONFIG_KEY); if (raw) return JSON.parse(raw) as StoreConfig; } catch { /* ignore */ }
  return { mode: 'local' };
}
export function saveStoreConfig(cfg: StoreConfig) {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

const metaOf = (p: Project): ProjectMeta => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, copperCount: p.board.copperCount, componentCount: p.schematic.sheets.reduce((n, s) => n + s.components.length, 0) });

export class LocalProjectStore implements ProjectStore {
  readonly kind = 'local' as const;
  private INDEX = 'tracelet:projects';
  private key(id: string) { return `tracelet:project:${id}`; }
  private readIndex(): ProjectMeta[] {
    try { const raw = localStorage.getItem(this.INDEX); return raw ? (JSON.parse(raw) as ProjectMeta[]) : []; } catch { return []; }
  }
  private writeIndex(list: ProjectMeta[]) { localStorage.setItem(this.INDEX, JSON.stringify(list)); }

  async list() {
    let list = this.readIndex();
    if (list.length === 0 && !localStorage.getItem('tracelet:seeded')) {
      const demo = createDemoProject();
      await this.save(demo);
      localStorage.setItem('tracelet:seeded', '1');
      list = this.readIndex();
    }
    return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async load(id: string) {
    const raw = localStorage.getItem(this.key(id));
    if (!raw) return null;
    try { return parseProject(raw); } catch (e) { console.error(e); return null; }
  }
  async save(project: Project) {
    localStorage.setItem(this.key(project.id), serializeProject(project, false));
    const list = this.readIndex().filter((m) => m.id !== project.id);
    list.unshift(metaOf(project));
    this.writeIndex(list);
  }
  async remove(id: string) {
    localStorage.removeItem(this.key(id));
    this.writeIndex(this.readIndex().filter((m) => m.id !== id));
  }
}

/** 远程存储：REST 客户端，服务端由 apps/server 提供（下一里程碑）。 */
export class RemoteProjectStore implements ProjectStore {
  readonly kind = 'remote' as const;
  constructor(private base: string, private token?: string) {}
  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${storageBaseUrl(this.base)}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(normalizeStorageToken(this.token) ? { authorization: `Bearer ${normalizeStorageToken(this.token)}` } : {}), ...(init?.headers ?? {}) } });
    if (!res.ok) throw new Error(storageHttpError(res.status));
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }
  list() { return this.req<ProjectMeta[]>('/api/projects'); }
  async load(id: string) { try { return parseProject(await this.req<unknown>(`/api/projects/${id}`)); } catch { return null; } }
  save(project: Project) { return this.req<void>(`/api/projects/${project.id}`, { method: 'PUT', body: serializeProject(project, false) }); }
  remove(id: string) { return this.req<void>(`/api/projects/${id}`, { method: 'DELETE' }); }
  async me() { try { return await this.req<{ name: string; email?: string }>('/api/me'); } catch { return null; } }
  setMe(name: string) { return this.req<void>('/api/me', { method: 'PUT', body: JSON.stringify({ name }) }); }
}

/**
 * IndexedDB 本地存储：localStorage 整站只有约 5MB，带 3D 模型 / 导入库的工程很容易超限导致"保存失败"。
 * 首次使用时把 localStorage 里的旧工程迁移过来（迁移成功后删除旧副本，索引保留在 IDB）。
 */
export class IdbProjectStore implements ProjectStore {
  readonly kind = 'local' as const;
  private dbp: Promise<IDBDatabase> | null = null;
  private legacy = new LocalProjectStore();
  private migrated = false;
  private db(): Promise<IDBDatabase> {
    if (!this.dbp) this.dbp = new Promise((res, rej) => {
      const req = indexedDB.open('tracelet', 1);
      req.onupgradeneeded = () => { const d = req.result; if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' }); };
      req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error ?? new Error('IndexedDB 打开失败'));
    });
    return this.dbp;
  }
  private tx<T>(mode: IDBTransactionMode, fn: (st: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return this.db().then((d) => new Promise<T>((res, rej) => { const t = d.transaction('projects', mode); const r = fn(t.objectStore('projects')); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error ?? new Error('IndexedDB 操作失败')); }));
  }
  private async migrate() {
    if (this.migrated) return; this.migrated = true;
    try {
      const keys: string[] = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('tracelet:project:')) keys.push(k); }
      for (const k of keys) { const raw = localStorage.getItem(k); if (!raw) continue; try { const p = parseProject(raw); const existing = await this.tx<{ id: string; updatedAt: string } | undefined>('readonly', (st) => st.get(p.id) as IDBRequest<{ id: string; updatedAt: string } | undefined>); if (!existing || existing.updatedAt < p.updatedAt) await this.putRaw(p); localStorage.removeItem(k); } catch { /* 损坏的旧工程留在原处 */ } }
      if (keys.length) { localStorage.removeItem('tracelet:projects'); localStorage.setItem('tracelet:seeded', '1'); }
    } catch { /* 无 localStorage 时忽略 */ }
  }
  private putRaw(p: Project) { return this.tx('readwrite', (st) => st.put({ id: p.id, meta: metaOf(p), updatedAt: p.updatedAt, text: serializeProject(p, false) })); }
  async list() {
    await this.migrate();
    const rows = await this.tx<{ meta: ProjectMeta }[]>('readonly', (st) => st.getAll() as IDBRequest<{ meta: ProjectMeta }[]>);
    let list = rows.map((r) => r.meta);
    if (list.length === 0 && !localStorage.getItem('tracelet:seeded')) { const demo = createDemoProject(); await this.save(demo); localStorage.setItem('tracelet:seeded', '1'); list = [metaOf(demo)]; }
    return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async load(id: string) {
    await this.migrate();
    const row = await this.tx<{ text: string } | undefined>('readonly', (st) => st.get(id) as IDBRequest<{ text: string } | undefined>);
    if (!row) return this.legacy.load(id);
    try { return parseProject(row.text); } catch (e) { console.error(e); return null; }
  }
  async save(project: Project) { await this.migrate(); await this.putRaw(project); }
  async remove(id: string) { await this.migrate(); await this.tx('readwrite', (st) => st.delete(id)); try { localStorage.removeItem(`tracelet:project:${id}`); } catch { /* ignore */ } }
}

export function createProjectStore(cfg: StoreConfig = loadStoreConfig()): ProjectStore {
  if (cfg.mode === 'remote' && cfg.url) return new RemoteProjectStore(cfg.url, cfg.token);
  return typeof indexedDB !== 'undefined' ? new IdbProjectStore() : new LocalProjectStore();
}
