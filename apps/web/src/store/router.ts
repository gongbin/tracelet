/**
 * 显式 URL 路由（History API，无第三方依赖）：
 *   /                       首页
 *   /p/<projectId>          项目（默认原理图）
 *   /p/<projectId>/sch/<sheetId>
 *   /p/<projectId>/pcb | 3d | lib | bom | fab
 * 项目 ID 是创建时生成的唯一随机 ID，本地 / 远程存储通用；刷新后按 URL 恢复。
 */
import { useApp, type Screen } from './app.js';

const SCREENS: Screen[] = ['sch', 'pcb', '3d', 'lib', 'bom', 'fab'];

export interface Route { projectId: string | null; screen: Screen; sheetId: string | null }

export function parseRoute(pathname: string = location.pathname): Route {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'p' || !parts[1]) return { projectId: null, screen: 'sch', sheetId: null };
  const screen = (SCREENS as string[]).includes(parts[2] ?? '') ? (parts[2] as Screen) : 'sch';
  return { projectId: decodeURIComponent(parts[1]), screen, sheetId: screen === 'sch' && parts[3] ? decodeURIComponent(parts[3]) : null };
}

export function buildPath(r: Route): string {
  if (!r.projectId) return '/';
  const base = `/p/${encodeURIComponent(r.projectId)}`;
  if (r.screen === 'sch') return r.sheetId ? `${base}/sch/${encodeURIComponent(r.sheetId)}` : `${base}/sch`;
  return `${base}/${r.screen}`;
}

let applying = false;

/** 把应用状态同步到地址栏（replaceState，避免历史爆炸；切项目用 pushState）。 */
export function startRouter() {
  const apply = async (r: Route) => {
    applying = true;
    try {
      const s = useApp.getState();
      if (!r.projectId) { if (s.editor) s.closeProject(); return; }
      if (!s.editor || s.editor.project.id !== r.projectId) {
        const p = await s.store.load(r.projectId);
        if (!p) { s.toast('链接里的项目不存在（可能已删除或在另一台设备上）', 'error'); history.replaceState(null, '', '/'); if (s.editor) s.closeProject(); return; }
        s.openProjectObject(p);
      }
      const st = useApp.getState();
      if (st.screen !== r.screen) st.go(r.screen);
      if (r.screen === 'sch' && r.sheetId && st.editor?.project.schematic.sheets.some((sh) => sh.id === r.sheetId)) st.patch({ sheetId: r.sheetId });
    } finally { applying = false; }
  };
  void apply(parseRoute());
  window.addEventListener('popstate', () => { void apply(parseRoute()); });

  let lastPath = location.pathname, lastProject: string | null = null;
  useApp.subscribe((s) => {
    if (applying) return;
    const projectId = s.editor?.project.id ?? null;
    const path = buildPath({ projectId, screen: s.screen, sheetId: s.screen === 'sch' ? (s.sheetId ?? null) : null });
    if (path === lastPath) return;
    if (projectId !== lastProject) history.pushState(null, '', path); else history.replaceState(null, '', path);
    lastPath = path; lastProject = projectId;
  });
}
