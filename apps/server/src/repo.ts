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
  close?(): Promise<void>;
}

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
    return this;
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
