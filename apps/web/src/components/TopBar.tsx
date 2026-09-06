import { relativeTime } from '../i18n/format.js';
import { AppearanceControls } from './AppearanceControls.js';
import { pcb, sch, diffBoardFromSchematic, syncBoardDetailed, exportSchematicPdf, exportAssemblyPdf } from '@tracelet/kernel';
import { exportProjectFile, backupAllProjects, downloadFile, slug, importProjectFiles } from '../store/backup.js';
import { useRef } from 'react';
import { useApp, useEditor, useProject, type Screen } from '../store/app.js';
import { Icon } from './Icon.js';
import { I } from '../icons.js';
import { BrandMark } from './BrandMark.js';
import { useT, usePrefs } from '../i18n/index.js';
import { PrefsMenu } from './PrefsMenu.js';
import { useBridge } from '../store/bridge.js';
import { GuidePanel } from '../panels/GuidePanel.js';

const TABS: { id: Screen; key: 'ws.sch' | 'ws.pcb' | 'ws.3d' | 'ws.lib' | 'ws.bom' | 'ws.fab' }[] = [
  { id: 'sch', key: 'ws.sch' }, { id: 'pcb', key: 'ws.pcb' }, { id: '3d', key: 'ws.3d' }, { id: 'lib', key: 'ws.lib' }, { id: 'bom', key: 'ws.bom' }, { id: 'fab', key: 'ws.fab' }
];

/** 导出 PDF 时把头像里的姓名填进没写作者的图纸 */
function withAuthor<T extends { schematic: { sheets: { frame: { author: string } }[] } }>(p: T): T {
  const a = usePrefs.getState().userName; if (!a) return p;
  return { ...p, schematic: { ...p.schematic, sheets: p.schematic.sheets.map((s) => (s.frame.author ? s : { ...s, frame: { ...s.frame, author: a } })) } };
}

export function TopBar() {
  const project = useProject();
  const editor = useEditor();
  const t = useT();
  const locale = usePrefs((s) => s.locale);
  const fileRef = useRef<HTMLInputElement>(null);
  const { screen, go, projMenuOpen, set, projects, openProject, closeProject, lastSavedAt, saving, toast, guideOpen, saveError } = useApp();
  const bridgeStatus = useBridge((b) => b.status);
  const pendingSync = screen === 'pcb' && (() => { const d = diffBoardFromSchematic(project); return d.added.length + d.removed.length > 0; })();

  const sync = () => {
    const d = diffBoardFromSchematic(project);
    const detail = syncBoardDetailed(project);
    editor.dispatch(pcb.syncFromSchematic());
    toast(`已同步到 PCB：新增 ${d.added.length}，删除 ${d.removed.length}，更新 ${d.updated.length}${detail.mapped.length ? `；${detail.mapped.length} 个 KiCad 封装已映射为内置封装` : ''}`, 'success');
    if (detail.placeholders.length) toast(`${detail.placeholders.length} 个元件没有可用封装，已生成占位封装（${detail.placeholders.slice(0, 4).join('、')}${detail.placeholders.length > 4 ? '…' : ''}），请在属性面板替换`);
    go('pcb');
  };

  return (
    <div className="topbar">
      <button className="iconbtn" title="返回首页" onClick={closeProject}><BrandMark size={24} /></button>
      <div className="topbar-project" style={{ position: 'relative', minWidth: 0 }}>
        <div className="row" style={{ gap: 8, padding: '0 8px', height: 28, borderRadius: 4, cursor: 'pointer', background: projMenuOpen ? 'var(--bg-panel)' : undefined }} onClick={(e) => { e.stopPropagation(); set('projMenuOpen', !projMenuOpen); }}>
          <span style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} data-no-translate>{project.name}</span><span className="muted xs">▾</span>
        </div>
        {projMenuOpen && (
          <div className="menu" style={{ top: 34, left: 0, width: 280 }} onClick={(e) => e.stopPropagation()}>
            <div className="menu-head">切换项目</div>
            {projects.slice(0, 6).map((p) => (
              <div key={p.id} className={`menu-item${p.id === project.id ? ' on' : ''}`} onClick={() => { set('projMenuOpen', false); if (p.id !== project.id) void openProject(p.id); }}>
                <span style={{ width: 14, height: 10, borderRadius: 2, background: 'var(--bg-canvas)', border: '1px solid var(--border)', flex: 'none' }} />
                <span className="grow nowrap" data-no-translate>{p.name}</span><span className="dim xs">{p.copperCount} 层</span>
              </div>
            ))}
            <div className="menu-sep" />
            <div className="menu-item" onClick={() => { set('projMenuOpen', false); set('wizardOpen', true); }}><span style={{ color: 'var(--accent)', width: 14, textAlign: 'center' }}>+</span>新建项目<span className="ml-auto kbd">⌘N</span></div>
            <div className="menu-item" onClick={() => { set('projMenuOpen', false); fileRef.current?.click(); }}><span className="muted" style={{ width: 14, textAlign: 'center' }}>⇪</span>{t('proj.import')}</div>
            <div className="menu-item" onClick={() => { set('projMenuOpen', false); exportProjectFile(project); }}><span className="muted" style={{ width: 14, textAlign: 'center' }}>⇩</span>{t('proj.export')}</div>
            <div className="menu-item" onClick={() => { set('projMenuOpen', false); void backupAllProjects().then((n) => toast(`已备份 ${n} 个项目`, 'success')); }}><span className="muted" style={{ width: 14, textAlign: 'center' }}>⧉</span>{t('proj.backup')}</div>
            <div className="menu-item" title="矢量 PDF，每页一张图纸；标准字体不含中文，中文以 ? 显示" onClick={() => { set('projMenuOpen', false); downloadFile(`${slug(project.name)}-schematic.pdf`, exportSchematicPdf(withAuthor(project), { locale: usePrefs.getState().locale }), 'application/pdf'); toast('已导出原理图 PDF', 'success'); }}><span className="muted" style={{ width: 14, textAlign: 'center' }}>⇩</span>导出原理图 PDF</div>
            <div className="menu-item" title="顶层 / 底层装配图（位号 + 外形）" onClick={() => { set('projMenuOpen', false); downloadFile(`${slug(project.name)}-assembly.pdf`, exportAssemblyPdf(withAuthor(project)), 'application/pdf'); toast('已导出装配图 PDF', 'success'); }}><span className="muted" style={{ width: 14, textAlign: 'center' }}>⇩</span>导出装配图 PDF</div>
            <input ref={fileRef} type="file" accept=".json,.zip,.kicad_sch,.kicad_pcb,.kicad_pro,.SchDoc,.PcbDoc" multiple hidden onChange={(e) => { const fs = e.target.files; if (fs?.length) void importProjectFiles(Array.from(fs)); e.target.value = ''; }} />
            <div className="menu-sep" />
            <div className="menu-item" onClick={() => { const n = prompt('项目名', project.name); if (n && n !== project.name) editor.dispatch(sch.renameProject(n)); set('projMenuOpen', false); }}><span style={{ width: 14 }} />重命名</div>
            <div className="menu-item" onClick={() => { set('projMenuOpen', false); go('fab'); }}><span style={{ width: 14 }} />项目设置<span className="ml-auto dim">层数 · 板厂规则 · 单位</span></div>
            <div className="menu-item" onClick={() => toast('分享与协作需要配置远程存储（设置 → 存储）')}><span style={{ width: 14 }} />分享与协作…</div>
            <div className="menu-item muted" onClick={closeProject}><span style={{ width: 14 }} />关闭项目，返回首页</div>
          </div>
        )}
      </div>
      <span style={{ width: 1, height: 18, background: 'var(--border)', flex: 'none' }} />
      <div className="row workspace-tabs" style={{ gap: 2 }}>
        {TABS.map((tab) => (
          <button key={tab.id} className={`ws-tab${screen === tab.id ? ' on' : ''}`} onClick={() => go(tab.id)}>{t(tab.key)}{tab.id === 'sch' && pendingSync && <span className="badge" />}</button>
        ))}
      </div>
      {screen === 'sch' && (
        <button className="btn quiet topbar-sync" style={{ marginLeft: 6 }} onClick={sync}><Icon d={I.arrow} size={13} stroke={2} />{t('ws.sync')}</button>
      )}
      <button className={`guide-btn ml-auto${guideOpen ? ' on' : ''}`} title={`${t('tab.guide')} · 分步完成一块板`} onClick={() => set('guideOpen', !guideOpen)}><Icon d={I.guide} size={15} stroke={1.8} /></button>
      {guideOpen && <>
        <div className="guide-backdrop" onPointerDown={() => set('guideOpen', false)} />
        <div className="guide-pop">
          <div className="row" style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', gap: 8 }}><Icon d={I.guide} size={14} stroke={1.8} /><span style={{ fontWeight: 500 }}>{t('tab.guide')}</span><button className="btn sm quiet ml-auto" onClick={() => set('guideOpen', false)}>✕</button></div>
          <div style={{ flex: 1, minHeight: 0 }}><GuidePanel /></div>
        </div>
      </>}
      <div className="search-box" onClick={() => set('paletteOpen', true)}>
        <Icon d={I.search} size={13} stroke={2} /><span>{t('ws.search')}</span><span className="ml-auto mono xs">⌘K</span>
      </div>
      <span className="row xs muted topbar-save-status" style={{ gap: 5, whiteSpace: 'nowrap', flex: 'none' }}>
        {bridgeStatus !== 'off' && <span className="xs mono" title="本地 Agent（MCP）连接状态" style={{ color: bridgeStatus === 'connected' ? 'var(--ai)' : 'var(--text-3)', marginRight: 8 }}>{bridgeStatus === 'connected' ? '✨ Agent 已连接' : '✨ Agent 连接中'}</span>}
        {saveError ? <span title={saveError} style={{ color: 'var(--error)', cursor: 'pointer', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }} onClick={() => toast(saveError, 'error')}>● 未保存：{saveError.replace(/^保存失败：/, '')}</span> : <><Icon d={I.cloud} size={13} stroke={2} color={saving ? 'var(--text-3)' : 'var(--success)'} />{saving ? t('ws.saving') : `${t('ws.saved')} · ${lastSavedAt ? relativeTime(lastSavedAt, locale) : ''}`}</>}
      </span>
      <div className="header-preferences"><a className="iconbtn" href="https://github.com/gongbin/tracelet" target="_blank" rel="noreferrer" title="GitHub · gongbin/tracelet" aria-label="GitHub"><Icon d={I.github} size={17} stroke={0} fill /></a><AppearanceControls /></div>
      <PrefsMenu />
    </div>
  );
}
