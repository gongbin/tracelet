import { useState } from 'react';
import { allParts, searchParts, findFootprint } from '@tracelet/kernel';
import { useApp } from '../store/app.js';
import { CategoryFilter, iconUrl } from '../components/CategoryFilter.js';
import { useT } from '../i18n/index.js';
import { Pager, pageSlice } from '../components/Pager.js';

const PAGE = 48;

export function LibPage() {
  const app = useApp();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const t = useT();
  const [page, setPage] = useState(0);
  const results = searchParts(q, allParts(), cat ?? undefined);
  const pg = pageSlice(results, page, PAGE);
  return (
    <div className="page">
      <div className="page-inner">
        <div className="row"><h1>{t('lib.title')}</h1><span className="muted small">内置 {allParts().length} 个零件 · 导入 KiCad 工程会把其中的符号 / 封装带入项目库</span></div>
        <input className="input lg" style={{ maxWidth: 420 }} placeholder="搜索型号、参数、关键字（例如 0402 100nF、esp32、ldo）" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        <CategoryFilter value={cat} onChange={(c) => { setCat(c); setPage(0); }} onlyUsed={false} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {pg.shown.map((p) => (
            <div key={p.id} className="card col" style={{ padding: 14, gap: 6 }}>
              <div className="row"><span className="cat-icon" style={{ ['--icon' as string]: `url(${iconUrl(p.category)})`, color: 'var(--text-2)' }} /><div className="mono nowrap grow" style={{ fontWeight: 500 }}>{p.mpn}</div></div>
              <div className="muted small">{p.maker} · {p.kind} · {p.description}</div>
              <div className="mono xs muted">封装 {findFootprint(p.footprintId)?.name} · {p.pinCount} 引脚</div>
              <div className="row xs" style={{ marginTop: 4 }}><span className="muted">LCSC {p.lcsc}</span><span className="ml-auto">{p.price} · <span style={{ color: 'var(--success)' }}>{p.stock}</span></span></div>
              <button className="btn sm primary" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={() => { app.go('sch'); app.startPlacing({ symbolId: p.symbolId, value: p.value, footprint: p.footprintId, props: { mpn: p.mpn, lcsc: p.lcsc ?? '' }, rotation: 0, partLabel: p.mpn }); }}>{t('lib.place')}</button>
            </div>
          ))}
        </div>
        <Pager page={pg.page} count={pg.count} total={results.length} onChange={setPage} />
      </div>
    </div>
  );
}
