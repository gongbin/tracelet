import { type Project, parseProject, serializeProject, createDemoProject } from '@tracelet/kernel';

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: string;
  copperCount: 2 | 4;
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
    const res = await fetch(`${this.base.replace(/\/$/, '')}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(this.token ? { authorization: `Bearer ${this.token}` } : {}), ...(init?.headers ?? {}) } });
    if (!res.ok) throw new Error(`远程存储错误 ${res.status}`);
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }
  list() { return this.req<ProjectMeta[]>('/api/projects'); }
  async load(id: string) { try { return parseProject(await this.req<unknown>(`/api/projects/${id}`)); } catch { return null; } }
  save(project: Project) { return this.req<void>(`/api/projects/${project.id}`, { method: 'PUT', body: serializeProject(project, false) }); }
  remove(id: string) { return this.req<void>(`/api/projects/${id}`, { method: 'DELETE' }); }
}

export function createProjectStore(cfg: StoreConfig = loadStoreConfig()): ProjectStore {
  if (cfg.mode === 'remote' && cfg.url) return new RemoteProjectStore(cfg.url, cfg.token);
  return new LocalProjectStore();
}
