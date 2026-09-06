/** REST API（Hono）：与 Web 端 RemoteProjectStore 的路径一一对应。 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { parseProject } from '@tracelet/kernel';
import type { ProjectRepo, ProjectDoc } from './repo.js';

export interface AppOptions { token?: string; maxBodyBytes?: number; origins?: string[] }

export function createApp(repo: ProjectRepo, opts: AppOptions = {}) {
  const app = new Hono();
  const maxBody = opts.maxBodyBytes ?? 32 * 1024 * 1024;
  app.use('/api/*', cors({ origin: opts.origins?.length ? opts.origins : '*', allowHeaders: ['content-type', 'authorization'], allowMethods: ['GET', 'PUT', 'DELETE', 'OPTIONS'] }));
  app.use('/api/*', async (c, next) => {
    if (opts.token && c.req.method !== 'OPTIONS') {
      const auth = c.req.header('authorization') ?? '';
      if (auth !== `Bearer ${opts.token}`) return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  });
  app.get('/api/health', async (c) => c.json({ ok: true, kind: repo.kind, projects: (await repo.list()).length, version: '0.1.0' }));
  app.get('/api/me', async (c) => c.json(await repo.getUser()));
  app.put('/api/me', async (c) => { let body: { name?: unknown }; try { body = await c.req.json(); } catch { return c.json({ error: 'invalid json' }, 400); } if (typeof body.name !== 'string' || !body.name.trim()) return c.json({ error: 'name required' }, 400); return c.json(await repo.setUser(body.name)); });
  app.get('/api/projects', async (c) => c.json(await repo.list()));
  app.get('/api/projects/:id', async (c) => { const doc = await repo.get(c.req.param('id')); return doc ? c.json(doc) : c.json({ error: 'not found' }, 404); });
  app.put('/api/projects/:id', async (c) => {
    const len = Number(c.req.header('content-length') ?? 0);
    if (len > maxBody) return c.json({ error: 'too large' }, 413);
    const text = await c.req.text();
    if (text.length > maxBody) return c.json({ error: 'too large' }, 413);
    let project;
    try { project = parseProject(text); } catch (e) { return c.json({ error: `invalid project: ${(e as Error).message}` }, 400); }
    if (project.id !== c.req.param('id')) return c.json({ error: 'id mismatch' }, 400);
    await repo.put(project.id, project as unknown as ProjectDoc);
    return c.body(null, 204);
  });
  app.delete('/api/projects/:id', async (c) => (await repo.remove(c.req.param('id'))) ? c.body(null, 204) : c.json({ error: 'not found' }, 404));
  app.get('/', (c) => c.text('Tracelet server · API at /api/projects'));
  return app;
}
