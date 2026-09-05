import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMcpServer } from '../src/mcp.js';

async function connect() {
  const server = createMcpServer();
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(b);
  return client;
}
const textOf = (r: { content?: unknown }) => ((r.content as { type: string; text: string }[])[0].text);

describe('MCP server', () => {
  it('列出工具并走完 新建 → 放置 → 连线 → ERC → 同步 → 自动布线 → 导出', async () => {
    const client = await connect();
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['open_project', 'run_erc', 'run_drc', 'place_component', 'connect_pins', 'autoroute', 'export_fab']));
    const dir = mkdtempSync(join(tmpdir(), 'tracelet-mcp-'));
    const file = join(dir, 'p.eda.json');
    await client.callTool({ name: 'new_project', arguments: { file, name: 'MCP 测试' } });
    const r1 = JSON.parse(textOf(await client.callTool({ name: 'place_component', arguments: { symbol: 'sym:R', value: '10k' } })));
    expect(r1.ref).toBe('R1');
    await client.callTool({ name: 'place_component', arguments: { symbol: 'sym:C', value: '100n', x: 3000, y: 2000 } });
    await client.callTool({ name: 'connect_pins', arguments: { a: 'R1.2', b: 'C1.1' } });
    await client.callTool({ name: 'add_net_label', arguments: { pin: 'R1.1', net: '+3V3' } });
    const erc = JSON.parse(textOf(await client.callTool({ name: 'run_erc', arguments: {} })));
    expect(erc.errors).toBe(0);
    const nl = JSON.parse(textOf(await client.callTool({ name: 'get_netlist', arguments: {} })));
    expect(nl.some((n: { name: string }) => n.name === '+3V3')).toBe(true);
    await client.callTool({ name: 'sync_to_pcb', arguments: {} });
    await client.callTool({ name: 'set_board_outline', arguments: { width: 30, height: 20 } });
    await client.callTool({ name: 'move_footprint', arguments: { ref: 'R1', x: 10, y: 10 } });
    await client.callTool({ name: 'move_footprint', arguments: { ref: 'C1', x: 20, y: 10 } });
    const ar = JSON.parse(textOf(await client.callTool({ name: 'autoroute', arguments: {} })));
    expect(ar.routed).toBe(ar.total);
    const ex = JSON.parse(textOf(await client.callTool({ name: 'export_fab', arguments: { dir: join(dir, 'fab') } })));
    expect(ex.files.length).toBeGreaterThan(10);
    const sum = JSON.parse(textOf(await client.callTool({ name: 'project_summary', arguments: {} })));
    expect(sum.pcb.footprints).toBe(2);
    const undo = textOf(await client.callTool({ name: 'undo', arguments: {} }));
    expect(undo).toContain('已撤销');
  });
});
