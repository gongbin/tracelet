import {snapTo, type Rect, type Vec} from '@tracelet/kernel';
export interface AlignmentGuide {axis:'x'|'y';value:number;from:number;to:number}
export function alignDrag(raw:Vec, local:Rect, targets:Rect[], tolerance:number, grid:number):{position:Vec;guides:AlignmentGuide[]} {
 const base={x:snapTo(raw.x,grid),y:snapTo(raw.y,grid)};
 const moving={...local,x:local.x+raw.x,y:local.y+raw.y};
 const matches:Partial<Record<'x'|'y',{delta:number;guide:AlignmentGuide}>>={};
 for(const axis of ['x','y'] as const){
  const size=axis==='x'?'w':'h', cross=axis==='x'?'y':'x', crossSize=axis==='x'?'h':'w';
  let distance=tolerance;
  for(const r of targets)for(const a of [0,.5,1])for(const b of [0,.5,1]){
   const value=r[axis]+r[size]*b, delta=value-moving[axis]-moving[size]*a;
   if(Math.abs(delta)>=distance)continue;
   distance=Math.abs(delta);matches[axis]={delta,guide:{axis,value,from:Math.min(moving[cross],r[cross])-1,to:Math.max(moving[cross]+moving[crossSize],r[cross]+r[crossSize])+1}};
  }
 }
 const clear=(p:Vec)=>!targets.some(r=>Math.min(p.x+local.x+local.w,r.x+r.w)-Math.max(p.x+local.x,r.x)>1e-6&&Math.min(p.y+local.y+local.h,r.y+r.h)-Math.max(p.y+local.y,r.y)>1e-6);
 for(const axes of [['x','y'],['x'],['y']] as const){
  const p={...base}, guides:AlignmentGuide[]=[];
  for(const a of axes){const m=matches[a];if(m){p[a]=raw[a]+m.delta;guides.push(m.guide);}}
  if(guides.length&&clear(p))return {position:p,guides};
 }
 return {position:base,guides:[]};
}
export function rulerTicks(offset:number,scale:number,length:number):{value:number;pixel:number;major:boolean}[]{
 if(!(scale>0)||!Number.isFinite(length)||length<=0)return [];
 const power=10**Math.floor(Math.log10(70/scale));
 const major=([1,2,5,10].find(n=>n*power*scale>=70)??10)*power, minor=major/5;
 const start=Math.ceil((22-offset)/scale/minor),end=Math.floor((length-offset)/scale/minor);
 const ticks=[];
 for(let i=start;i<=end && ticks.length<2000;i++)ticks.push({value:Number((i*minor).toPrecision(10)),pixel:i*minor*scale+offset,major:i%5===0});
 return ticks;
}
