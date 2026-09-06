/**
 * 项目仓储：与 Web 端 RemoteProjectStore 对接的最小接口。
 * - FileRepo：JSON 文件目录，零依赖，适合个人 / NAS 自建
 * - PgRepo：PostgreSQL（drizzle，表结构见 @tracelet/db 的 projects 表）
 */
import { mkdir, readdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import pg from 'pg';
import { projects } from '@tracelet/db';

export interface ProjectMeta { id: string; name: string; updatedAt: string; copperCount: 2 | 4; componentCount: number }
export interface ProjectRepo {
  readonly kind: 'file' | 'postgres';
  list(): Promise<ProjectMeta[]>;
  get(id: string): Promise<unknown | null>;
  put(id: string, doc: ProjectDoc): Promise<void>;
  remove(id: string): Promise<boolean>;
  /** 当前用户（单租户：种子用户，可改名） */
  getUser(): Promise<UserInfo>;
  setUser(name: string): Promise<UserInfo>;
  close?(): Promise<void>;
}
export interface UserInfo { id: string; name: string; email: string }
export const SEED_USER: UserInfo = { id: '00000000-0000-4000-8000-000000000001', name: '设计者', email: 'owner@tracelet.local' };

/** 服务端只关心元数据字段，其余原样透传（校验由内核 parseProject 完成）。 */
export interface ProjectDoc { id: string; name: string; updatedAt: string; settings: unknown; board: { copperCount: 2 | 4 }; schematic: { sheets: { components: unknown[] }[] } }
export const metaOf = (p: ProjectDoc): ProjectMeta => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, copperCount: p.board.copperCount, componentCount: p.schematic.sheets.reduce((n, s) => n + s.components.length, 0) });
const safeId = (id: string) => /^[\w.-]{1,120}$/.test(id);

export class FileRepo implements ProjectRepo {
  readonly kind = 'file' as const;
  constructor(private dir: string) {}
  private path(id: string) { return join(this.dir, `${id}.json`); }
  async init() { await mkdir(this.dir, { recursive: true }); return this; }
  async list() {
    await mkdir(this.dir, { recursive: true });
    const files = (await readdir(this.dir)).filter((f) => f.endsWith('.json'));
    const out: ProjectMeta[] = [];
    for (const f of files) { try { out.push(metaOf(JSON.parse(await readFile(join(this.dir, f), 'utf8')) as ProjectDoc)); } catch { /* 跳过损坏文件 */ } }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async get(id: string) { if (!safeId(id)) return null; try { return JSON.parse(await readFile(this.path(id), 'utf8')) as unknown; } catch { return null; } }
  async put(id: string, doc: ProjectDoc) { if (!safeId(id)) throw new Error('bad id'); await mkdir(this.dir, { recursive: true }); const tmp = this.path(id) + '.tmp'; await writeFile(tmp, JSON.stringify(doc)); const { rename } = await import('node:fs/promises'); await rename(tmp, this.path(id)); }
  async remove(id: string) { if (!safeId(id)) return false; try { await stat(this.path(id)); await rm(this.path(id)); return true; } catch { return false; } }
  private userPath() { return join(this.dir, '_user.json'); }
  async getUser(): Promise<UserInfo> { try { return { ...SEED_USER, ...(JSON.parse(await readFile(this.userPath(), 'utf8')) as Partial<UserInfo>) }; } catch { return SEED_USER; } }
  async setUser(name: string) { await mkdir(this.dir, { recursive: true }); const u = { ...(await this.getUser()), name: name.trim().slice(0, 80) || SEED_USER.name }; await writeFile(this.userPath(), JSON.stringify(u)); return u; }
}

export class PgRepo implements ProjectRepo {
  readonly kind = 'postgres' as const;
  private pool: pg.Pool;
  private db: NodePgDatabase;
  constructor(connectionString: string) { this.pool = new pg.Pool({ connectionString }); this.db = drizzle(this.pool); }
  /** 建表（幂等）：与 @tracelet/db 的 projects 表一致，外键列允许为空以便单机使用。 */
  async init() {
    await this.db.execute(sql`CREATE TABLE IF NOT EXISTS projects (
      id text PRIMARY KEY, org_id uuid, owner_id uuid, name text NOT NULL, settings jsonb NOT NULL, document jsonb NOT NULL, yjs_state text,
      is_public boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
    await this.db.execute(sql`CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
    // 种子用户：单机 / 小团队先用一个账号，姓名可在头像菜单里改
    await this.db.execute(sql`INSERT INTO users (id, email, name) VALUES (${SEED_USER.id}::uuid, ${SEED_USER.email}, ${SEED_USER.name}) ON CONFLICT (email) DO NOTHING`);
    return this;
  }
  async getUser(): Promise<UserInfo> {
    const rows = await this.db.execute(sql`SELECT id, email, name FROM users ORDER BY created_at ASC LIMIT 1`);
    const r = (rows.rows as { id: string; email: string; name: string }[])[0];
    return r ? { id: String(r.id), email: r.email, name: r.name } : SEED_USER;
  }
  async setUser(name: string): Promise<UserInfo> {
    const u = await this.getUser(); const n = name.trim().slice(0, 80) || SEED_USER.name;
    await this.db.execute(sql`INSERT INTO users (id, email, name) VALUES (${u.id}::uuid, ${u.email}, ${n}) ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name`);
    return { ...u, name: n };
  }
  async list() {
    const rows = await this.db.select({ document: projects.document }).from(projects).orderBy(sql`updated_at desc`);
    return rows.map((r) => metaOf(r.document as ProjectDoc));
  }
  async get(id: string) { const rows = await this.db.select({ document: projects.document }).from(projects).where(eq(projects.id, id)).limit(1); return rows[0]?.document ?? null; }
  async put(id: string, doc: ProjectDoc) {
    await this.db.insert(projects).values({ id, name: doc.name, settings: doc.settings ?? {}, document: doc, updatedAt: new Date() })
      .onConflictDoUpdate({ target: projects.id, set: { name: doc.name, settings: doc.settings ?? {}, document: doc, updatedAt: new Date() } });
  }
  async remove(id: string) { const r = await this.db.delete(projects).where(eq(projects.id, id)).returning({ id: projects.id }); return r.length > 0; }
  async close() { await this.pool.end(); }
}
