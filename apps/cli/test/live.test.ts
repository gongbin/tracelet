import { describe, it, expect, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import WebSocket from 'ws';
import { createDemoProject, serializeProject, parseProject } from '@tracelet/kernel';
import { createMcpServer } from '../src/mcp.js';

const textOf = (r: { content?: unknown }) => ((r.content as { type: string; text: string }[])[0].text);
const server = createMcpServer(undefined, { live: { port: 0 } });
afterAll(() => server.bridge?.close());

describe('MCP 实时桥（浏览器项目）', () => {
  it('浏览器镜像项目 → Agent 修改推回 → 回声不重复应用 → 撤销转发', async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: 'test', version: '0' }); await client.connect(b);
    const port = server.bridge!.address();
    const sock = new WebSocket(`ws://127.0.0.1:${port}`);
    const inbox: Record<string, unknown>[] = [];
    const next = (type: string) => new Promise<Record<string, unknown>>((res) => { const t = setInterval(() => { const i = inbox.findIndex((m) => m.type === type); if (i >= 0) { clearInterval(t); res(inbox.splice(i, 1)[0]); } }, 10); });
    sock.on('message', (raw) => inbox.push(JSON.parse(String(raw))));
    await new Promise((res) => sock.on('open', res));
    const demo = createDemoProject();
    sock.send(JSON.stringify({ type: 'hello', client: 'test' }));
    sock.send(JSON.stringify({ type: 'project', id: demo.id, name: demo.name, rev: 1, doc: serializeProject(demo, false) }));
    await new Promise((r) => setTimeout(r, 100));
    const list = JSON.parse(textOf(await client.callTool({ name: 'list_open_projects', arguments: {} })));
    expect(list.projects.map((p: { id: string }) => p.id)).toEqual([demo.id]); expect(list.active).toBe(demo.id);
    const sum = JSON.parse(textOf(await client.callTool({ name: 'project_summary', arguments: {} })));
    expect(sum.target).toContain(demo.id);
    // Agent 修改 → 浏览器收到 apply
    const placed = JSON.parse(textOf(await client.callTool({ name: 'place_component', arguments: { symbol: 'sym:R', value: '4.7k' } })));
    const apply = await next('apply');
    expect(apply.id).toBe(demo.id); expect(apply.rev).toBe(2);
    const doc = parseProject(apply.doc as string);
    expect(doc.schematic.sheets[0].components.some((c) => c.ref === placed.ref && c.value === '4.7k')).toBe(true);
    // 浏览器回声（fromAgent）不应重建镜像；随后再改一次能连续编号
    sock.send(JSON.stringify({ type: 'project', id: demo.id, name: demo.name, rev: 2, doc: apply.doc, fromAgent: true }));
    await new Promise((r) => setTimeout(r, 50));
    const again = textOf(await client.callTool({ name: 'set_component_value', arguments: { ref: placed.ref, value: '1k' } }));
    expect(again).toContain('已修改');
    const apply2 = await next('apply'); expect(apply2.rev).toBe(3);
    // 用户在浏览器里改了：新文档替换镜像
    const userDoc = parseProject(apply2.doc as string); userDoc.name = '用户改名';
    sock.send(JSON.stringify({ type: 'project', id: demo.id, name: userDoc.name, rev: 4, doc: serializeProject(userDoc, false) }));
    await new Promise((r) => setTimeout(r, 50));
    expect(JSON.parse(textOf(await client.callTool({ name: 'project_summary', arguments: {} }))).name).toBe('用户改名');
    // 撤销转发给浏览器
    expect(textOf(await client.callTool({ name: 'undo', arguments: {} }))).toContain('浏览器');
    expect((await next('undo')).id).toBe(demo.id);
    // 模板新建：省略 file → 浏览器打开
    await client.callTool({ name: 'new_from_template', arguments: { template: 'esp32' } });
    const open = await next('open'); expect(parseProject(open.doc as string).name).toBe('ESP32 最小系统');
    // 关闭项目后回到无目标
    sock.send(JSON.stringify({ type: 'closed', id: demo.id }));
    await new Promise((r) => setTimeout(r, 50));
    const r = await client.callTool({ name: 'project_summary', arguments: {} });
    expect(r.isError).toBe(true);
    sock.close();
  });
});
