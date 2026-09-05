import { useMemo } from 'react';
import { create } from 'zustand';
import { footprintBody, footprintDef, footprintPads, boardBounds, type Vec } from '@tracelet/kernel';
import { useApp, useProject } from '../../store/app.js';

export const MASK_COLORS: Record<string, [string, string, string]> = {
  '绿': ['#1E6B3A', '#144A28', '#0F3A1F'], '黑': ['#2B2B2B', '#1C1C1C', '#141414'], '白': ['#E8E8E4', '#BDBDB8', '#9E9E99'],
  '蓝': ['#1F4E8C', '#153661', '#0F2846'], '红': ['#8C1F1F', '#611515', '#460F0F'], '黄': ['#B59A1E', '#7F6B15', '#5C4D0F'], '紫': ['#5B2D8C', '#3F1F61', '#2D1646']
};

interface View3dState { components: boolean; silk: boolean; mask: boolean; copper: boolean; maskColor: string; silkColor: string; finish: string; set: (p: Partial<View3dState>) => void }
export const use3d = create<View3dState>((set) => ({ components: true, silk: true, mask: true, copper: false, maskColor: '绿', silkColor: '白', finish: 'HASL', set: (p) => set(p) }));

/** 简易等轴投影（占位实现；Three.js + STEP/glTF 在后续里程碑接入）。 */
export function ThreeView() {
  const project = useProject();
  const app = useApp();
  const s3 = use3d();
  const board = project.board;
  const view = app.view3d;

  const proj = useMemo(() => {
    const bb = boardBounds(board);
    const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
    const c30 = Math.cos(Math.PI / 6), s30 = Math.sin(Math.PI / 6);
    return (p: Vec, z: number): Vec => {
      let x = p.x - cx, y = p.y - cy;
      if (view === 'back') { x = -x; z = -z; }
      if (view === 'top') return { x, y };
      if (view === 'front') return { x, y: y * 0.35 - z };
      return { x: (x - y) * c30, y: (x + y) * s30 - z };
    };
  }, [board, view]);

  const Z = 1.5; // 高度夸张系数，让 1.6mm 板厚可见
  const th = board.thickness * Z;
  const [top, side1, side2] = MASK_COLORS[s3.maskColor] ?? MASK_COLORS['绿'];
  const P = (pts: Vec[]) => pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const outline = board.outline;
  const topFace = outline.map((p) => proj(p, 0));
  const botFace = outline.map((p) => proj(p, -th));

  const items = board.footprints.map((fp) => {
    const b = footprintBody(fp);
    const h = (fp.side === 'F' ? 1 : -1) * footprintDef(fp).height * Z;
    const base = fp.side === 'F' ? 0 : -th;
    const c = [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }];
    return { fp, depth: fp.x + fp.y, c, base, h };
  }).sort((a, b) => a.depth - b.depth);

  const all = [...topFace, ...botFace];
  const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
  const minX = Math.min(...xs) - 6, maxX = Math.max(...xs) + 6, minY = Math.min(...ys) - 12, maxY = Math.max(...ys) + 6;
  const bb = boardBounds(board);

  return (
    <div className="canvas-wrap" style={{ background: 'radial-gradient(ellipse at 50% 40%,#2A2F38,#1A1D23 70%)' }}>
      <svg className="stage" viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} preserveAspectRatio="xMidYMid meet">
        {view !== 'top' && <>
          {outline.map((p, i) => { const q = outline[(i + 1) % outline.length]; const a = proj(p, 0), b = proj(q, 0), c = proj(q, -th), d = proj(p, -th); const dark = (a.x + b.x) / 2 < 0 ? side1 : side2; return <polygon key={i} points={P([a, b, c, d])} fill={dark} />; })}
        </>}
        <polygon points={P(topFace)} fill={s3.mask ? top : '#B8862B'} stroke={s3.mask ? '#2E8A4E' : '#8a6a1a'} strokeWidth={0.15} />
        {s3.copper && board.traces.filter((t) => t.layer === 'F.Cu').map((t) => <polyline key={t.id} points={P(t.points.map((p) => proj(p, 0.01)))} fill="none" stroke="#C9A24A" strokeWidth={t.width} opacity={0.9} />)}
        {items.map(({ fp, c, base, h }) => {
          const pads = footprintPads(fp, board);
          const zTop = base + h;
          const topPts = c.map((p) => proj(p, zTop));
          const sel = app.pcbSelection.includes(fp.id);
          return <g key={fp.id} onClick={() => app.patch({ pcbSelection: [fp.id] })} style={{ cursor: 'pointer' }}>
            {pads.map((pd, i) => <polygon key={i} points={P([{ x: pd.rect.x, y: pd.rect.y }, { x: pd.rect.x + pd.rect.w, y: pd.rect.y }, { x: pd.rect.x + pd.rect.w, y: pd.rect.y + pd.rect.h }, { x: pd.rect.x, y: pd.rect.y + pd.rect.h }].map((p) => proj(p, base + 0.02)))} fill={s3.finish === 'ENIG' ? '#D4AF37' : '#C0C0C0'} />)}
            {s3.components && view !== 'top' && <>
              <polygon points={P([proj(c[3], base), proj(c[2], base), proj(c[2], zTop), proj(c[3], zTop)])} fill="#6B7079" />
              <polygon points={P([proj(c[1], base), proj(c[2], base), proj(c[2], zTop), proj(c[1], zTop)])} fill="#8A8F98" />
            </>}
            {s3.components && <polygon points={P(topPts)} fill={sel ? '#FFD84D' : '#B8BCC4'} stroke={sel ? '#E5B800' : '#9AA1AD'} strokeWidth={0.05} />}
            {s3.silk && <text x={topPts.reduce((a, p) => a + p.x, 0) / 4} y={topPts.reduce((a, p) => a + p.y, 0) / 4 + 0.4} fontSize={1} fill="#16181D" textAnchor="middle" fontFamily="JetBrains Mono,monospace" pointerEvents="none">{fp.ref}</text>}
          </g>;
        })}
      </svg>
      <div className="float" style={{ left: '50%', bottom: 14, top: 'auto', transform: 'translateX(-50%)', padding: 3, gap: 2, fontFamily: 'var(--font-ui)', fontSize: 12 }}>
        {([['front', '正面'], ['back', '背面'], ['top', '俯视'], ['iso', '等轴']] as const).map(([id, l]) => <span key={id} className="pill" style={{ padding: '4px 12px', borderRadius: 4, cursor: 'pointer', background: view === id ? 'var(--bg-raised)' : 'transparent', color: view === id ? 'var(--text)' : 'var(--text-2)' }} onClick={() => app.set('view3d', id)}>{l}</span>)}
      </div>
      <div className="float" style={{ left: 12, top: 12, fontFamily: 'var(--font-ui)', fontSize: 12, padding: '6px 10px' }}>
        <span style={{ color: 'var(--warning)' }}>⚠</span>{board.footprints.length} 个元件使用占位模型（STEP → glTF 转换在下一里程碑）<a href="#" onClick={(e) => { e.preventDefault(); app.toast('3D 模型匹配在下一里程碑'); }}>去匹配 →</a>
      </div>
      <div className="float" style={{ right: 12, top: 12 }}><span className="dim">板</span><span>{bb.w.toFixed(1)}×{bb.h.toFixed(1)}×{board.thickness} mm</span></div>
    </div>
  );
}
