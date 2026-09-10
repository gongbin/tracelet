import type { Board, CopperLayer, Trace, Via } from '../model/board.js';
import { copperLayers } from '../model/board.js';
import type { RuleSet } from '../model/project.js';
import { dist, pointInPolygon, pointSegDist, segSegDist, segRectDist, type Vec } from '../geometry.js';
import { allPads, netClassFor, type WorldPad } from './geometry.js';
import { RoutingSpace } from './routingSpace.js';
import { antennaGeometry } from './antennaPlacement.js';
import { viaLayers } from './via.js';
import { runDrc } from './drc.js';
import { copperShorts } from './copperConnectivity.js';
import { padOnStraightEdge } from './holes.js';

export interface RouteTarget { point: Vec; net: string; kind: 'pad' | 'trace' | 'via'; label: string; id: string; pad?: WorldPad }
const projection = (p: Vec, a: Vec, b: Vec): Vec => {
  const dx=b.x-a.x,dy=b.y-a.y,d=dx*dx+dy*dy;
  const t=d ? Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/d)) : 0;
  return {x:a.x+t*dx,y:a.y+t*dy};
};
/** Magnetic targets are electrical copper on the active layer, never NPTH or the opposite SMD face. */
export function routeTarget(board: Board, p: Vec, layer: CopperLayer, radius: number, net?: string, hidden: ReadonlySet<string> = new Set()): RouteTarget | null {
  const hits: {target:RouteTarget; distance:number; priority:number}[]=[];
  const eligible=(n:string)=>!!n && (net===undefined || n===net);
  for(const pad of allPads(board)) {
    if(hidden.has(pad.footprintId)||pad.def.npth||!pad.layers.includes(layer)||!eligible(pad.net))continue;
    const inside=p.x>=pad.rect.x && p.x<=pad.rect.x+pad.rect.w && p.y>=pad.rect.y && p.y<=pad.rect.y+pad.rect.h;
    const d=dist(p,pad.center);
    if(inside||d<=radius)hits.push({target:{point:pad.center,net:pad.net,kind:'pad',label:`${pad.ref}.${pad.number}`,id:pad.footprintId,pad},distance:inside?0:d,priority:0});
  }
  for(const v of board.vias)if(eligible(v.net)&&viaLayers(board,v).includes(layer)&&dist(p,v)<=Math.max(radius,v.size/2))hits.push({target:{point:{x:v.x,y:v.y},net:v.net,kind:'via',label:v.net,id:v.id},distance:dist(p,v),priority:1});
  for(const t of board.traces)if(eligible(t.net)&&t.layer===layer)for(let i=1;i<t.points.length;i++){
    const q=projection(p,t.points[i-1],t.points[i]),d=dist(p,q);
    if(d<=Math.max(radius,t.width/2))hits.push({target:{point:q,net:t.net,kind:'trace',label:t.net,id:t.id},distance:d,priority:2});
  }
  hits.sort((a,b)=>a.priority-b.priority||a.distance-b.distance||a.target.id.localeCompare(b.target.id));
  return hits[0]?.target??null;
}

export function cleanRoute(points: readonly Vec[]): Vec[] {
  const out:Vec[]=[];
  for(const p of points){
    if(out.length&&dist(out[out.length-1],p)<1e-7)continue;
    while(out.length>=2){const a=out[out.length-2],b=out[out.length-1];
      if(Math.abs((b.x-a.x)*(p.y-b.y)-(b.y-a.y)*(p.x-b.x))>1e-7 || (b.x-a.x)*(p.x-b.x)+(b.y-a.y)*(p.y-b.y)<0)break;
      out.pop();
    }
    out.push(p);
  }
  return out;
}
/** Endpoint-preserving 45 degree posture; both orders land at the exact target. */
export function route45(a: Vec,b: Vec,straightFirst=false):Vec[] {
  const dx=b.x-a.x,dy=b.y-a.y,d=Math.min(Math.abs(dx),Math.abs(dy));
  const bend=straightFirst?{x:b.x-Math.sign(dx)*d,y:b.y-Math.sign(dy)*d}:{x:a.x+Math.sign(dx)*d,y:a.y+Math.sign(dy)*d};
  return cleanRoute([a,bend,b]);
}
function bevelRoute(points:Vec[],limit:number):Vec[] {
  const out=[points[0]];
  for(let i=1;i<points.length-1;i++){
    const a=points[i-1],p=points[i],b=points[i+1],u=dist(a,p),v=dist(p,b);
    const orthogonal=Math.abs((p.x-a.x)*(b.x-p.x)+(p.y-a.y)*(b.y-p.y))<1e-7 && (Math.abs(p.x-a.x)<1e-7||Math.abs(p.y-a.y)<1e-7);
    if(!orthogonal||u<1e-6||v<1e-6){out.push(p);continue;}
    const d=Math.min(limit,u/2,v/2);
    out.push({x:p.x+(a.x-p.x)*d/u,y:p.y+(a.y-p.y)*d/u},{x:p.x+(b.x-p.x)*d/v,y:p.y+(b.y-p.y)*d/v});
  }
  out.push(points[points.length-1]);return cleanRoute(out);
}
export type RouteObstacle = 'clearance' | 'board-edge' | 'antenna' | 'layer' | 'width';
export interface RouteRequest {net:string;layer:CopperLayer;width:number}
/** Cached per board revision. Bounded suggestions, no mutation or shove of existing copper. */
export class InteractiveRouter {
  private space:RoutingSpace;
  private pads:WorldPad[];
  private antennas:NonNullable<ReturnType<typeof antennaGeometry>>[];
  constructor(private board:Board,private rules:RuleSet){
    this.space=new RoutingSpace(board,rules);this.pads=allPads(board);
    this.antennas=board.footprints.flatMap(f=>{const a=antennaGeometry(f,board);return a?[a]:[];});
  }
  clearance(r:RouteRequest){
    const heavy=(r.layer==='F.Cu'||r.layer==='B.Cu'?this.board.stackup?.copperWeight??1:this.board.stackup?.innerCopperWeight??.5)>=2;
    return Math.max(this.rules.minClearance,netClassFor(this.board,r.net)?.clearance??0,heavy?this.rules.heavyCopperMinTrace:0);
  }
  check(points:readonly Vec[],r:RouteRequest,viaCopper=false):RouteObstacle|null {
    const nc=netClassFor(this.board,r.net);
    if(!copperLayers(this.board.copperCount).includes(r.layer)||!viaCopper&&nc?.allowedLayers&&!nc.allowedLayers.includes(r.layer))return 'layer';
    const heavy=(r.layer==='F.Cu'||r.layer==='B.Cu'?this.board.stackup?.copperWeight??1:this.board.stackup?.innerCopperWeight??.5)>=2;
    if(!Number.isFinite(r.width)||r.width<Math.max(this.rules.minTraceWidth,heavy?this.rules.heavyCopperMinTrace:0))return 'width';
    const radius=r.width/2,clearance=this.clearance(r),outline=this.board.outline;
    const edgePad=(q:Vec)=>this.pads.find(p=>p.def.castellated&&!p.def.npth&&p.net===r.net&&dist(q,p.center)<1e-6&&padOnStraightEdge(this.board,p.center,Math.max(p.def.w,p.def.h)));
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i];
      if(outline.length<3||![a,b].every(q=>pointInPolygon(q,outline)||edgePad(q)))return 'board-edge';
      const edgeGap=radius+this.rules.copperToEdge;
      for(let j=0;j<outline.length;j++){
        const p=outline[j],q=outline[(j+1)%outline.length];
        if(segSegDist(a,b,p,q)>=edgeGap-1e-7)continue;
        // Only the short approach inside the explicitly castelled copper land may
        // reach this edge. Other edges and arbitrary near-edge tracks still fail.
        const end=pointSegDist(a,p,q)<1e-6&&edgePad(a)?a:pointSegDist(b,p,q)<1e-6&&edgePad(b)?b:null;
        const pad=end&&edgePad(end),other=end===a?b:a;
        if(!end||!pad||pointSegDist(other,p,q)<edgeGap-1e-7)return 'board-edge';
        const ratio=edgeGap/pointSegDist(other,p,q),approach={x:end.x+(other.x-end.x)*ratio,y:end.y+(other.y-end.y)*ratio};
        if(dist(end,approach)>Math.min(pad.def.w,pad.def.h)/2-radius+1e-6)return 'board-edge';
      }
      if(this.antennas.some(k=>segRectDist(a,b,k.area)<radius+clearance-1e-7))return 'antenna';
      if(!this.space.segmentFree(a,b,radius,r.layer,r.net,clearance))return 'clearance';
      // Drilling clearances can exceed copper-to-copper clearance, including same-net NPTH.
      for(const p of this.pads)if(p.def.drill>0 && (p.def.npth||p.net!==r.net)) {
        const need=p.def.npth?this.rules.minNpthClearance:this.rules.minPthHoleToCopper;
        if(pointSegDist(p.center,a,b)<radius+p.def.drill/2+need-1e-7)return 'clearance';
      }
    }
    return null;
  }
  suggest(a:Vec,b:Vec,r:RouteRequest,straightFirst=false,walkAround=true):{points:Vec[];reason:RouteObstacle|null;detour:boolean}{
    const direct=route45(a,b,straightFirst),reason=this.check(direct,r);
    if(!reason||!walkAround||reason==='layer'||reason==='width')return {points:direct,reason,detour:false};
    const other=route45(a,b,!straightFirst);
    if(!this.check(other,r))return {points:other,reason:null,detour:true};
    // Search a small set of octilinear channels around the cursor corridor. Continuous
    // segment tests prevent grid tunnelling through thin copper or a concave board edge.
    const candidates:Vec[][]=[],step=Math.max(.5,r.width+2*this.clearance(r));
    for(let i=1;i<=12;i++)for(const sign of [-1,1])for(const axis of ['x','y'] as const){
      const d=step*i*sign;
      const p={...a,[axis]:a[axis]+d},q={...b,[axis]:a[axis]+d};
      const path=cleanRoute([...route45(a,p,straightFirst),...route45(p,q,straightFirst).slice(1),...route45(q,b,straightFirst).slice(1)]);
      if(!this.check(path,r)){
        const bevel=[3,1,.25].map(d=>bevelRoute(path,d)).find(p=>!this.check(p,r));
        candidates.push(bevel??path);
      }
    }
    candidates.sort((p,q)=>routeLength(p)-routeLength(q)||p.length-q.length);
    return candidates.length?{points:candidates[0],reason:null,detour:true}:{points:direct,reason,detour:false};
  }
}
export const routeLength=(points:readonly Vec[])=>points.slice(1).reduce((n,p,i)=>n+dist(points[i],p),0);

/** Validate only added items, so unrelated pre-existing violations do not prevent repair. */
export function manualCopperIssues(board:Board,rules:RuleSet,traces:Omit<Trace,'id'>[],vias:Omit<Via,'id'>[]=[]):string[]{
  const used=new Set([...board.traces,...board.vias,...board.footprints].map(o=>o.id));
  const fresh=(kind:string,i:number)=>{let id=`__manual_${kind}_${i}`;while(used.has(id))id+='_';used.add(id);return id;};
  const ts=traces.map((t,i)=>({...t,id:fresh('t',i)})),vs=vias.map((v,i)=>({...v,id:fresh('v',i)}));
  const added=new Set([...ts,...vs].map(o=>o.id)),router=new InteractiveRouter(board,rules);
  const reasons=ts.flatMap(t=>{const issue=router.check(t.points,t);return issue?[issue]:[];}) as string[];
  for(const v of vs)for(const layer of viaLayers(board,v)){
    const issue=router.check([v,v],{net:v.net,layer,width:v.size},true);if(issue)reasons.push(issue);
  }
  const candidate={...board,traces:[...board.traces,...ts],vias:[...board.vias,...vs]};
  for(const item of [...runDrc(candidate,rules).items,...copperShorts(candidate,rules)])if(item.severity==='error'&&item.rule!=='unrouted'&&item.objectIds?.some(id=>added.has(id)))reasons.push(item.rule);
  return [...new Set(reasons)];
}
