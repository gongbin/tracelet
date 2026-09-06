import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDemoProject, createProject, serializeProject } from '@tracelet/kernel';
import { createApp } from '../src/app.js';
import { FileRepo } from '../src/repo.js';

let dir: string;
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'tracelet-srv-')); });
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

describe('server API（文件存储）', () => {
  it('健康检查 / 保存 / 列表 / 读取 / 删除', async () => {
    const app = createApp(await new FileRepo(dir).init());
    expect((await (await app.request('/api/health')).json()).kind).toBe('file');
    const p = createDemoProject();
    const put = await app.request(`/api/projects/${p.id}`, { method: 'PUT', body: serializeProject(p), headers: { 'content-type': 'application/json' } });
    expect(put.status).toBe(204);
    const list = await (await app.request('/api/projects')).json() as { id: string; name: string; componentCount: number }[];
    expect(list.map((m) => m.id)).toEqual([p.id]); expect(list[0].componentCount).toBeGreaterThan(0);
    const got = await (await app.request(`/api/projects/${p.id}`)).json() as { name: string };
    expect(got.name).toBe(p.name);
    expect((await app.request('/api/projects/nope')).status).toBe(404);
    expect((await app.request(`/api/projects/${p.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await app.request(`/api/projects/${p.id}`, { method: 'DELETE' })).status).toBe(404);
    expect(await (await app.request('/api/projects')).json()).toEqual([]);
  });
  it('拒绝无效文档与 id 不匹配', async () => {
    const app = createApp(await new FileRepo(dir).init());
    expect((await app.request('/api/projects/x', { method: 'PUT', body: '{"foo":1}' })).status).toBe(400);
    const p = createProject({ name: 'a' });
    expect((await app.request('/api/projects/other', { method: 'PUT', body: serializeProject(p) })).status).toBe(400);
    expect([400, 404]).toContain((await app.request('/api/projects/../etc', { method: 'PUT', body: serializeProject({ ...p, id: '../etc' }) })).status);
  });
  it('令牌鉴权', async () => {
    const app = createApp(await new FileRepo(dir).init(), { token: 'secret' });
    expect((await app.request('/api/projects')).status).toBe(401);
    expect((await app.request('/api/projects', { headers: { authorization: 'Bearer secret' } })).status).toBe(200);
    const pre = await app.request('/api/projects', { method: 'OPTIONS', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'PUT' } });
    expect(pre.status).toBeLessThan(400);
    expect(pre.headers.get('access-control-allow-origin')).toBe('*');
  });
  it('当前用户：种子用户可读、可改名', async () => {
    const app = createApp(await new FileRepo(dir).init());
    const me = await (await app.request('/api/me')).json() as { name: string; email: string };
    expect(me.name).toBe('设计者'); expect(me.email).toContain('@');
    const put = await app.request('/api/me', { method: 'PUT', body: JSON.stringify({ name: '张三' }), headers: { 'content-type': 'application/json' } });
    expect(put.status).toBe(200);
    expect(((await (await app.request('/api/me')).json()) as { name: string }).name).toBe('张三');
    expect((await app.request('/api/me', { method: 'PUT', body: JSON.stringify({ name: '' }), headers: { 'content-type': 'application/json' } })).status).toBe(400);
  });
});
