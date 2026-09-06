import type { Board, BoardFootprint, CopperLayer, FootprintDef, PadDef } from '../model/board.js';
import { copperLayers } from '../model/board.js';
import { type Rect, type Vec, rotate, polygonBounds } from '../geometry.js';
import { findFootprint } from '../library/footprints.js';
import { ensureFootprintDef } from './footprintResolve.js';

export interface WorldPad {
  footprintId: string;
  ref: string;
  number: string;
  def: PadDef;
  center: Vec;
  /** 轴对齐外接矩形（世界坐标，mm） */
  rect: Rect;
  net: string;
  /** 该焊盘所在铜层（通孔 = 全部铜层） */
  layers: CopperLayer[];
  through: boolean;
}

export function footprintDef(fp: BoardFootprint): FootprintDef {
  return findFootprint(fp.footprintId) ?? ensureFootprintDef(fp);
}

function padWorld(fp: BoardFootprint, pad: PadDef): { center: Vec; rect: Rect } {
  let local = { x: pad.x, y: pad.y };
  if (fp.side === 'B') local = { x: -local.x, y: local.y };
  const r = rotate(local, fp.rotation);
  const center = { x: fp.x + r.x, y: fp.y + r.y };
  const swap = Math.abs(((fp.rotation % 180) + 180) % 180 - 90) < 1e-6;
  const w = swap ? pad.h : pad.w, h = swap ? pad.w : pad.h;
  return { center, rect: { x: center.x - w / 2, y: center.y - h / 2, w, h } };
}

export function footprintPads(fp: BoardFootprint, board: Board): WorldPad[] {
  const def = footprintDef(fp);
  const all = copperLayers(board.copperCount);
  return def.pads.map((pad) => {
    const { center, rect } = padWorld(fp, pad);
    const through = pad.drill > 0;
    return {
      footprintId: fp.id, ref: fp.ref, number: pad.number, def: pad, center, rect,
      net: fp.padNets[pad.number] ?? '',
      layers: through ? all : [fp.side === 'F' ? 'F.Cu' : 'B.Cu'],
      through
    };
  });
}

export function allPads(board: Board): WorldPad[] {
  return board.footprints.flatMap((f) => footprintPads(f, board));
}

/** 封装本体（courtyard）矩形，世界坐标。 */
export function footprintBody(fp: BoardFootprint): Rect {
  const def = footprintDef(fp);
  const swap = Math.abs(((fp.rotation % 180) + 180) % 180 - 90) < 1e-6;
  const w = swap ? def.body.h : def.body.w, h = swap ? def.body.w : def.body.h;
  // 本体中心偏移与焊盘走同一套变换（底层镜像 x，再旋转）
  let local = { x: def.body.x ?? 0, y: def.body.y ?? 0 };
  if (fp.side === 'B') local = { x: -local.x, y: local.y };
  const r = rotate(local, fp.rotation);
  return { x: fp.x + r.x - w / 2, y: fp.y + r.y - h / 2, w, h };
}

export function boardBounds(board: Board): Rect {
  return polygonBounds(board.outline);
}

/** 矩形（可圆角）板框折线：r=0 为 4 个顶点；r>0 每个圆角用 8 段折线逼近，半径自动限制在短边一半以内。 */
export function rectOutline(x: number, y: number, w: number, h: number, r = 0): Vec[] {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr < 1e-6) return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  const N = 8, pts: Vec[] = [];
  const corner = (cx: number, cy: number, a0: number) => { for (let i = 0; i <= N; i++) { const a = a0 + (Math.PI / 2) * (i / N); pts.push({ x: +(cx + rr * Math.cos(a)).toFixed(4), y: +(cy + rr * Math.sin(a)).toFixed(4) }); } };
  corner(x + rr, y + rr, Math.PI); corner(x + w - rr, y + rr, -Math.PI / 2); corner(x + w - rr, y + h - rr, 0); corner(x + rr, y + h - rr, Math.PI / 2);
  return pts;
}

export function netClassFor(board: Board, net: string) {
  return board.netClasses.find((nc) => nc.nets.includes(net)) ?? board.netClasses.find((nc) => nc.name === 'Default') ?? board.netClasses[0];
}
