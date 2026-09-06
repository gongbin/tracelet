import { copperLayers, type Board, type Via, type CopperLayer } from '../model/board.js';
export function viaSpan(board: Board, via: Via): CopperLayer[] {
 const layers=copperLayers(board.copperCount), a=layers.indexOf(via.startLayer??'F.Cu'), b=layers.indexOf(via.endLayer??'B.Cu');
 return a>=0 && b>a ? layers.slice(a,b+1) : [];
}
export function viaLayers(board: Board, via: Via): CopperLayer[] {
 const span=viaSpan(board,via), bd=via.backdrill;
 if(!bd)return span;
 const stop=span.indexOf(bd.stopLayer);
 return stop<0 ? [] : bd.side==='F' ? span.slice(stop) : span.slice(0,stop+1);
}
export function backdrillLayers(board: Board, via: Via): CopperLayer[] {
 return via.backdrill ? viaSpan(board,via).filter(l=>!viaLayers(board,via).includes(l)) : [];
}
export function copperDepths(board: Board): number[] | null {
 const d=board.stackup?.copperDepths;
 return d && d.length===board.copperCount && d.every((x,i)=>Number.isFinite(x)&&x>=0&&x<=board.thickness&&(i===0||x>d[i-1])) && Math.abs(d[0])<1e-6 && Math.abs(d[d.length-1]-board.thickness)<1e-6 ? d : null;
}
export function backdrillDepth(board: Board, via: Via): number | null {
 const d=copperDepths(board), bd=via.backdrill;
 if(!d||!bd)return null;
 const z=d[copperLayers(board.copperCount).indexOf(bd.stopLayer)];
 return bd.side==='F' ? z-bd.stub : board.thickness-z-bd.stub;
}
export function validateVia(board: Board, via: Via): string[] {
 const errors:string[]=[], span=viaSpan(board,via), layers=copperLayers(board.copperCount);
 if(span.length<2)errors.push('Invalid via start/end layers');
 if(![via.drill,via.size,via.x,via.y].every(Number.isFinite)||!(via.drill>0&&via.size>via.drill))errors.push('Via diameter must exceed its drill');
 const bd=via.backdrill;
 if(bd){
  if(span.length!==layers.length)errors.push('Backdrilling requires a through via');
  const i=layers.indexOf(bd.stopLayer);
  if(i<=0||i>=layers.length-1)errors.push('Backdrill stop must be an inner layer');
  if(!(bd.diameter>via.size))errors.push('Backdrill diameter must exceed via copper diameter');
  const d=copperDepths(board);
  if(!d)errors.push('Confirm copper-layer depths before backdrilling');
  else if(i>0&&i<layers.length-1){
   const gap=bd.side==='F'?d[i]-d[i-1]:d[i+1]-d[i];
   if(!(bd.stub>=0&&bd.stub<gap))errors.push('Residual stub must fit between stop and adjacent layer');
  }
 }
 return errors;
}
