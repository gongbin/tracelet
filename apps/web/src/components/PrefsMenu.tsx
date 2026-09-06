import { normalizeStorageToken, storageBaseUrl, storageHttpError } from '../store/remoteStorage.js';
import { useEffect, useRef, useState } from 'react';
import { usePrefs, useT, type WheelMode } from '../i18n/index.js';
import { useApp } from '../store/app.js';
import { loadStoreConfig, saveStoreConfig } from '../store/projectStore.js';
import { useBridge } from '../store/bridge.js';

/** 头像显示：中文名取末两字，英文名取首字母。 */
export function initials(name: string): string {
  const n = name.trim(); if (!n) return '我';
  if (/[\u4e00-\u9fff]/.test(n)) return n.length <= 2 ? n : n.slice(-2);
  return n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}
/** 头像菜单：姓名 / 画布手势 / 存储模式。 */
export function PrefsMenu({ large }: { large?: boolean }) {
  const [open, setOpen] = useState(false);
  const prefs = usePrefs();
  const t = useT();
  const app = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const [cfg, setCfg] = useState(loadStoreConfig);
  const bridge = useBridge();
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const size = large ? 28 : 24;
  return (
    <div ref={ref} style={{ position: 'relative', flex: 'none' }} onClick={(e) => e.stopPropagation()}>
      <div className="row" style={{ gap: 0, cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        <span className="avatar" title={prefs.userName ? `${prefs.userName} · 点击编辑姓名与偏好` : '点击设置姓名'} style={{ width: size, height: size, background: '#7A8A5E', fontSize: large ? 11 : 10 }}>{initials(prefs.userName)}</span>
      </div>
      {open && (
        <div className="menu" style={{ top: size + 8, right: 0, width: 260 }}>
          <div className="menu-head">姓名（写入原理图标题栏作者）</div>
          <div className="row" style={{ padding: '0 6px 6px', gap: 6 }}>
            <input className="input" placeholder="如 张三" defaultValue={prefs.userName} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} onBlur={(e) => { const n = e.target.value.trim(); if (n === prefs.userName) return; prefs.setUserName(n); if (app.store.kind === 'remote' && app.store.setMe) void app.store.setMe(n).then(() => app.toast('姓名已同步到服务器', 'success')).catch(() => app.toast('姓名已保存在本机，同步到服务器失败', 'error')); else app.toast('姓名已保存；新图纸标题栏会自动填作者', 'success'); }} />
          </div>
          <div className="menu-head">{t('settings.wheel')}</div>
          <div className="col" style={{ padding: '0 6px 6px', gap: 4 }}>
            {(['pan', 'zoom'] as WheelMode[]).map((m) => <span key={m} className={`chip${prefs.wheelMode === m ? ' on' : ''}`} style={{ textAlign: 'left' }} onClick={() => prefs.setWheelMode(m)}>{t(`wheel.${m}` as 'wheel.pan')}</span>)}
          </div>
          <div className="menu-sep" />
          <div className="menu-head">存储</div>
          <div className="row" style={{ padding: '0 6px 6px', gap: 6 }}>
            <span className={`chip${cfg.mode === 'local' ? ' on' : ''}`} onClick={() => setCfg({ ...cfg, mode: 'local' })}>{t('home.storage.local')}</span>
            <span className={`chip${cfg.mode === 'remote' ? ' on' : ''}`} onClick={() => setCfg({ ...cfg, mode: 'remote' })}>{t('home.storage.remote')}</span>
          </div>
          {cfg.mode === 'remote' && (
            <div className="col" style={{ padding: '0 6px 6px', gap: 6 }}>
              <input className="input mono" placeholder="https://tracelet.org" value={cfg.url ?? ''} onChange={(e) => setCfg({ ...cfg, url: e.target.value })} />
              <input className="input mono" type="password" placeholder="访问令牌（服务器启用鉴权时必填）" value={cfg.token ?? ''} onChange={(e) => setCfg({ ...cfg, token: e.target.value })} />
              <div className="dim xs">tracelet.org 需要访问令牌，请使用部署连接说明中的令牌值。</div>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn sm" disabled={!cfg.url} onClick={() => { const base = storageBaseUrl(cfg.url ?? ''); const token = normalizeStorageToken(cfg.token); void fetch(`${base}/api/health`, { headers: token ? { authorization: `Bearer ${token}` } : {} }).then(async (r) => { if (!r.ok) throw new Error(storageHttpError(r.status)); const j = await r.json() as { kind?: string; projects?: number }; app.toast(`连接成功：${j.kind === 'postgres' ? 'PostgreSQL' : '文件存储'} · ${j.projects ?? 0} 个项目`, 'success'); }).catch((e: Error) => app.toast(`连接失败：${e.message}`, 'error')); }}>测试连接</button>
                <span className="dim xs">自建：仓库 apps/server，<code>pnpm --filter @tracelet/server start</code>；设 DATABASE_URL 用 PostgreSQL，不设则存 JSON 文件；TRACELET_TOKEN 为访问令牌。</span>
              </div>
            </div>
          )}
          <div className="menu-sep" />
          <div className="menu-head">本地 Agent（MCP 实时桥）</div>
          <div className="col" style={{ padding: '0 6px 6px', gap: 6 }}>
            <div className="row" style={{ gap: 8 }}>
              <span className={`chip${bridge.enabled ? ' on' : ''}`} onClick={() => bridge.set({ enabled: !bridge.enabled })}>{bridge.enabled ? '已开启' : '开启连接'}</span>
              <span className="row xs mono" style={{ gap: 4 }}>端口<input className="input mono" style={{ width: 64, height: 22 }} defaultValue={bridge.port} onBlur={(e) => { const n = Number(e.target.value); if (n > 0 && n < 65536 && n !== bridge.port) bridge.set({ port: n }); }} /></span>
              <span className="ml-auto xs" style={{ color: bridge.status === 'connected' ? 'var(--success)' : bridge.status === 'error' ? 'var(--error)' : 'var(--text-3)' }}>● {{ off: '未连接', connecting: '连接中…', connected: `已连接${bridge.agentEdits ? ` · Agent 修改 ${bridge.agentEdits} 次` : ''}`, error: '连不上' }[bridge.status]}</span>
            </div>
            <div className="dim xs">让 Claude Code 等 MCP 客户端直接操作当前浏览器里打开的项目（按项目 ID）：<code>pnpm cli serve --mcp --live</code>，Agent 的每次修改都是一条可撤销的「Agent 修改」。</div>
          </div>
          <div className="row" style={{ padding: '4px 6px 2px' }}>
            <button className="btn sm primary" onClick={() => { saveStoreConfig({ ...cfg, url: storageBaseUrl(cfg.url ?? ''), token: normalizeStorageToken(cfg.token) }); setOpen(false); app.toast('已保存偏好；存储模式在重新加载后生效', 'success'); }}>保存</button>
            <span className="ml-auto dim xs mono">v0.1.0</span>
          </div>
        </div>
      )}
    </div>
  );
}
