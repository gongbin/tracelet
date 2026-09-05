import { buildBom, exportBomCsv, BUILTIN_PARTS } from '@tracelet/kernel';
import { useApp, useProject } from '../store/app.js';

export function BomPage() {
  const project = useProject();
  const app = useApp();
  const rows = buildBom(project);
  const total = rows.reduce((n, r) => n + r.qty, 0);
  const priceOf = (r: (typeof rows)[number]) => { const p = BUILTIN_PARTS.find((x) => x.mpn === r.mpn || x.value === r.value); return p?.price ? Number(p.price.replace(/[^\d.]/g, '')) : null; };
  const sum = rows.reduce((n, r) => { const p = priceOf(r); return p == null ? n : n + p * r.qty; }, 0);
  return (
    <div className="page">
      <div className="page-inner" style={{ maxWidth: 1000 }}>
        <div className="row"><h1>BOM</h1><span className="muted small">{rows.length} 种 · {total} 个元件 · 估算 ¥{sum.toFixed(2)}（LCSC 单价）</span>
          <button className="btn ml-auto" onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([exportBomCsv(project)], { type: 'text/csv' })); a.download = `${project.name}_bom.csv`; a.click(); app.toast('已下载 BOM（LCSC 模板）', 'success'); }}>⇩ 下载 CSV（LCSC 模板）</button>
        </div>
        <div className="card" style={{ overflow: 'auto' }}>
          <table className="data">
            <thead><tr><th>#</th><th>值</th><th>位号</th><th>封装</th><th>数量</th><th>MPN</th><th>LCSC</th><th>单价</th></tr></thead>
            <tbody>
              {rows.map((r, i) => { const p = priceOf(r); return (
                <tr key={i}><td className="dim">{i + 1}</td><td className="mono">{r.value}</td><td className="mono">{r.refs.join(', ')}</td><td className="mono muted">{r.footprint}</td><td className="mono">{r.qty}</td><td className="mono muted">{r.mpn || '—'}</td><td className="mono muted">{r.lcsc || '—'}</td><td className="mono">{p == null ? '—' : `¥${p.toFixed(2)}`}</td></tr>
              ); })}
              {rows.length === 0 && <tr><td colSpan={8} className="dim">原理图里还没有元件</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
