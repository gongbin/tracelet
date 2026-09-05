import { symbolLocalStrokes, pinLocal, type SymbolDef, type FootprintDef } from '@tracelet/kernel';

/** 符号缩略图：用内核的矢量几何绘制（内置图形与导入的 shapes 通用）。 */
export function SymbolThumb({ sym, size = 30 }: { sym: SymbolDef; size?: number }) {
  const strokes = symbolLocalStrokes(sym);
  const pins = sym.pins.filter((p) => !p.hidden).map((p) => pinLocal(sym, p));
  const xs = [0, sym.width, ...pins.flatMap((p) => [p.base.x, p.end.x])], ys = [0, sym.height, ...pins.flatMap((p) => [p.base.y, p.end.y])];
  const minX = Math.min(...xs) - 60, minY = Math.min(...ys) - 60, w = Math.max(...xs) - minX + 60, h = Math.max(...ys) - minY + 60;
  const ext = Math.max(w, h);
  const ox = minX - (ext - w) / 2, oy = minY - (ext - h) / 2;
  const sw = ext / 60;
  return (
    <svg width={size} height={size} viewBox={`${ox} ${oy} ${ext} ${ext}`}>
      <g stroke={sym.color ?? '#7A1F1F'} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round">
        {strokes.lines.map((l, i) => <path key={i} d={l.points.map((p, j) => `${j ? 'L' : 'M'}${p.x} ${p.y}`).join('')} fill={l.fill ? '#FFFBE8' : 'none'} />)}
        {strokes.circles.map((c, i) => <circle key={'c' + i} cx={c.c.x} cy={c.c.y} r={c.r} fill={c.fill ? '#FFFBE8' : 'none'} />)}
        {pins.map((p, i) => <path key={'p' + i} d={`M${p.base.x} ${p.base.y}L${p.end.x} ${p.end.y}`} />)}
      </g>
    </svg>
  );
}

/** 封装缩略图。 */
export function FootprintThumb({ fp, size = 60 }: { fp: FootprintDef; size?: number }) {
  const ext = Math.max(fp.body.w, fp.body.h, ...fp.pads.map((p) => Math.abs(p.x) * 2 + p.w), ...fp.pads.map((p) => Math.abs(p.y) * 2 + p.h)) * 1.25 || 2;
  return (
    <svg width={size} height={size} viewBox={`${-ext / 2} ${-ext / 2} ${ext} ${ext}`}>
      <rect x={-fp.body.w / 2} y={-fp.body.h / 2} width={fp.body.w} height={fp.body.h} fill="none" stroke="#F2F2F2" strokeWidth={ext / 120} />
      {fp.pads.map((p, i) => p.shape === 'circle' || p.shape === 'oval'
        ? <ellipse key={i} cx={p.x} cy={p.y} rx={p.w / 2} ry={p.h / 2} fill={p.npth ? 'none' : '#C83434'} stroke={p.npth ? '#D0D2D6' : 'none'} strokeWidth={ext / 120} />
        : <rect key={i} x={p.x - p.w / 2} y={p.y - p.h / 2} width={p.w} height={p.h} rx={p.shape === 'roundrect' ? Math.min(p.w, p.h) * 0.25 : 0} fill="#C83434" />)}
      {fp.pads.filter((p) => p.drill > 0).map((p, i) => <circle key={'d' + i} cx={p.x} cy={p.y} r={p.drill / 2} fill="#1A1D23" />)}
    </svg>
  );
}
