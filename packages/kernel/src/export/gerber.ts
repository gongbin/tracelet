/**
 * Gerber RS-274X（含 X2 属性）与 Excellon 钻孔文件导出。
 * 坐标：mm，格式 4.6 绝对坐标；Y 轴翻转（板坐标 y 向下 → Gerber y 向上）。
 * 底层不做镜像（Gerber 约定从顶面看）。
 */
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import type { Project, RuleSet } from '../model/project.js';
import type { Board, CopperLayer, Layer } from '../model/board.js';
import { copperLayers } from '../model/board.js';
import { ruleSetOf } from '../model/project.js';
import type { Vec } from '../geometry.js';
import { allPads, footprintBody, type WorldPad } from '../board/geometry.js';
import { zoneFills } from '../board/zones.js';
import { textStrokes } from './strokefont.js';
import { exportBomCsv, exportPickAndPlaceCsv, exportNetlistJson } from './netlist.js';
import { exportAssemblyPdf, exportSchematicPdf } from './pdf.js';
import { serializeProject } from '../io/serialize.js';

const MASK_EXPANSION = 0.05;
const SILK_WIDTH = 0.12;
const EDGE_WIDTH = 0.1;
const VERSION = '0.1.0';

const num = (v: number) => Math.round(v * 1e6).toString();
const XY = (p: Vec) => `X${num(p.x)}Y${num(-p.y)}`;
const f3 = (v: number) => v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '.0');

class GerberWriter {
  private lines: string[] = [];
  private apertures = new Map<string, number>();
  private apLines: string[] = [];
  private next = 10;
  private current = -1;
  private polarity: 'D' | 'C' = 'D';

  constructor(fileFunction: string, polarityAttr: 'Positive' | 'Negative' = 'Positive') {
    this.lines.push(`%TF.GenerationSoftware,Tracelet,tracelet,${VERSION}*%`);
    this.lines.push(`%TF.CreationDate,${new Date().toISOString()}*%`);
    this.lines.push(`%TF.FileFunction,${fileFunction}*%`);
    this.lines.push(`%TF.FilePolarity,${polarityAttr}*%`);
    this.lines.push('%FSLAX46Y46*%');
    this.lines.push('%MOMM*%');
    this.lines.push('G01*');
  }

  private aperture(def: string): number {
    let d = this.apertures.get(def);
    if (d === undefined) { d = this.next++; this.apertures.set(def, d); this.apLines.push(`%ADD${d}${def}*%`); }
    return d;
  }
  circle(d: number) { return this.aperture(`C,${f3(d)}`); }
  rect(w: number, h: number) { return this.aperture(`R,${f3(w)}X${f3(h)}`); }
  obround(w: number, h: number) { return this.aperture(`O,${f3(w)}X${f3(h)}`); }

  private select(code: number) { if (this.current !== code) { this.lines.push(`D${code}*`); this.current = code; } }
  setPolarity(p: 'D' | 'C') { if (this.polarity !== p) { this.lines.push(`%LP${p}*%`); this.polarity = p; } }

  flash(code: number, p: Vec) { this.select(code); this.lines.push(`${XY(p)}D03*`); }
  polyline(code: number, pts: Vec[]) {
    if (pts.length < 2) return;
    this.select(code);
    this.lines.push(`${XY(pts[0])}D02*`);
    for (let i = 1; i < pts.length; i++) this.lines.push(`${XY(pts[i])}D01*`);
  }
  region(ring: Vec[]) {
    if (ring.length < 3) return;
    this.lines.push('G36*');
    this.lines.push(`${XY(ring[0])}D02*`);
    for (let i = 1; i < ring.length; i++) this.lines.push(`${XY(ring[i])}D01*`);
    this.lines.push(`${XY(ring[0])}D01*`);
    this.lines.push('G37*');
  }
  toString(): string {
    return [...this.lines.slice(0, 7), ...this.apLines, ...this.lines.slice(7), 'M02*', ''].join('\n');
  }
}

function padAperture(w: GerberWriter, p: WorldPad, expand = 0): number {
  const pw = p.rect.w + 2 * expand, ph = p.rect.h + 2 * expand;
  if (p.def.shape === 'circle') return w.circle(Math.max(pw, ph));
  if (p.def.shape === 'oval') return w.obround(pw, ph);
  return w.rect(pw, ph);
}

function copperFunction(layer: CopperLayer, count: 2 | 4): string {
  const idx = copperLayers(count).indexOf(layer) + 1;
  const pos = layer === 'F.Cu' ? 'Top' : layer === 'B.Cu' ? 'Bot' : 'Inr';
  return `Copper,L${idx},${pos}`;
}

export function exportCopperLayer(board: Board, layer: CopperLayer, rules: RuleSet): string {
  const w = new GerberWriter(copperFunction(layer, board.copperCount));
  // 铺铜（先画，孔用 LPC 清除，再叠加走线焊盘）
  for (const fill of zoneFills(board, rules)) {
    if (fill.zone.layer !== layer) continue;
    for (const poly of fill.polygons) {
      w.setPolarity('D'); w.region(poly[0]);
      for (const hole of poly.slice(1)) { w.setPolarity('C'); w.region(hole); }
    }
  }
  w.setPolarity('D');
  for (const t of board.traces) if (t.layer === layer) w.polyline(w.circle(t.width), t.points);
  for (const v of board.vias) w.flash(w.circle(v.size), v);
  for (const p of allPads(board)) if (p.layers.includes(layer)) w.flash(padAperture(w, p), p.center);
  return w.toString();
}

export function exportMaskLayer(board: Board, side: 'F' | 'B'): string {
  const w = new GerberWriter(`Soldermask,${side === 'F' ? 'Top' : 'Bot'}`, 'Negative');
  const layer: CopperLayer = side === 'F' ? 'F.Cu' : 'B.Cu';
  for (const p of allPads(board)) if (p.layers.includes(layer) && !p.def.npth) w.flash(padAperture(w, p, MASK_EXPANSION), p.center);
  return w.toString();
}

export function exportPasteLayer(board: Board, side: 'F' | 'B'): string {
  const w = new GerberWriter(`Paste,${side === 'F' ? 'Top' : 'Bot'}`);
  const layer: CopperLayer = side === 'F' ? 'F.Cu' : 'B.Cu';
  for (const p of allPads(board)) if (!p.through && p.layers.includes(layer)) w.flash(padAperture(w, p), p.center);
  return w.toString();
}

export function exportLegendLayer(board: Board, side: 'F' | 'B'): string {
  const w = new GerberWriter(`Legend,${side === 'F' ? 'Top' : 'Bot'}`);
  const pen = w.circle(SILK_WIDTH);
  const mirror = side === 'B';
  for (const fp of board.footprints) {
    if (fp.side !== side) continue;
    const b = footprintBody(fp);
    w.polyline(pen, [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }, { x: b.x, y: b.y }]);
    const size = b.h >= 4 ? 1.0 : 0.7;
    const at = b.h >= 4 ? { x: fp.x, y: fp.y } : { x: fp.x, y: b.y - 0.35 - size / 2 };
    for (const line of textStrokes(fp.ref, at, { size, anchor: 'middle', mirror })) w.polyline(pen, line);
  }
  for (const t of board.texts) {
    if (t.layer !== (side === 'F' ? 'F.Silk' : 'B.Silk')) continue;
    for (const line of textStrokes(t.text, { x: t.x, y: t.y }, { size: t.size, anchor: 'middle', mirror })) w.polyline(pen, line);
  }
  return w.toString();
}

export function exportProfileLayer(board: Board): string {
  const w = new GerberWriter('Profile,NP');
  const pen = w.circle(EDGE_WIDTH);
  if (board.outline.length >= 2) w.polyline(pen, [...board.outline, board.outline[0]]);
  return w.toString();
}

/** Excellon 钻孔文件（METRIC，显式小数点）。 */
export function exportExcellon(board: Board, plated: boolean): string {
  const holes: { d: number; p: Vec }[] = [];
  for (const p of allPads(board)) if (p.def.drill > 0 && !!p.def.npth === !plated) holes.push({ d: p.def.drill, p: p.center });
  if (plated) for (const v of board.vias) holes.push({ d: v.drill, p: v });
  const tools = [...new Set(holes.map((h) => h.d))].sort((a, b) => a - b);
  const L: string[] = ['M48', `; DRILL file {Tracelet ${VERSION}} date ${new Date().toISOString()}`, '; FORMAT={-:-/ absolute / metric / decimal}', `;TYPE=${plated ? 'PLATED' : 'NON_PLATED'}`, 'FMAT,2', 'METRIC'];
  tools.forEach((d, i) => L.push(`T${i + 1}C${d.toFixed(3)}`));
  L.push('M95', 'G90', 'G05');
  tools.forEach((d, i) => {
    L.push(`T${i + 1}`);
    for (const h of holes) if (h.d === d) L.push(`X${h.p.x.toFixed(4)}Y${(-h.p.y).toFixed(4)}`);
  });
  L.push('T0', 'M30', '');
  return L.join('\n');
}

export interface FabFile { name: string; content: string; kind: 'gerber' | 'drill' | 'bom' | 'pnp' | 'netlist' | 'project' | 'readme' | 'pdf' }

const slugOf = (name: string) => name.replace(/[^\w一-龥-]+/g, '-').replace(/^-|-$/g, '') || 'board';

/** 全套制造文件（嘉立创/JLCPCB 可识别的 Protel 扩展名）。 */
export function exportFabFiles(project: Project, opts: { bom?: boolean; pnp?: boolean; netlist?: boolean; project?: boolean; assemblyPdf?: boolean; schematicPdf?: boolean } = {}): FabFile[] {
  const board = project.board, rules = ruleSetOf(project), s = slugOf(project.name);
  const files: FabFile[] = [];
  const cu = copperLayers(board.copperCount);
  const ext: Record<CopperLayer, string> = { 'F.Cu': 'gtl', 'In1.Cu': 'g2', 'In2.Cu': 'g3', 'B.Cu': 'gbl' };
  for (const l of cu) files.push({ name: `${s}-${l.replace('.', '_')}.${ext[l]}`, content: exportCopperLayer(board, l, rules), kind: 'gerber' });
  files.push({ name: `${s}-F_Mask.gts`, content: exportMaskLayer(board, 'F'), kind: 'gerber' });
  files.push({ name: `${s}-B_Mask.gbs`, content: exportMaskLayer(board, 'B'), kind: 'gerber' });
  files.push({ name: `${s}-F_Paste.gtp`, content: exportPasteLayer(board, 'F'), kind: 'gerber' });
  files.push({ name: `${s}-B_Paste.gbp`, content: exportPasteLayer(board, 'B'), kind: 'gerber' });
  files.push({ name: `${s}-F_Silkscreen.gto`, content: exportLegendLayer(board, 'F'), kind: 'gerber' });
  files.push({ name: `${s}-B_Silkscreen.gbo`, content: exportLegendLayer(board, 'B'), kind: 'gerber' });
  files.push({ name: `${s}-Edge_Cuts.gm1`, content: exportProfileLayer(board), kind: 'gerber' });
  files.push({ name: `${s}-PTH.drl`, content: exportExcellon(board, true), kind: 'drill' });
  files.push({ name: `${s}-NPTH.drl`, content: exportExcellon(board, false), kind: 'drill' });
  if (opts.bom !== false) files.push({ name: `${s}-BOM.csv`, content: exportBomCsv(project), kind: 'bom' });
  if (opts.pnp !== false) files.push({ name: `${s}-PickAndPlace.csv`, content: exportPickAndPlaceCsv(project), kind: 'pnp' });
  if (opts.netlist) files.push({ name: `${s}-netlist.json`, content: JSON.stringify(exportNetlistJson(project), null, 2), kind: 'netlist' });
  if (opts.project) files.push({ name: `${s}.eda.json`, content: serializeProject(project), kind: 'project' });
  if (opts.assemblyPdf) files.push({ name: `${s}-Assembly.pdf`, content: exportAssemblyPdf(project), kind: 'pdf' });
  if (opts.schematicPdf) files.push({ name: `${s}-Schematic.pdf`, content: exportSchematicPdf(project), kind: 'pdf' });
  files.push({ name: 'README.txt', kind: 'readme', content: [`${project.name}`, `Generated by Tracelet ${VERSION} · ${new Date().toISOString()}`, `Layers: ${board.copperCount} · Thickness: ${board.thickness}mm · Rules: ${rules.name}`, '', 'Gerber RS-274X (4.6 mm), Excellon metric decimal.', 'Solder mask files are negative (openings). Vias are tented.', ...(board.stackup ? [`Material: ${board.stackup.material} · Copper: ${board.stackup.copperWeight}oz${board.copperCount === 4 ? ` (inner ${board.stackup.innerCopperWeight}oz)` : ''} · Finish: ${board.stackup.finish} · Mask: ${board.stackup.maskColor} · Silk: ${board.stackup.silkColor}${board.stackup.impedance ? ' · Impedance control required' : ''}`] : []), ''].join('\n') });
  return files;
}

export function zipFiles(files: FabFile[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.name] = strToU8(f.content);
  return zipSync(entries, { level: 6 });
}

/** 解包 zip（用于导入备份）。 */
export function unzipFiles(data: Uint8Array): { name: string; content: string }[] {
  const entries = unzipSync(data);
  return Object.entries(entries).filter(([name]) => !name.endsWith('/')).map(([name, bytes]) => ({ name, content: strFromU8(bytes) }));
}

export function exportFabZip(project: Project, opts?: Parameters<typeof exportFabFiles>[1]): { name: string; data: Uint8Array } {
  const date = new Date().toISOString().slice(0, 10);
  return { name: `${slugOf(project.name)}_${date}.zip`, data: zipFiles(exportFabFiles(project, opts)) };
}
