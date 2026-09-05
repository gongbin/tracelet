import { useRef } from 'react';
import { PROJECT_TEMPLATES, createDemoProject } from '@tracelet/kernel';
import { importProjectFiles, backupAllProjects } from '../store/backup.js';
import { useApp } from '../store/app.js';
import { Icon } from '../components/Icon.js';
import { I } from '../icons.js';
import { useT } from '../i18n/index.js';
import { PrefsMenu } from '../components/PrefsMenu.js';

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} 天前`;
  return new Date(iso).toLocaleDateString();
}

const SAMPLES = [
  ...PROJECT_TEMPLATES.filter((t) => t.id !== 'blank').map((t) => ({ id: t.id, name: t.name, meta: t.description, create: () => t.create() })),
  { id: 'demo', name: 'ESP32 传感器板（示例）', meta: '带走线、铺铜与过孔的完整小板，适合先看看 PCB / 3D / 制造页', create: () => createDemoProject() }
];

export function Home() {
  const { projects, openProject, deleteProject, set, toast, store, openProjectObject } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const t = useT();

  const onImport = async (files: File[]) => { await importProjectFiles(files); };

  return (
    <div className="home" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const fs = Array.from(e.dataTransfer.files); if (fs.length) void onImport(fs); }}>
      <div className="home-nav">
        <div className="row" style={{ gap: 8, flexShrink: 0, color: '#F5F5F7', fontWeight: 600, fontSize: 18, letterSpacing: '-0.5px' }}>
          <img src={`${import.meta.env.BASE_URL}brand/tracelet-mark-white.svg`} alt="" width={28} height={28} style={{ display: 'block' }} />
          <span>Tracelet</span>
        </div>
        <div className="row" style={{ gap: 20 }}><span style={{ fontWeight: 500 }}>{t('nav.projects')}</span><span className="muted">{t('nav.library')}</span><span className="muted">{t('nav.community')}</span><span className="muted">{t('nav.docs')}</span></div>
        <div className="search-box ml-auto" style={{ flexBasis: 260 }} onClick={() => set('paletteOpen', true)}><Icon d={I.search} size={14} stroke={2} /><span>{t('home.search')}</span><span className="ml-auto mono xs">⌘K</span></div>
        <span className="xs muted mono" title="存储模式">{store.kind === 'local' ? t('home.storage.local') : t('home.storage.remote')}</span>
        <PrefsMenu large />
      </div>
      <div className="home-main">
        <div className="onboard">
          <span style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Icon d={I.bulb} size={18} stroke={2} color="#fff" /></span>
          <div className="col" style={{ gap: 2, minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 14 }}>{t('home.onboard.title')}</div><div className="small muted">{t('home.onboard.body')}</div></div>
          <button className="btn primary ml-auto" style={{ height: 30, flex: 'none' }} onClick={() => set('wizardOpen', true)}>{t('home.start')}</button>
        </div>
        <div className="action-cards">
          <div className="action-card primary" onClick={() => set('wizardOpen', true)}>
            <div className="row" style={{ fontWeight: 600, fontSize: 14 }}><span style={{ color: 'var(--accent)', fontSize: 18, lineHeight: 1 }}>+</span>{t('home.new')}</div>
            <div className="small muted">空白 / 向导（层数 · 板厂规则 · 单位）</div>
          </div>
          <div className="action-card" onClick={() => fileRef.current?.click()}>
            <div className="row" style={{ fontWeight: 600, fontSize: 14 }}><Icon d={I.upload} size={16} stroke={2} color="var(--text-2)" />{t('home.import')}</div>
            <div className="small muted">KiCad：多选全部 .kicad_sch + .kicad_pcb 或拖整个工程 zip · 嘉立创 EDA 标准版：文件 → 导出 → EasyEDA 源码（JSON）· 也支持 .eda.json / 备份 zip</div>
            <input ref={fileRef} type="file" accept=".json,.eda.json,.zip,.kicad_sch,.kicad_pcb,.kicad_pro,.eprj,.esch,.epcb" multiple hidden onChange={(e) => { const fs = e.target.files ? Array.from(e.target.files) : []; if (fs.length) void onImport(fs); e.target.value = ''; }} />
          </div>
          <div className="action-card" onClick={() => set('wizardOpen', true)}>
            <div className="row" style={{ fontWeight: 600, fontSize: 14 }}><Icon d={I.file} size={16} stroke={2} color="var(--text-2)" />{t('home.template')}</div>
            <div className="small muted">ESP32 · STM32 · Arduino 扩展板</div>
          </div>
        </div>
        <div className="col" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{t('home.recent')}</h2>
            <button className="btn sm ml-auto" onClick={() => void backupAllProjects().then((n) => toast(`已备份 ${n} 个项目`, 'success'))}>⧉ {t('proj.backup')}</button>
            <div className="seg sm" style={{ height: 24 }}><span className="seg-opt" style={{ padding: '0 8px' }}>列表</span><span className="seg-opt" style={{ padding: '0 8px', background: 'var(--bg-raised)', color: 'var(--text)' }}>网格</span></div>
          </div>
          <div className="proj-grid">
            {projects.length === 0 && <div className="dim">还没有项目，点上面"新建项目"开始。</div>}
            {projects.map((p) => (
              <div key={p.id} className="proj-card" onClick={() => void openProject(p.id)}>
                <div className="proj-thumb">
                  <svg width="150" height="90" viewBox="0 0 150 90"><rect x="8" y="8" width="134" height="74" rx="6" fill="#2A2F38" stroke="#D0D2D6" strokeWidth="1.5" /><rect x="30" y="26" width="34" height="34" fill="#1A1D23" stroke="#C83434" /><rect x="84" y="22" width="10" height="6" fill="#C83434" /><rect x="84" y="34" width="10" height="6" fill="#C83434" /><rect x="84" y="46" width="10" height="6" fill="#C83434" /><rect x="112" y="30" width="10" height="20" fill="#C83434" /><path d="M64 43h20M94 37h18M94 49h18" stroke="#C83434" strokeWidth="2" /><path d="M30 70h60" stroke="#4D7FC4" strokeWidth="2" opacity=".5" /><circle cx="18" cy="18" r="3" fill="none" stroke="#D0D2D6" /><circle cx="132" cy="72" r="3" fill="none" stroke="#D0D2D6" /></svg>
                </div>
                <div className="col" style={{ padding: '10px 12px', gap: 2 }}>
                  <div style={{ fontWeight: 500 }}>{p.name}</div>
                  <div className="small muted">{timeAgo(p.updatedAt)} · {p.copperCount} 层 · {p.componentCount} 元件</div>
                </div>
                <button className="btn sm ghost del" onClick={(e) => { e.stopPropagation(); if (confirm(`删除项目「${p.name}」？此操作不可撤销。`)) void deleteProject(p.id); }}>删除</button>
              </div>
            ))}
          </div>
        </div>
        <div className="col" style={{ gap: 14 }}>
          <div><h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{t('home.community')}</h2><div className="small muted" style={{ marginTop: 2 }}>一键生成到你的项目里，随意改</div></div>
          <div className="community-grid">
            {SAMPLES.map((c) => (
              <div key={c.id} className="card row" style={{ gap: 12, padding: 12 }}>
                <div style={{ width: 56, height: 40, borderRadius: 4, background: 'var(--bg-canvas)', border: '1px solid var(--border)', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon d={I.file} size={16} stroke={2} color="var(--text-3)" /></div>
                <div className="col" style={{ gap: 2, minWidth: 0 }}><div className="nowrap" style={{ fontWeight: 500 }}>{c.name}</div><div className="small muted" title={c.meta} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.meta}</div></div>
                <button className="btn ml-auto" style={{ flex: 'none' }} onClick={() => { openProjectObject(c.create()); toast(`已从「${c.name}」创建项目`, 'success'); }}>创建</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
