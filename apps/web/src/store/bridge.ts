/**
 * 本地 Agent 桥：网页主动连接本机 MCP 进程（tracelet serve --mcp --live）的 WebSocket，
 * 把当前打开的项目镜像过去；Agent 的修改以一条可撤销的命令「Agent 修改」应用到当前编辑器。
 * 只连 127.0.0.1，默认关闭；状态保存在 localStorage。
 */
import { create } from 'zustand';
import { parseProject, serializeProject, command } from '@tracelet/kernel';
import { useApp } from './app.js';

export type BridgeStatus = 'off' | 'connecting' | 'connected' | 'error';
interface BridgeState { enabled: boolean; port: number; status: BridgeStatus; lastAgentEditAt: number | null; agentEdits: number; set(p: Partial<Pick<BridgeState, 'enabled' | 'port'>>): void }
const KEY = 'tracelet:bridge';
const load = (): { enabled: boolean; port: number } => { try { return { enabled: false, port: 8790, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { enabled: false, port: 8790 }; } };

export const useBridge = create<BridgeState>((set, get) => ({
  ...load(), status: 'off', lastAgentEditAt: null, agentEdits: 0,
  set(p) { set(p); try { localStorage.setItem(KEY, JSON.stringify({ enabled: get().enabled, port: get().port })); } catch { /* ignore */ } schedule(0); }
}));

let ws: WebSocket | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let unsubEditor: (() => void) | null = null;
let sendTimer: ReturnType<typeof setTimeout> | null = null;
let rev = 0;
let fromAgent = false;
let mirroredId: string | null = null;

const send = (msg: unknown) => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };
/** 把当前项目（若有）发给 Agent。 */
function pushProject(immediate = false) {
  if (sendTimer) { clearTimeout(sendTimer); sendTimer = null; }
  const run = () => {
    const ed = useApp.getState().editor;
    if (!ed) { if (mirroredId) { send({ type: 'closed', id: mirroredId }); mirroredId = null; } return; }
    if (mirroredId && mirroredId !== ed.project.id) send({ type: 'closed', id: mirroredId });
    mirroredId = ed.project.id;
    send({ type: 'project', id: ed.project.id, name: ed.project.name, rev, doc: serializeProject(ed.project, false), fromAgent });
    fromAgent = false;
  };
  if (immediate) run(); else sendTimer = setTimeout(run, 250);
}
function watchEditor() {
  unsubEditor?.(); unsubEditor = null;
  const ed = useApp.getState().editor;
  if (!ed) return;
  unsubEditor = ed.subscribe(() => { rev++; pushProject(); });
}
function schedule(ms: number) { if (timer) clearTimeout(timer); timer = setTimeout(connect, ms); }

function connect() {
  const { enabled, port } = useBridge.getState();
  if (ws) { const old = ws; ws = null; old.onclose = null; old.close(); }
  if (!enabled || typeof WebSocket === 'undefined') { useBridge.setState({ status: 'off' }); return; }
  useBridge.setState({ status: 'connecting' });
  try { ws = new WebSocket(`ws://127.0.0.1:${port}`); } catch { useBridge.setState({ status: 'error' }); schedule(5000); return; }
  const sock = ws;
  sock.onopen = () => { useBridge.setState({ status: 'connected' }); send({ type: 'hello', client: 'tracelet-web', version: '0.1.0' }); pushProject(true); };
  sock.onclose = () => { if (ws === sock) { ws = null; useBridge.setState({ status: useBridge.getState().enabled ? 'connecting' : 'off' }); if (useBridge.getState().enabled) schedule(3000); } };
  sock.onerror = () => { useBridge.setState({ status: 'error' }); };
  sock.onmessage = (e) => { try { handle(JSON.parse(String(e.data))); } catch (err) { console.warn('[bridge]', err); } };
}

/** 处理来自 Agent 的消息（也供测试直接调用）。 */
export function handle(msg: { type: string; id?: string; rev?: number; doc?: string }) {
  const app = useApp.getState();
  if (msg.type === 'apply' && msg.doc) {
    const ed = app.editor;
    if (!ed || ed.project.id !== msg.id) { if (msg.id) send({ type: 'closed', id: msg.id }); return; }
    const next = parseProject(msg.doc);
    fromAgent = true; rev = msg.rev ?? rev + 1;
    ed.dispatch(command('Agent 修改', () => ({ ...next, updatedAt: new Date().toISOString() })));
    // Acknowledge this exact snapshot before an undo or a local edit can replace it.
    pushProject(true);
    useBridge.setState({ lastAgentEditAt: Date.now(), agentEdits: useBridge.getState().agentEdits + 1 });
  } else if (msg.type === 'open' && msg.doc) {
    app.openProjectObject(parseProject(msg.doc));
    app.toast('Agent 在浏览器中打开了一个新项目', 'success');
  } else if (msg.type === 'undo') {
    const ed = app.editor;
    if (ed && (!msg.id || ed.project.id === msg.id)) {
      fromAgent = false;
      const label = ed.undoLabel;
      if (ed.undo()) app.toast(`Agent 撤销：${label}`);
      pushProject(true);
    }
  }
}

let started = false;
/** 应用启动时调用一次：按偏好自动连接，并跟随项目打开 / 关闭。 */
export function initBridge() {
  if (started) return; started = true;
  useApp.subscribe((s, prev) => { if (s.editor !== prev.editor) { watchEditor(); pushProject(true); } });
  watchEditor();
  if (useBridge.getState().enabled) schedule(0);
}
/** 测试用：重置连接状态。 */
export function _bridgeInternal() { return { get ws() { return ws; }, setSocket(s: WebSocket | null) { ws = s; }, pushProject, watchEditor }; }
