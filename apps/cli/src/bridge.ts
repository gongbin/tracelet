/**
 * 浏览器实时桥：MCP 进程在本机开一个 WebSocket，网页端（设置 → 本地 Agent）主动连上来，
 * 把当前打开的项目（按项目 ID）镜像过来；Agent 的修改再推回浏览器，以一条可撤销的命令应用。
 * 协议（JSON）：
 *   浏览器 → MCP：hello{client,version} · project{id,name,rev,doc,fromAgent?} · closed{id}
 *   MCP → 浏览器：apply{id,rev,doc} · open{doc} · undo{id} · ping
 */
import { WebSocketServer, type WebSocket } from 'ws';
import { EventEmitter } from 'node:events';

export interface LiveProject { id: string; name: string; rev: number; doc: string; ws: WebSocket; updatedAt: number }

export class LiveBridge extends EventEmitter {
  private wss: WebSocketServer;
  readonly projects = new Map<string, LiveProject>();
  readonly port: number;
  constructor(port = 8790, host = '127.0.0.1') {
    super();
    this.wss = new WebSocketServer({ port, host });
    this.port = port;
    this.wss.on('connection', (ws) => {
      ws.on('message', (raw) => {
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(String(raw)); } catch { return; }
        if (msg.type === 'project' && typeof msg.id === 'string') {
          const doc = typeof msg.doc === 'string' ? msg.doc : JSON.stringify(msg.doc);
          const p: LiveProject = { id: msg.id, name: String(msg.name ?? ''), rev: Number(msg.rev ?? 0), doc, ws, updatedAt: Date.now() };
          this.projects.set(p.id, p);
          this.emit('project', p, !!msg.fromAgent);
        } else if (msg.type === 'closed' && typeof msg.id === 'string') { this.projects.delete(msg.id); this.emit('closed', msg.id); }
      });
      ws.on('close', () => { for (const [id, p] of this.projects) if (p.ws === ws) { this.projects.delete(id); this.emit('closed', id); } });
      ws.send(JSON.stringify({ type: 'ping' }));
    });
  }
  /** 实际监听端口（port=0 时由系统分配）。 */
  address(): number { const a = this.wss.address(); return typeof a === 'object' && a ? a.port : this.port; }
  private send(ws: WebSocket, msg: unknown) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); }
  /** 把 Agent 修改后的文档推给持有该项目的浏览器。 */
  apply(id: string, doc: string): number {
    const p = this.projects.get(id); if (!p) throw new Error(`浏览器里没有打开项目 ${id}`);
    p.rev += 1; p.doc = doc; p.updatedAt = Date.now();
    this.send(p.ws, { type: 'apply', id, rev: p.rev, doc });
    return p.rev;
  }
  undo(id: string) { const p = this.projects.get(id); if (!p) throw new Error(`浏览器里没有打开项目 ${id}`); this.send(p.ws, { type: 'undo', id }); }
  /** 让某个（默认最近活跃的）浏览器打开一个新项目。 */
  openInBrowser(doc: string): boolean {
    const target = [...this.projects.values()].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.ws ?? [...this.wss.clients][0];
    if (!target) return false;
    this.send(target, { type: 'open', doc });
    return true;
  }
  get clientCount() { return this.wss.clients.size; }
  close() { for (const c of this.wss.clients) c.close(); this.wss.close(); }
}
