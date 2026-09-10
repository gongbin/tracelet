import { useEffect, useRef, useState } from 'react';
import { BrandMark } from '../components/BrandMark.js';
import { AppearanceControls } from '../components/AppearanceControls.js';
import { usePrefs } from '../i18n/index.js';
import { sections, docText, type DocLanguage } from './docsContent.js';
import '../styles/docs.css';

const REPO = 'https://github.com/gongbin/tracelet';
const tourRegions = [
  { id: 'tabs', zh: '工作区导航', en: 'Workspace navigation', z: '在原理图、PCB、3D、库、BOM 和制造等视图之间切换，同一个项目贯穿完整流程。', e: 'Switch between schematic, PCB, 3D, library, BOM and fabrication views within the same project.' },
  { id: 'tools', zh: '编辑工具', en: 'Editing tools', z: '选择、连线、走线、铺铜和测量等工具在这里切换。操作前确认当前工具与活动图层。', e: 'Choose selection, wiring, routing, zones or measurement tools. Check the active tool and layer before editing.' },
  { id: 'canvas', zh: '设计画布', en: 'Design canvas', z: '放置和连接元件，查看飞线与布线。拖动编辑，双指平移或缩放；自动布局和布线后仍可手动调整。', e: 'Place and connect parts, inspect airwires and routes. Drag to edit and use two fingers to pan or zoom. Refine automatic placement and routing manually.' },
  { id: 'properties', zh: '属性与同步', en: 'Properties and sync', z: '查看选中对象的参数；原理图完成后从这里同步到 PCB。手机端面板默认收起，可手动展开。', e: 'Inspect the selected object and update the PCB from the schematic here. On phones, expand the initially collapsed panel.' },
  { id: 'status', zh: '状态与检查', en: 'Status and checks', z: '关注栅格、活动层、未布线和检查结果。查看具体 ERC / DRC 问题，不能只依据总评分判断板子是否完成。', e: 'Watch the grid, active layer, unrouted connections and checks. Inspect individual ERC / DRC issues rather than relying on an overall score.' }
];

function InterfaceTour({ language }: { language: DocLanguage }) {
  const [selected, select] = useState('canvas');
  const zh = language === 'zh-CN';
  const region = tourRegions.find((r) => r.id === selected)!;
  const button = (id: string, children: React.ReactNode) => {
    const r = tourRegions.find((item) => item.id === id)!;
    return <button type="button" className={`docs-tour-${id} ${id === selected ? 'selected' : ''}`} aria-label={zh ? r.zh : r.en} aria-pressed={id === selected} onClick={() => select(id)}>{children}</button>;
  };
  return <div className="docs-tour">
    <div className="docs-tour-window" role="group" aria-label={zh ? '可交互的编辑器示意图' : 'Interactive editor illustration'}>
      {button('tabs', <><BrandMark size={20} /><span>Tracelet</span><span>SCH</span><strong>PCB</strong><span>3D</span><span>BOM</span></>)}
      {button('tools', <><span>↖</span><span>＋</span><span>⌁</span><span>▧</span><span>↔</span></>)}
      {button('canvas', <svg viewBox="0 0 420 250" aria-hidden="true"><defs><pattern id="docs-grid" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="currentColor" opacity=".2" /></pattern></defs><rect width="420" height="250" fill="url(#docs-grid)"/><rect x="60" y="30" width="290" height="190" rx="12" fill="#153e30" stroke="#b0b6a1" strokeWidth="2"/>{[[76,46],[334,46],[76,204],[334,204]].map(([x,y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="5" fill="#111d22" stroke="#d3b768" strokeWidth="3"/>)}<path d="M145 92H110V170H230V135M230 115h70V75h-70M182 150v38h119V135" stroke="#da6464" fill="none" strokeWidth="3"/><path d="M145 130h-21v-60h158v82M200 75V55h115v120h-70" stroke="#6fa4df" fill="none" strokeWidth="3"/><rect x="145" y="75" width="85" height="80" rx="3" fill="#20252c" stroke="#dedbcc"/>{[85,99,113,127,141].map(y => <g key={y}><rect x="137" y={y} width="16" height="6" fill="#d8bd86"/><rect x="222" y={y} width="16" height="6" fill="#d8bd86"/></g>)}<text x="187" y="120" textAnchor="middle" fill="#dfe6e8" fontSize="15">U1</text><rect x="295" y="87" width="64" height="48" rx="4" fill="#9ba7b0" stroke="#e2e5e9"/><rect x="319" y="94" width="40" height="34" rx="3" fill="#283440"/><text x="296" y="79" fill="#dfe6e8" fontSize="11">USB</text><rect x="100" y="163" width="30" height="13" fill="#cdb385"/><rect x="108" y="163" width="14" height="13" fill="#555d65"/></svg>)}
      {button('properties', <><strong>{zh ? '属性' : 'Properties'}</strong><span>U1</span><span>X　24.0</span><span>Y　18.0</span><span>R　0°</span><span className="docs-tour-pill">{zh ? '同步到 PCB' : 'Update PCB'}</span></>)}
      {button('status', <><span>1 mm</span><span>F.Cu</span><span>ERC · DRC</span><span>↗ 100%</span></>)}
    </div>
    <div className="docs-tour-explanation" aria-live="polite"><span className="docs-eyebrow">{zh ? '当前区域' : 'SELECTED REGION'}</span><h3>{zh ? region.zh : region.en}</h3><p>{zh ? region.z : region.e}</p></div>
    <p className="docs-caption">{zh ? '界面功能示意 · 可用鼠标、触屏或 Tab + Enter 选择区域' : 'Interface illustration · Select regions with a mouse, touch or Tab + Enter'}</p>
  </div>;
}

export function Docs() {
  const locale = usePrefs(s => s.locale);
  const [language, setLanguage] = useState<DocLanguage>(locale === 'zh-CN' || locale === 'zh-TW' ? 'zh-CN' : 'en');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState('overview');
  const [menu, setMenu] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const zh = language === 'zh-CN';
  const tr = (text: [string, string]) => docText(text, language);
  const matches = sections.filter(s => [tr(s.title), tr(s.intro), ...s.blocks.flatMap(b => [tr(b.title), tr(b.body), ...(b.steps ?? []).map(tr), b.code ?? ''])].join(' ').toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    const previous = document.title;
    document.title = zh ? 'Tracelet · 使用文档' : 'Tracelet · Documentation';
    return () => { document.title = previous; };
  }, [zh]);
  useEffect(() => {
    const jump = () => {
      const id = location.hash.slice(1);
      if (sections.some(s => s.id === id)) { document.getElementById(id)?.scrollIntoView(); setActive(id); }
    };
    jump();
    window.addEventListener('hashchange', jump);
    const root = scrollRef.current;
    const onScroll = () => {
      if (!root) return;
      const edge = root.getBoundingClientRect().top + 110;
      let current = sections[0].id;
      for (const section of sections) { if ((document.getElementById(section.id)?.getBoundingClientRect().top ?? Infinity) <= edge) current = section.id; }
      setActive(current);
    };
    root?.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('hashchange', jump); root?.removeEventListener('scroll', onScroll); };
  }, []);
  return <div className="docs-page" data-no-translate lang={language}>
    <a className="docs-skip" href="#docs-content">{zh ? '跳到正文' : 'Skip to content'}</a>
    <header className="docs-header"><a href="/" className="docs-brand"><BrandMark size={26}/><strong>Tracelet</strong><span>{zh ? '文档' : 'Docs'}</span></a><div className="docs-header-actions"><a href="/">{zh ? '打开编辑器' : 'Open editor'} ↗</a><a href={REPO} target="_blank" rel="noreferrer">GitHub ↗</a><AppearanceControls /></div></header>
    <div className="docs-layout">
      <aside className="docs-sidebar"><button className="docs-menu-toggle" aria-expanded={menu} aria-controls="docs-navigation" onClick={() => setMenu(!menu)}>{zh ? '文档目录' : 'Contents'} <span>{menu ? '−' : '+'}</span></button>
        <div id="docs-navigation" className={`docs-navigation ${menu ? 'open' : ''}`}>
          <label className="docs-search"><span>{zh ? '搜索文档' : 'Search documentation'}</span><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={zh ? '功能、操作或问题…' : 'Feature, task or question…'} /></label>
          <label className="docs-language">{zh ? '正文语言' : 'Content language'}<select value={language} onChange={e => setLanguage(e.target.value as DocLanguage)}><option value="zh-CN">简体中文</option><option value="en">English</option></select></label>
          <nav aria-label={zh ? '文档目录' : 'Documentation contents'}>{matches.map(s => <a href={`#${s.id}`} key={s.id} aria-current={active === s.id ? 'location' : undefined} onClick={() => { setActive(s.id); setMenu(false); }}>{tr(s.title)}</a>)}</nav>
          {!matches.length && <p role="status" className="docs-caption">{zh ? '没有匹配章节，试试其他关键词。' : 'No matching chapters. Try another keyword.'}</p>}
          <div className="docs-sidebar-footer">{zh ? '用户手册 · 中英文正文' : 'User manual · Chinese & English'}<br/><a href={`${REPO}/issues`} target="_blank" rel="noreferrer">{zh ? '反馈问题或改进建议' : 'Report an issue or suggest a change'} ↗</a></div>
        </div>
      </aside>
      <div className="docs-scroll" ref={scrollRef}><main id="docs-content" className="docs-content" tabIndex={-1}>
        <div className="docs-hero"><span className="docs-eyebrow">TRACELET / DOCUMENTATION</span><h1>{zh ? '把想法，做成电路。' : 'Turn an idea into a circuit.'}</h1><p>{zh ? '从第一个元件到制造交付，了解每一步如何操作，以及什么时候需要你来判断。' : 'From the first component to fabrication: learn what to do at each step, and where your judgment matters.'}</p><div className="docs-hero-links"><a className="btn primary" href="#quickstart">{zh ? '开始第一块板' : 'Build your first board'} →</a><a className="btn" href="#interface">{zh ? '探索编辑器' : 'Explore the editor'}</a></div></div>
        {sections.map((section, index) => <section className="docs-section" id={section.id} key={section.id} aria-labelledby={`${section.id}-heading`}><div className="docs-section-title"><span>{String(index + 1).padStart(2, '0')}</span><h2 id={`${section.id}-heading`}>{tr(section.title)}</h2><a href={`#${section.id}`} aria-label={`${zh ? '章节链接' : 'Link to'}: ${tr(section.title)}`}>#</a></div><p className="docs-intro">{tr(section.intro)}</p>
          {section.id === 'interface' && <InterfaceTour language={language}/>}
          {section.blocks.map((block, i) => section.id === 'faq' ? <details className="docs-faq" key={i}><summary>{tr(block.title)}</summary><p>{tr(block.body)}</p></details> : <div className="docs-block" key={i}><h3>{tr(block.title)}</h3><p>{tr(block.body)}</p>{block.steps && <ol>{block.steps.map((step, j) => <li key={j}>{tr(step)}</li>)}</ol>}{block.code && <pre><code>{block.code}</code></pre>}</div>)}
          {section.id === 'automation' && <a href={`${REPO}/blob/main/MCP.md`} target="_blank" rel="noreferrer">{zh ? '阅读完整 MCP 用户文档' : 'Read the full MCP user guide'} ↗</a>}
        </section>)}
        <footer className="docs-end"><BrandMark size={24}/><p>{zh ? '准备好开始了？' : 'Ready to start?'}</p><a href="/">{zh ? '返回首页，创建项目' : 'Return home and create a project'} →</a></footer>
      </main></div>
    </div>
  </div>;
}
