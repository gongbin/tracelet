import { useMemo, useState } from 'react';
import { exportFabFiles, type FabFile } from '@tracelet/kernel';
import { useProject } from '../../store/app.js';
import { interpretGerber } from './gerberInterpret.js';

const COLORS: Record<string, string> = { gtl: '#C83434', gbl: '#4D7FC4', g2: '#E08A2E', g3: '#3FA34D', gts: '#B06CD9', gbs: '#4FC3D9', gtp: '#9AA1AD', gbp: '#9AA1AD', gto: '#F2F2F2', gbo: '#E8D0A9', gm1: '#D0D2D6', drl: '#FFD84D' };

/** 逐层预览导出的 Gerber（第三方解析 → 图元渲染），Y 轴向上与 Gerber 一致。 */
export function GerberPreview({ onClose }: { onClose: () => void }) {
  const project = useProject();
  const files = useMemo(() => exportFabFiles(project, { bom: false, pnp: false }).filter((f) => f.kind === 'gerber' || f.kind === 'drill'), [project]);
  const [sel, setSel] = useState<string[]>(() => files.filter((f) => /\.(gtl|gto|gm1|drl)$/.test(f.name) && !/NPTH/.test(f.name)).map((f) => f.name));
  const images = useMemo(() => new Map(files.map((f) => [f.name, interpretGerber(f.content)])), [files]);
  const shown = files.filter((f) => sel.includes(f.name));
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const f of files) { const b = images.get(f.name)!.bounds; if (b.maxX > b.minX) { bounds.minX = Math.min(bounds.minX, b.minX); bounds.minY = Math.min(bounds.minY, b.minY); bounds.maxX = Math.max(bounds.maxX, b.maxX); bounds.maxY = Math.max(bounds.maxY, b.maxY); } }
  if (!isFinite(bounds.minX)) Object.assign(bounds, { minX: 0, minY: 0, maxX: 10, maxY: 10 });
  const pad = 2;
  const vb = `${bounds.minX - pad} ${-bounds.maxY - pad} ${bounds.maxX - bounds.minX + 2 * pad} ${bounds.maxY - bounds.minY + 2 * pad}`;
  const ext = (f: FabFile) => f.name.split('.').pop()!;
  const toggle = (n: string) => setSel(sel.includes(n) ? sel.filter((x) => x !== n) : [...sel, n]);
  const total = files.reduce((n, f) => n + images.get(f.name)!.unimplemented, 0);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" style={{ width: 1000, maxWidth: 'calc(100vw - 32px)', height: 'min(720px, calc(100vh - 32px))' }} onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <div><div style={{ fontWeight: 600, fontSize: 15 }}>Gerber 预览</div><div className="small muted" style={{ marginTop: 2 }}>由第三方解析器（tracespace）读取导出的文件后渲染 · {files.length} 个文件 · {total ? `${total} 条未识别指令` : '全部指令可识别（X2 属性除外）'}</div></div>
          <span className="ml-auto muted" style={{ cursor: 'pointer', fontSize: 16 }} onClick={onClose}>✕</span>
        </div>
        <div className="row" style={{ flex: 1, minHeight: 0, alignItems: 'stretch', gap: 0 }}>
          <div className="col" style={{ width: 260, flex: 'none', borderRight: '1px solid var(--border)', padding: 10, gap: 4, overflow: 'auto' }}>
            {files.map((f) => { const img = images.get(f.name)!; return (
              <label key={f.name} className="row" style={{ gap: 8, padding: '5px 6px', borderRadius: 4, cursor: 'pointer', background: sel.includes(f.name) ? 'var(--bg-raised)' : undefined }} onClick={() => toggle(f.name)}>
                <span className={`check${sel.includes(f.name) ? ' on' : ''}`} style={{ background: sel.includes(f.name) ? COLORS[ext(f)] : undefined, borderColor: COLORS[ext(f)] }} />
                <span className="mono xs nowrap grow">{f.name}</span>
                <span className="dim xs">{img.prims.length}</span>
              </label>
            ); })}
          </div>
          <div className="grow" style={{ background: '#111318', position: 'relative' }}>
            <svg viewBox={vb} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} preserveAspectRatio="xMidYMid meet">
              <g transform="scale(1 -1)">
                {shown.map((f) => { const img = images.get(f.name)!; const color = COLORS[ext(f)] ?? '#fff'; const isDrill = f.kind === 'drill'; return (
                  <g key={f.name} opacity={0.85}>
                    {img.prims.map((p, i) => {
                      const fill = p.clear ? '#111318' : color;
                      if (p.kind === 'line') return <line key={i} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke={fill} strokeWidth={p.w} strokeLinecap="round" />;
                      if (p.kind === 'circle') return <circle key={i} cx={p.x} cy={p.y} r={p.d / 2} fill={isDrill ? '#111318' : fill} stroke={isDrill ? color : 'none'} strokeWidth={isDrill ? 0.08 : 0} />;
                      if (p.kind === 'rect') return <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} rx={p.r} fill={fill} />;
                      return <polygon key={i} points={p.pts.map(([x, y]) => `${x},${y}`).join(' ')} fill={fill} />;
                    })}
                  </g>
                ); })}
              </g>
            </svg>
            <div className="float" style={{ left: 12, bottom: 12, top: 'auto' }}>{(bounds.maxX - bounds.minX).toFixed(1)} × {(bounds.maxY - bounds.minY).toFixed(1)} mm</div>
          </div>
        </div>
      </div>
    </div>
  );
}
