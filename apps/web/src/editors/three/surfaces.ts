import * as THREE from 'three';
import clipping, { type MultiPolygon, type Polygon } from 'polygon-clipping';
import {
  backdrillDepth, boardBounds, circlePoly, copperDepths, copperLayers, expandedRectPoly,
  footprintPads, stadiumPoly, viaLayers, viaSpan,
  type Board, type CopperLayer, type Ring, type WorldPad, type ZoneFill
} from '@tracelet/kernel';

export const MASK_COLORS: Record<string, [string, string, string]> = {
  '绿': ['#124A29', '#0D351E', '#092817'], '黑': ['#2B2B2B', '#1C1C1C', '#141414'], '白': ['#E8E8E4', '#BDBDB8', '#9E9E99'],
  '蓝': ['#1F4E8C', '#153661', '#0F2846'], '红': ['#8C1F1F', '#611515', '#460F0F'], '黄': ['#B59A1E', '#7F6B15', '#5C4D0F'], '紫': ['#5B2D8C', '#3F1F61', '#2D1646']
};
export interface SurfaceOptions {
  mode: 'inspect' | 'realistic'; mask: boolean; copper: boolean; traces: boolean; zones: boolean;
  traceColor: string; zoneColor: string;
}
export const DEFAULT_SURFACES: SurfaceOptions = {
  mode: 'inspect', mask: true, copper: false, traces: true, zones: true,
  traceColor: '#e6ad62', zoneColor: '#246c5a'
};

/** Inspection colors are display preferences, never manufacturing stackup values. */
export function surfacePalette(board: Board, s: SurfaceOptions) {
  const mask = new THREE.Color((MASK_COLORS[board.stackup?.maskColor ?? '绿'] ?? MASK_COLORS['绿'])[0]);
  const finish = board.stackup?.finish ?? 'HASL';
  const pad = new THREE.Color(finish === 'ENIG' ? '#d9b65f' : finish === 'OSP' ? '#bd7949' : '#d7dce2');
  const covered = s.mask && !s.copper;
  return {
    board: s.mask ? mask : new THREE.Color('#786644'), pad,
    trace: s.mode === 'inspect' ? new THREE.Color(s.traceColor) : covered ? mask.clone().lerp(new THREE.Color('#ffffff'), .05) : new THREE.Color('#bd7949'),
    zone: s.mode === 'inspect' ? new THREE.Color(s.zoneColor) : covered ? mask.clone().lerp(new THREE.Color('#ffffff'), .018) : new THREE.Color('#a86c42')
  };
}

const polygon = (ring: Ring): Polygon => [ring.map(p => [p.x, p.y])];
const circle = (x: number, y: number, radius: number) => polygon(circlePoly({ x, y }, radius, 48));

/** Actual oriented copper contour, not the axis-aligned selection/clearance box. */
export function padContour(p: WorldPad, rotation: number): Polygon {
  const { w, h, shape } = p.def;
  let ring: Ring;
  if (shape === 'circle') ring = circlePoly({ x: 0, y: 0 }, 1, 48).map(v => ({ x: v.x * w / 2, y: v.y * h / 2 }));
  else if (shape === 'oval') {
    const dx = Math.max(0, (w - h) / 2), dy = Math.max(0, (h - w) / 2);
    ring = stadiumPoly({ x: -dx, y: -dy }, { x: dx, y: dy }, Math.min(w, h) / 2);
  } else {
    const r = shape === 'roundrect' ? Math.min(w, h) * .2 : 0;
    ring = expandedRectPoly({ x: -w / 2 + r, y: -h / 2 + r, w: w - 2 * r, h: h - 2 * r }, r);
  }
  const a = rotation * Math.PI / 180;
  return polygon(ring.map(v => ({ x: p.center.x + v.x * Math.cos(a) - v.y * Math.sin(a), y: p.center.y + v.x * Math.sin(a) + v.y * Math.cos(a) })));
}

/** Millimetre geometry shared by the viewer and product export. Board Y is inverted only here. */
export function buildBoardSurfaces(board: Board, fills: ZoneFill[], s: SurfaceOptions): THREE.Group {
  const g = new THREE.Group(), bb = boardBounds(board), T = board.thickness;
  if (board.outline.length < 3 || T <= 0) return g;
  const palette = surfacePalette(board, s), layers = copperLayers(board.copperCount);
  const depths = copperDepths(board) ?? layers.map((_, i) => T * i / (layers.length - 1));
  const outline = polygon(board.outline);
  const pads = board.footprints.flatMap(f => footprintPads(f, board));
  const rotations = new Map(board.footprints.map(f => [f.id, f.rotation]));
  const viaBounds = (v: Board['vias'][number]): [number, number] | undefined => {
    const span = viaSpan(board, v);
    return span.length ? [depths[layers.indexOf(span[0])], depths[layers.indexOf(span.at(-1)!)]] : undefined;
  };
  const drills: { polygon: Polygon; a: number; b: number }[] = pads.filter(p => p.def.drill > 0).map(p => ({ polygon: circle(p.center.x, p.center.y, p.def.drill / 2), a: 0, b: T }));
  for (const v of board.vias) {
    const bounds = viaBounds(v); if (!bounds || v.drill <= 0) continue;
    drills.push({ polygon: circle(v.x, v.y, v.drill / 2), a: bounds[0], b: bounds[1] });
    const d = backdrillDepth(board, v);
    if (v.backdrill && d !== null && d > 0 && d < T) drills.push({ polygon: circle(v.x, v.y, v.backdrill.diameter / 2), a: v.backdrill.side === 'F' ? 0 : T - d, b: v.backdrill.side === 'F' ? d : T });
  }
  const regionAt = (depth: number, inclusive = false): MultiPolygon => {
    const holes = drills.filter(d => inclusive ? d.a <= depth + 1e-7 && d.b >= depth - 1e-7 : d.a < depth && d.b > depth).map(d => d.polygon);
    return holes.length ? clipping.difference(outline, ...holes) : [outline];
  };
  const shapes = (polygons: MultiPolygon) => polygons.map(poly => {
    const vertices = (ring: Polygon[number]) => ring.map(([x, y]) => new THREE.Vector2(x - bb.x - bb.w / 2, bb.y + bb.h / 2 - y));
    const shape = new THREE.Shape(vertices(poly[0]));
    shape.holes = poly.slice(1).map(ring => new THREE.Path(vertices(ring)));
    return shape;
  });
  const material = (color: THREE.Color, metalness: number) => new THREE.MeshStandardMaterial({ color, roughness: metalness > .5 ? .35 : .62, metalness, side: THREE.DoubleSide });
  const boardMat = material(palette.board, .05), edgeMat = material(new THREE.Color('#897450'), .05);
  if (s.copper) for (const m of [boardMat, edgeMat]) { m.transparent = true; m.opacity = .15; m.depthWrite = false; }
  const cuts = [...new Set([0, T, ...drills.flatMap(d => [d.a, d.b])])].sort((a, b) => a - b);
  for (let i = 1; i < cuts.length; i++) {
    const a = cuts[i - 1], b = cuts[i], region = regionAt((a + b) / 2);
    if (!region.length) continue;
    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shapes(region), { depth: b - a, bevelEnabled: false }), [boardMat, edgeMat]);
    mesh.position.z = T - b; mesh.userData = { kind: 'board', depthStart: a, depthEnd: b }; mesh.receiveShadow = true; g.add(mesh);
  }
  const traceMat = material(palette.trace, s.mode === 'realistic' && !s.mask ? .65 : .15);
  const zoneMat = material(palette.zone, s.mode === 'realistic' && !s.mask ? .65 : .1);
  const padMat = material(palette.pad, .8), barrelMat = material(new THREE.Color('#b48a55'), .7);
  const visible = (layer: CopperLayer) => !board.hiddenLayers.includes(layer) && (s.copper || layer === 'F.Cu' || layer === 'B.Cu');
  const bounds = (polys: MultiPolygon) => {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const poly of polys) for (const [x, y] of poly[0]) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }
    return { x1, y1, x2, y2 };
  };
  const drillBounds = drills.map(d => ({ ...d, bounds: bounds([d.polygon]) }));
  const zAt = (layer: CopperLayer, offset: number) => T - depths[layers.indexOf(layer)] + (layer === 'F.Cu' ? offset : layer === 'B.Cu' ? -offset : 0);
  const surface = (polys: MultiPolygon, layer: CopperLayer, mat: THREE.Material, offset: number, data: Record<string, unknown>) => {
    if (!visible(layer) || !polys.length) return;
    const box = bounds(polys), depth = depths[layers.indexOf(layer)];
    // A small pad/trace must not repeatedly intersect every drill on a large board.
    const holes = drillBounds.filter(d => d.a <= depth + 1e-7 && d.b >= depth - 1e-7 && d.bounds.x1 <= box.x2 && d.bounds.x2 >= box.x1 && d.bounds.y1 <= box.y2 && d.bounds.y2 >= box.y1).map(d => d.polygon);
    let clipped = clipping.intersection(polys, outline); if (!clipped.length) return;
    if (holes.length) clipped = clipping.difference(clipped, ...holes);
    if (!clipped.length) return;
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shapes(clipped)), mat);
    mesh.position.z = zAt(layer, offset); mesh.userData = { ...data, layer }; mesh.receiveShadow = true; g.add(mesh);
  };
  if (s.zones) for (const f of fills) surface(f.polygons.map(poly => poly.map(r => r.map(p => [p.x, p.y]))), f.zone.layer, zoneMat, .012, { kind: 'zone', id: f.zone.id });
  if (s.traces) for (const t of board.traces) {
    if (!visible(t.layer) || t.width <= 0) continue;
    const segments = t.points.slice(1).map((p, i) => polygon(stadiumPoly(t.points[i], p, t.width / 2)));
    if (segments.length) surface(clipping.union(segments[0], ...segments.slice(1)), t.layer, traceMat, .022, { kind: 'trace', id: t.id, width: t.width });
  }
  const barrel = (x: number, y: number, drill: number, a: number, b: number, id: string) => {
    if (b <= a) return;
    // The plated wall is thin; the pad diameter is not a solid copper cylinder.
    const annulus = clipping.difference(circle(x, y, drill / 2 + .025), circle(x, y, drill / 2));
    const region = clipping.intersection(annulus, outline); if (!region.length) return;
    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shapes(region), { depth: b - a, bevelEnabled: false }), barrelMat);
    mesh.position.z = T - b; mesh.userData = { kind: 'barrel', id, depthStart: a, depthEnd: b }; g.add(mesh);
  };
  for (const p of pads) {
    if (p.def.npth) continue;
    const contour = padContour(p, rotations.get(p.footprintId) ?? 0);
    for (const layer of p.layers) surface([contour], layer, padMat, .032, { kind: 'pad', id: p.footprintId, number: p.number });
    if (p.through) barrel(p.center.x, p.center.y, p.def.drill, 0, T, p.footprintId);
  }
  for (const v of board.vias) {
    const bounds = viaBounds(v); if (!bounds) continue;
    const tented = s.mask && !s.copper && s.mode === 'realistic' && (board.stackup?.viaTenting ?? true);
    for (const layer of viaLayers(board, v)) surface([circle(v.x, v.y, v.size / 2)], layer, tented ? traceMat : padMat, .032, { kind: 'via', id: v.id });
    let [a, b] = bounds; const d = backdrillDepth(board, v);
    if (v.backdrill && d !== null) { if (v.backdrill.side === 'F') a = d; else b = T - d; }
    barrel(v.x, v.y, v.drill, a, b, v.id);
  }
  // Material objects not used by any mesh still need disposing (empty boards / hidden layers).
  const used = new Set<THREE.Material>();
  g.traverse(o => { if (o instanceof THREE.Mesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) used.add(m); });
  for (const m of [boardMat, edgeMat, traceMat, zoneMat, padMat, barrelMat]) if (!used.has(m)) m.dispose();
  return g;
}
