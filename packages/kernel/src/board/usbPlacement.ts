import type { Board } from '../model/board.js';
import { footprintBody, footprintDef } from './geometry.js';
import { pointSegDist } from '../geometry.js';

/** Mechanical edge intent for recognized horizontal USB-C receptacles.
 * Use signal pads only: shell stakes must not skew the mating direction.
 * Explicit placement settings always take precedence. Input is never mutated.
 */
export function withUsbEdgeConstraints(board: Board): Board {
 if(board.outline.length<3)return board;
 return {...board,footprints:board.footprints.map(f=>{
  if(f.placement?.edge || f.placement?.role==='mechanical')return f;
  const def=footprintDef(f), name=`${f.footprintId} ${def.name}`;
  if(!/USB[_ -]?C[_ -]?Receptacle/i.test(name)||/vertical|upright/i.test(name))return f;
  const pads=def.pads.filter(p=>!p.npth&&p.drill===0&&/^[AB]\d+$/.test(p.number));
  if(pads.length<4)return f;
  const local=footprintBody({...f,x:0,y:0,rotation:0,side:'F'});
  const dx=local.x+local.w/2-pads.reduce((s,p)=>s+p.x,0)/pads.length;
  const dy=local.y+local.h/2-pads.reduce((s,p)=>s+p.y,0)/pads.length;
  if(Math.hypot(dx,dy)<.5)return f; // Unknown/symmetric geometry needs explicit intent.
  const r=footprintBody(f), center={x:r.x+r.w/2,y:r.y+r.h/2};
  let edge=-1, best=Infinity;
  for(let i=0;i<board.outline.length;i++){
   const a=board.outline[i],b=board.outline[(i+1)%board.outline.length];
   if(Math.hypot(b.x-a.x,b.y-a.y)<Math.min(local.w,local.h)+1)continue;
   const d=pointSegDist(center,a,b);
   if(d<best){best=d;edge=i;}
  }
  return edge<0?f:{...f,placement:{...f.placement,edge:{index:edge,direction:Math.atan2(dy,dx)*180/Math.PI,distance:1}}};
 })};
}
