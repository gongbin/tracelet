/**
 * Gerber 预览：用第三方解析器（@tracespace/parser）读取我们导出的文件，再解释成基本图元。
 * 目的是"看到板厂会看到的东西"，而不是复用编辑器的渲染路径。
 * 支持子集：C/R/O 孔径、D01/D02/D03、G36/G37 区域、LPD/LPC、Excellon 钻孔。
 */
import { createParser } from '@tracespace/parser';

export type Prim =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; w: number; clear: boolean }
  | { kind: 'circle'; x: number; y: number; d: number; clear: boolean }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; r: number; clear: boolean }
  | { kind: 'poly'; pts: [number, number][]; clear: boolean };

export interface PreviewImage { prims: Prim[]; bounds: { minX: number; minY: number; maxX: number; maxY: number }; filetype: string | null; unimplemented: number }

export function interpretGerber(text: string): PreviewImage {
  const parser = createParser(); parser.feed(text);
  const tree = parser.results();
  const prims: Prim[] = [];
  const tools = new Map<string, { shape: string; d?: number; w?: number; h?: number }>();
  let tool: { shape: string; d?: number; w?: number; h?: number } | null = null;
  let fmt: [number, number] = [4, 6];
  let cur = { x: 0, y: 0 };
  let region: [number, number][] | null = null;
  let clear = false;
  let unimplemented = 0;
  const isDrill = tree.filetype === 'drill';
  const parseCoord = (s: string | undefined, prev: number): number => {
    if (s === undefined) return prev;
    if (s.includes('.')) return Number(s);
    const neg = s.startsWith('-'); const digits = s.replace(/^[-+]/, '');
    const v = Number(digits) / Math.pow(10, fmt[1]);
    return neg ? -v : v;
  };
  for (const n of tree.children) {
    if (n.type === 'coordinateFormat' && n.format) fmt = n.format;
    else if (n.type === 'toolDefinition') {
      const s = n.shape;
      tools.set(n.code, s.type === 'circle' ? { shape: 'circle', d: s.diameter } : s.type === 'rectangle' || s.type === 'obround' ? { shape: s.type, w: s.xSize, h: s.ySize } : { shape: 'circle', d: 0.1 });
    }
    else if (n.type === 'toolChange') tool = tools.get(n.code) ?? null;
    else if (n.type === 'loadPolarity') clear = n.polarity === 'clear';
    else if (n.type === 'regionMode') { if (n.region) region = []; else { if (region && region.length >= 3) prims.push({ kind: 'poly', pts: region, clear }); region = null; } }
    else if (n.type === 'unimplemented') { if (!/^%T[FAOD]/.test(n.value)) unimplemented++; }
    else if (n.type === 'graphic') {
      const x = parseCoord(n.coordinates.x, cur.x), y = parseCoord(n.coordinates.y, cur.y);
      const g = n.graphic ?? (isDrill ? 'shape' : 'segment');
      if (region) { if (g === 'move') { if (region.length >= 3) prims.push({ kind: 'poly', pts: region, clear }); region = [[x, y]]; } else region.push([x, y]); }
      else if (g === 'segment' && tool) prims.push({ kind: 'line', x1: cur.x, y1: cur.y, x2: x, y2: y, w: tool.d ?? tool.w ?? 0.1, clear });
      else if (g === 'shape' && tool) {
        if (tool.shape === 'circle') prims.push({ kind: 'circle', x, y, d: tool.d ?? 0.1, clear });
        else prims.push({ kind: 'rect', x: x - (tool.w ?? 0) / 2, y: y - (tool.h ?? 0) / 2, w: tool.w ?? 0, h: tool.h ?? 0, r: tool.shape === 'obround' ? Math.min(tool.w ?? 0, tool.h ?? 0) / 2 : 0, clear });
      }
      cur = { x, y };
    }
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ext = (x: number, y: number, m = 0) => { minX = Math.min(minX, x - m); minY = Math.min(minY, y - m); maxX = Math.max(maxX, x + m); maxY = Math.max(maxY, y + m); };
  for (const p of prims) {
    if (p.kind === 'line') { ext(p.x1, p.y1, p.w); ext(p.x2, p.y2, p.w); }
    else if (p.kind === 'circle') ext(p.x, p.y, p.d / 2);
    else if (p.kind === 'rect') { ext(p.x, p.y); ext(p.x + p.w, p.y + p.h); }
    else for (const [x, y] of p.pts) ext(x, y);
  }
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 10; maxY = 10; }
  return { prims, bounds: { minX, minY, maxX, maxY }, filetype: tree.filetype, unimplemented };
}
