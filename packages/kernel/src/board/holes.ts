import type { Board, FootprintDef } from '../model/board.js';
import type { Vec } from '../geometry.js';
import { dist, pointSegDist } from '../geometry.js';

export function castellatedFootprint(drill:number,ring:number,count:number,pitch:number):FootprintDef {
  if(![drill,ring,pitch].every(Number.isFinite)||drill<.5||ring<.25||!Number.isInteger(count)||count<1||count>40||pitch<drill+2*ring+.2)throw new Error('Castellation: drill ≥0.5 mm, ring ≥0.25 mm, 1–40 holes, copper gap ≥0.2 mm');
  const size=drill+2*ring,name=`Castellated_${count}x${drill}_${ring}_P${pitch}`;
  return {id:`fp:gen:${name}`,name,body:{w:(count-1)*pitch+size,h:size},height:0,description:'Plated half-holes; requires castellation fabrication',pads:Array.from({length:count},(_,i)=>({number:String(i+1),x:(i-(count-1)/2)*pitch,y:0,w:size,h:size,shape:'circle',drill,npth:false,castellated:true}))};
}
/** Align a full row to one straight edge; refuse rows too close to corners or notches. */
export function snapCastellatedRow(board:Board,cursor:Vec,span:number,tolerance:number):{x:number;y:number;rotation:number;edge:number}|null {
  let best:{x:number;y:number;rotation:number;edge:number}|null=null,distance=tolerance;
  board.outline.forEach((a,i)=>{
    const b=board.outline[(i+1)%board.outline.length],dx=b.x-a.x,dy=b.y-a.y,len=dist(a,b);
    const margin=span/2+.5;
    if(len<2*margin)return;
    const along=Math.max(margin,Math.min(len-margin,((cursor.x-a.x)*dx+(cursor.y-a.y)*dy)/len));
    const p={x:a.x+along*dx/len,y:a.y+along*dy/len},d=dist(cursor,p);
    if(d<=distance){distance=d;best={...p,rotation:Math.atan2(dy,dx)*180/Math.PI,edge:i};}
  });return best;
}
export function padOnStraightEdge(board:Board,center:Vec,diameter:number):boolean {
  return board.outline.some((a,i)=>{const b=board.outline[(i+1)%board.outline.length];return pointSegDist(center,a,b)<1e-5&&dist(center,a)>=diameter/2+.5-1e-6&&dist(center,b)>=diameter/2+.5-1e-6;});
}
