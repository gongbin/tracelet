import type { Board, BoardFootprint } from '../model/board.js';
import { footprintBody, footprintPads } from './geometry.js';
import { pointInPolygon, type Rect } from '../geometry.js';
import { bodyInsideOutline } from './placementConstraints.js';

/** Conservative recognition: RF module name plus a substantial pad-free overhang.
 * Inferred geometry is suitable for protecting an existing mechanical anchor,
 * not for inventing a new antenna orientation or a datasheet RF clearance.
 */
export function antennaGeometry(f: BoardFootprint, board: Board): { area: Rect; support: Rect } | null {
  if (!/(antenna|wroom|wrover|esp32|esp8266|wifi|lora|zigbee)/i.test(`${f.footprintId} ${f.value}`) && !/^ANT\d/i.test(f.ref)) return null;
  if (Math.abs(f.rotation % 90) > 1e-6) return null;
  const ps=footprintPads(f,board).filter(p=>!p.def.npth),r=footprintBody(f);
  if (!ps.length) return null;
  const x1=Math.min(...ps.map(p=>p.rect.x)),x2=Math.max(...ps.map(p=>p.rect.x+p.rect.w));
  const y1=Math.min(...ps.map(p=>p.rect.y)),y2=Math.max(...ps.map(p=>p.rect.y+p.rect.h));
  const candidates=[
    {depth:y1-r.y,area:{x:r.x,y:r.y,w:r.w,h:y1-r.y},support:{x:r.x,y:y1,w:r.w,h:r.y+r.h-y1}},
    {depth:r.y+r.h-y2,area:{x:r.x,y:y2,w:r.w,h:r.y+r.h-y2},support:{x:r.x,y:r.y,w:r.w,h:y2-r.y}},
    {depth:x1-r.x,area:{x:r.x,y:r.y,w:x1-r.x,h:r.h},support:{x:x1,y:r.y,w:r.x+r.w-x1,h:r.h}},
    {depth:r.x+r.w-x2,area:{x:x2,y:r.y,w:r.x+r.w-x2,h:r.h},support:{x:r.x,y:r.y,w:x2-r.x,h:r.h}}
  ].sort((a,b)=>b.depth-a.depth);
  return candidates[0].depth>=3 ? candidates[0] : null;
}

export function placementBodyInside(f: BoardFootprint, board: Board): boolean {
  if(bodyInsideOutline(footprintBody(f),board.outline)) return true;
  const ant=antennaGeometry(f,board);
  if(!ant || board.outline.length<3 || pointInPolygon({x:ant.area.x+ant.area.w/2,y:ant.area.y+ant.area.h/2},board.outline))return false;
  // Only the pad-free antenna side may overhang; every copper pad and the support stay inside.
  return bodyInsideOutline(ant.support,board.outline) && footprintPads(f,board).every(p=>bodyInsideOutline(p.rect,board.outline));
}

export function antennaAreasClear(board: Board): boolean {
  return board.footprints.every(f=>{
    const ant=antennaGeometry(f,board);if(!ant)return true;
    return board.footprints.every(other=>{
      if(other.id===f.id)return true;
      const b=footprintBody(other),a=ant.area;
      return Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)<=1e-6 || Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)<=1e-6;
    });
  });
}
