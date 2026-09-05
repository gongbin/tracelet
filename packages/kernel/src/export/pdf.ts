/**
 * 纯 ASCII 的最小 PDF 写出器（无压缩、Helvetica），用于原理图 PDF 与装配图 PDF。
 * 不依赖任何库；内容流只含 ASCII，因此 content.length 即字节数，可直接作为 zip 文本条目。
 * 非 Latin-1 字符（如中文）在 PDF 标准字体中无法显示，以 ? 代替；网页端可用浏览器打印获得完整字体。
 */
import type { Project } from '../model/project.js';
import type { Sheet } from '../model/schematic.js';
import { paperSize } from '../model/schematic.js';
import { getSymbol } from '../library/symbols.js';
import { componentStrokes } from '../schematic/render.js';
import { allPads, footprintBody, boardBounds } from '../board/geometry.js';
import type { Vec } from '../geometry.js';

const f = (v: number) => (Math.round(v * 100) / 100).toString();

/** 页面画笔：世界坐标（用户单位）→ 点，y 翻转。 */
export class PdfPainter {
  private ops: string[] = [];
  constructor(private readonly scale: number, private readonly ox: number, private readonly oy: number, private readonly pageH: number) {}
  private X(x: number) { return f(this.ox + x * this.scale); }
  private Y(y: number) { return f(this.pageH - (this.oy + y * this.scale)); }
  color(hex: string, stroke = true) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return;
    const n = parseInt(m[1], 16); const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    this.ops.push(`${f(r)} ${f(g)} ${f(b)} ${stroke ? 'RG' : 'rg'}`);
  }
  polyline(points: Vec[], width: number, opts: { fill?: boolean; close?: boolean; dash?: boolean } = {}) {
    if (points.length < 2) return;
    this.ops.push(`${f(Math.max(0.2, width * this.scale))} w 1 J 1 j${opts.dash ? ' [3 2] 0 d' : ' [] 0 d'}`);
    this.ops.push(`${this.X(points[0].x)} ${this.Y(points[0].y)} m ` + points.slice(1).map((p) => `${this.X(p.x)} ${this.Y(p.y)} l`).join(' ') + (opts.close ? ' h' : '') + (opts.fill ? ' B' : ' S'));
  }
  rect(x: number, y: number, w: number, h: number, width: number, fill = false) { this.polyline([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], width, { close: true, fill }); }
  circle(c: Vec, r: number, width: number, fill = false) {
    const k = 0.5523 * r, pts = (a: Vec, b: Vec, cc: Vec, d: Vec) => `${this.X(a.x)} ${this.Y(a.y)} ${this.X(b.x)} ${this.Y(b.y)} ${this.X(cc.x)} ${this.Y(cc.y)} ${this.X(d.x)} ${this.Y(d.y)}`;
    this.ops.push(`${f(Math.max(0.2, width * this.scale))} w`);
    const P = (x: number, y: number) => ({ x: c.x + x, y: c.y + y });
    this.ops.push(`${this.X(c.x + r)} ${this.Y(c.y)} m`);
    const segs: [Vec, Vec, Vec][] = [[P(r, k), P(k, r), P(0, r)], [P(-k, r), P(-r, k), P(-r, 0)], [P(-r, -k), P(-k, -r), P(0, -r)], [P(k, -r), P(r, -k), P(r, 0)]];
    for (const [a, b, d] of segs) this.ops.push(`${pts(a, b, d, d).split(' ').slice(0, 6).join(' ')} c`);
    this.ops.push(fill ? 'B' : 'S');
  }
  text(x: number, y: number, text: string, size: number, anchor: 'start' | 'middle' | 'end' = 'start', opts: { bold?: boolean; rotate?: number } = {}) {
    const t = toLatin(text); if (!t) return;
    const pt = size * this.scale; if (pt < 1) return;
    const width = t.length * pt * 0.55;
    const shift = anchor === 'middle' ? -width / 2 : anchor === 'end' ? -width : 0;
    const px = this.ox + x * this.scale, py = this.pageH - (this.oy + y * this.scale);
    const rot = ((opts.rotate ?? 0) * Math.PI) / 180, c = Math.cos(rot), s = Math.sin(rot);
    this.ops.push(`BT /${opts.bold ? 'F2' : 'F1'} ${f(pt)} Tf ${f(c)} ${f(s)} ${f(-s)} ${f(c)} ${f(px + shift * c)} ${f(py + shift * s)} Tm (${t}) Tj ET`);
  }
  raw(op: string) { this.ops.push(op); }
  content(): string { return this.ops.join('\n'); }
}

function toLatin(s: string): string {
  let out = '';
  for (const ch of s) { const c = ch.codePointAt(0)!; out += c === 40 || c === 41 || c === 92 ? '\\' + ch : c < 32 || c > 126 ? (c > 255 ? '?' : `\\${c.toString(8).padStart(3, '0')}`) : ch; }
  return out;
}

export class PdfDoc {
  private objects: string[] = [];
  private pages: number[] = [];
  private fonts: [number, number];
  constructor(private meta: { title?: string; author?: string } = {}) {
    this.fonts = [this.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'), this.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')];
  }
  private add(body: string): number { this.objects.push(body); return this.objects.length; }
  /** 添加一页（尺寸单位 pt）。 */
  addPage(w: number, h: number, content: string) {
    const c = this.add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    this.pages.push(this.add(`<< /Type /Page /Parent @PAGES@ /MediaBox [0 0 ${f(w)} ${f(h)}] /Contents ${c} 0 R /Resources << /Font << /F1 ${this.fonts[0]} 0 R /F2 ${this.fonts[1]} 0 R >> >> >>`));
  }
  build(): string {
    const pagesId = this.add(`<< /Type /Pages /Kids [${this.pages.map((p) => `${p} 0 R`).join(' ')}] /Count ${this.pages.length} >>`);
    const catalogId = this.add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    const infoId = this.add(`<< /Producer (Tracelet) /Title (${toLatin(this.meta.title ?? '')}) /Author (${toLatin(this.meta.author ?? '')}) >>`);
    let out = '%PDF-1.4\n';
    const offsets: number[] = [];
    this.objects.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o.replace('@PAGES@', `${pagesId} 0 R`)}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${this.objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${this.objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return out;
  }
}

const MIL_PT = 0.072; // 1 mil = 0.072 pt
const MM_PT = 72 / 25.4;

/** 画一页原理图（边框 + 标题栏 + 内容）。 */
export function paintSheet(project: Project, sheet: Sheet, index: number): { w: number; h: number; content: string } {
  const paper = paperSize(sheet.frame);
  // 无边框：按内容外接框
  let W: number, H: number, ox = 0, oy = 0;
  const pts: Vec[] = [];
  if (!paper) {
    for (const c of sheet.components) { const s = componentStrokes(c); for (const l of s.lines) pts.push(...l.points); for (const t of s.texts) pts.push({ x: t.x, y: t.y }); }
    for (const w of sheet.wires) pts.push(...w.points);
    const minX = Math.min(2000, ...pts.map((p) => p.x)) - 500, minY = Math.min(2000, ...pts.map((p) => p.y)) - 500, maxX = Math.max(6000, ...pts.map((p) => p.x)) + 500, maxY = Math.max(4000, ...pts.map((p) => p.y)) + 500;
    W = maxX - minX; H = maxY - minY; ox = -minX * MIL_PT; oy = -minY * MIL_PT;
  } else { W = paper.w; H = paper.h; }
  const pw = W * MIL_PT, ph = H * MIL_PT;
  const P = new PdfPainter(MIL_PT, ox, oy, ph);
  const fr = sheet.frame;
  if (paper) {
    const m = 200; P.color('#8E8B84');
    P.rect(0, 0, W, H, 10); P.rect(m, m, W - 2 * m, H - 2 * m, 16);
    const cols = Math.round(W / 2000), rows = Math.round(H / 2000);
    for (let i = 0; i < cols; i++) { const x0 = m + ((W - 2 * m) / cols) * i, x1 = m + ((W - 2 * m) / cols) * (i + 1); if (i) { P.polyline([{ x: x0, y: 0 }, { x: x0, y: m }], 8); P.polyline([{ x: x0, y: H - m }, { x: x0, y: H }], 8); } P.text((x0 + x1) / 2, m * 0.68, String(i + 1), 110, 'middle'); P.text((x0 + x1) / 2, H - m * 0.32, String(i + 1), 110, 'middle'); }
    for (let i = 0; i < rows; i++) { const y0 = m + ((H - 2 * m) / rows) * i, y1 = m + ((H - 2 * m) / rows) * (i + 1); if (i) { P.polyline([{ x: 0, y: y0 }, { x: m, y: y0 }], 8); P.polyline([{ x: W - m, y: y0 }, { x: W, y: y0 }], 8); } const ch = String.fromCharCode(65 + i); P.text(m / 2, (y0 + y1) / 2 + 40, ch, 110, 'middle'); P.text(W - m / 2, (y0 + y1) / 2 + 40, ch, 110, 'middle'); }
    const tbW = 4400, tbH = 900, tx = W - m - tbW, ty = H - m - tbH;
    P.rect(tx, ty, tbW, tbH, 12); P.polyline([{ x: tx, y: ty + 300 }, { x: tx + tbW, y: ty + 300 }], 12); P.polyline([{ x: tx, y: ty + 600 }, { x: tx + tbW, y: ty + 600 }], 12);
    P.polyline([{ x: tx + 2600, y: ty + 600 }, { x: tx + 2600, y: ty + tbH }], 12); P.polyline([{ x: tx + 3500, y: ty + 600 }, { x: tx + 3500, y: ty + tbH }], 12);
    P.color('#3A3835', false);
    const L = fr.labels;
    P.text(tx + 80, ty + 110, fr.company || 'Tracelet', 100); P.text(tx + 80, ty + 240, fr.title || project.name, 170, 'start', { bold: true });
    P.text(tx + 80, ty + 410, L.sheet, 100); P.text(tx + 80, ty + 540, sheet.name, 140);
    P.text(tx + 80, ty + 700, L.date, 100); P.text(tx + 80, ty + 840, fr.date || project.updatedAt.slice(0, 10), 130);
    P.text(tx + 2680, ty + 700, L.revision, 100); P.text(tx + 2680, ty + 840, fr.revision, 130);
    P.text(tx + 3580, ty + 700, L.page, 100); P.text(tx + 3580, ty + 840, `${index + 1} / ${project.schematic.sheets.length}`, 130);
    P.text(tx + 2680, ty + 240, `${fr.size === 'custom' ? `${Math.round(W * 0.0254)}x${Math.round(H * 0.0254)}mm` : fr.size}${fr.author ? '  ' + L.author + ': ' + fr.author : ''}`, 100);
    P.text(tx + 2680, ty + 540, fr.comment, 100);
  }
  // 导线 / 总线 / 结点
  P.color('#1F5F2B'); for (const w of sheet.wires) P.polyline(w.points, 16);
  P.color('#2C5AA0'); for (const b of sheet.buses ?? []) P.polyline(b.points, 44);
  P.color('#1F5F2B', false); for (const j of sheet.junctions) P.circle({ x: j.x, y: j.y }, 40, 4, true);
  // 图形
  P.color('#5B6472'); P.color('#5B6472', false);
  for (const g of sheet.graphics ?? []) { if (g.kind === 'line') P.polyline(g.points, 14); else if (g.kind === 'rect') P.rect(Math.min(g.a.x, g.b.x), Math.min(g.a.y, g.b.y), Math.abs(g.b.x - g.a.x), Math.abs(g.b.y - g.a.y), 14); else P.text(g.x, g.y, g.text, g.size); }
  // 元件
  for (const c of sheet.components) {
    const sym = getSymbol(c.symbolId); const ink = sym.color ?? '#7A1F1F';
    const s = componentStrokes(c, sym);
    P.color(ink); P.color('#FFFFFF', false);
    for (const l of s.lines) P.polyline(l.points, l.width, { fill: l.fill });
    for (const ci of s.circles) P.circle(ci.c, ci.r, ci.width, ci.fill);
    for (const t of s.texts) { P.color(t.color ?? ink, false); P.text(t.x, t.y, t.text, t.size, t.anchor, { bold: t.bold }); }
  }
  // 标签
  P.color('#2C5AA0', false); P.color('#2C5AA0');
  for (const l of sheet.labels) { P.polyline([{ x: l.x, y: l.y }, { x: l.x + 60, y: l.y - 60 }, { x: l.x + 120 + l.text.length * 70, y: l.y - 60 }, { x: l.x + 120 + l.text.length * 70, y: l.y - 180 }, { x: l.x + 60, y: l.y - 180 }, { x: l.x, y: l.y - 120 }], 10); P.text(l.x + 90, l.y - 95, l.text, 100); }
  return { w: pw, h: ph, content: P.content() };
}

/** 全部图纸 → PDF（ASCII 字符串）。 */
export function exportSchematicPdf(project: Project): string {
  const doc = new PdfDoc({ title: project.name, author: project.schematic.sheets[0]?.frame.author });
  project.schematic.sheets.forEach((sheet, i) => { const p = paintSheet(project, sheet, i); doc.addPage(p.w, p.h, p.content); });
  return doc.build();
}

/** 装配图：顶层 / 底层各一页（底层镜像，按从底面看），A4 横向自适应缩放。 */
export function exportAssemblyPdf(project: Project): string {
  const board = project.board, bb = boardBounds(board), pads = allPads(board);
  const doc = new PdfDoc({ title: `${project.name} assembly` });
  const pageW = 842, pageH = 595, margin = 40, header = 50;
  const scale = Math.min((pageW - 2 * margin) / bb.w, (pageH - 2 * margin - header) / bb.h) / MM_PT * MM_PT;
  for (const side of ['F', 'B'] as const) {
    const mirror = side === 'B';
    const P = new PdfPainter(scale, margin + ((pageW - 2 * margin) - bb.w * scale) / 2, margin + header, pageH);
    const X = (x: number) => (mirror ? bb.x + bb.w - (x - bb.x) : x) - bb.x, Y = (y: number) => y - bb.y;
    const T = (p: Vec) => ({ x: X(p.x), y: Y(p.y) });
    P.raw('q');
    P.color('#000000', false); P.color('#000000');
    P.text(-0, -header + 12, `${project.name}  -  ${side === 'F' ? 'TOP' : 'BOTTOM (mirrored, viewed from below)'} assembly drawing`, 14 / scale, 'start', { bold: true });
    P.text(-0, -header + 32, `${bb.w.toFixed(1)} x ${bb.h.toFixed(1)} mm  -  ${board.copperCount} layers  -  ${board.thickness} mm  -  ${project.updatedAt.slice(0, 10)}  -  scale ${(scale / MM_PT).toFixed(2)}`, 9 / scale);
    P.color('#000000'); P.polyline([...board.outline.map(T), T(board.outline[0])], 0.3);
    for (const fp of board.footprints) {
      if (fp.side !== side) continue;
      const b = footprintBody(fp);
      P.color('#404040'); P.rect(X(b.x + (mirror ? b.w : 0)), Y(b.y), b.w, b.h, 0.15);
      P.color('#808080');
      for (const pd of pads) if (pd.footprintId === fp.id) P.rect(X(pd.rect.x + (mirror ? pd.rect.w : 0)), Y(pd.rect.y), pd.rect.w, pd.rect.h, 0.1);
      P.color('#000000', false); P.text(X(fp.x), Y(fp.y) + 0.4, fp.ref, Math.max(0.8, Math.min(1.6, b.w / 3)), 'middle', { bold: true });
    }
    // 定位孔 / NPTH
    P.color('#000000');
    for (const pd of pads) if (pd.def.npth) P.circle(T(pd.center), pd.def.drill / 2, 0.15);
    P.raw('Q');
    doc.addPage(pageW, pageH, P.content());
  }
  return doc.build();
}
