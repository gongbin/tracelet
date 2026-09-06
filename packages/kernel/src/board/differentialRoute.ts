import {antennaGeometry} from './antennaPlacement.js';
/** Coupled single-layer corridor search. Existing copper and branched pairs are never rewritten. */
import type {Board,Trace,CopperLayer} from '../model/board.js';
import type {RuleSet} from '../model/project.js';
import {allPads,boardBounds,netClassFor} from './geometry.js';
import {netRules} from './routingModel.js';
import {RoutingSpace} from './routingSpace.js';
import {zoneFills,traceTouchesPolygon} from './zones.js';
import {pointInPolygon,pointSegDist,segSegDist,segRectDist,type Vec} from '../geometry.js';
import {validateRoutingProposal} from './routingValidation.js';
export type PairSpec=NonNullable<Board['differentialPairs']>[number];
type Output=Omit<Trace,'id'>;
const dist=(a:Vec,b:Vec)=>Math.hypot(a.x-b.x,a.y-b.y);
export const pairTraceLength=(points:Vec[])=>points.slice(1).reduce((n,p,i)=>n+dist(points[i],p),0);
const add=(a:Vec,b:Vec,k=1)=>({x:a.x+b.x*k,y:a.y+b.y*k});
const unit=(a:Vec,b:Vec)=>{const d=dist(a,b);return {x:(b.x-a.x)/d,y:(b.y-a.y)/d};};
function simplify(p:Vec[]){const out:Vec[]=[];for(const v of p){if(out.length&&dist(out[out.length-1],v)<1e-7)continue;while(out.length>1){const a=out[out.length-2],b=out[out.length-1];if(Math.abs((b.x-a.x)*(v.y-b.y)-(b.y-a.y)*(v.x-b.x))>1e-7||(b.x-a.x)*(v.x-b.x)+(b.y-a.y)*(v.y-b.y)<0)break;out.pop();}out.push(v);}return out;}
function offset(p:Vec[],amount:number){return p.map((v,i)=>{
 const a=unit(p[Math.max(0,i-1)],p[i===0?1:i]),b=unit(p[i===p.length-1?i-1:i],p[Math.min(p.length-1,i+1)]);
 const na={x:-a.y,y:a.x},nb={x:-b.y,y:b.x},den=1+a.x*b.x+a.y*b.y;
 return add(v,{x:(na.x+nb.x)/den,y:(na.y+nb.y)/den},amount);
});}
class Queue { private heap:{key:string;f:number}[]=[];push(key:string,f:number){const v={key,f};let i=this.heap.length;this.heap.push(v);while(i){const p=(i-1)>>1;if(this.heap[p].f<=f)break;this.heap[i]=this.heap[p];i=p;}this.heap[i]=v;}pop(){const first=this.heap[0],last=this.heap.pop()!;if(this.heap.length){let i=0;while(i*2+1<this.heap.length){let c=i*2+1;if(c+1<this.heap.length&&this.heap[c+1].f<this.heap[c].f)c++;if(this.heap[c].f>=last.f)break;this.heap[i]=this.heap[c];i=c;}this.heap[i]=last;}return first;}get length(){return this.heap.length;}}
/** Outward 45-degree trapezoid adds exact planar length; never edits the caller's trace. */
export function compensatePair(short:Output,long:Output,maxSkew:number,legal:(points:Vec[])=>boolean):Output|null{
 let delta=pairTraceLength(long.points)-pairTraceLength(short.points);
 if(delta<=maxSkew+1e-6)return short;
 // Prefer long segments so compensation remains local and has few bends.
 const segments=short.points.slice(1).map((b,i)=>({i,a:short.points[i],b,len:dist(short.points[i],b)})).sort((a,b)=>b.len-a.len);
 for(const s of segments){
  const h=delta/(2*(Math.SQRT2-1)),plateau=Math.max(short.width*3,.3);
  if(2*h+plateau>s.len-.2)continue;
  const u=unit(s.a,s.b),n={x:-u.y,y:u.x},start=add(s.a,u,(s.len-2*h-plateau)/2);
  const candidates=[1,-1].map(sign=>{
   const p1=add(add(start,u,h),n,sign*h),p2=add(p1,u,plateau),end=add(start,u,2*h+plateau);
   return simplify([...short.points.slice(0,s.i+1),start,p1,p2,end,...short.points.slice(s.i+1)]);
  });
  for(const points of candidates)if(legal(points)&&Math.abs(pairTraceLength(points)-pairTraceLength(long.points))<=maxSkew+1e-6)return {...short,points};
 }
 return null;
}
export function routeDifferentialPair(board:Board,rules:RuleSet,pair:PairSpec,options:{grid?:number;deadline?:number;maxNodes?:number}={}):{traces:Output[];reason?:string;compensated?:boolean}{
 const fail=(reason:string)=>({traces:[] as Output[],reason});
 if(![pair.gap,pair.maxSkew,pair.tolerance].every(Number.isFinite)||pair.gap<=0||pair.maxSkew<0||pair.tolerance<0)return fail('Invalid differential constraints');
 if(options.grid!==undefined&&(!Number.isFinite(options.grid)||options.grid<=0))return fail('Invalid routing grid');
 if(pair.positive===pair.negative)return fail('Pair nets must be distinct');
 if(board.traces.some(t=>[pair.positive,pair.negative].includes(t.net))||board.vias.some(t=>[pair.positive,pair.negative].includes(t.net)))return fail('Existing pair copper is preserved; clear both nets before coupled routing');
 const pads=allPads(board).filter(p=>!p.def.npth),pp=pads.filter(p=>p.net===pair.positive),nn=pads.filter(p=>p.net===pair.negative);
 if(pp.length!==2||nn.length!==2)return fail('Coupled routing requires exactly two pads per net');
 if(dist(pp[0].center,nn[1].center)+dist(pp[1].center,nn[0].center)<dist(pp[0].center,nn[0].center)+dist(pp[1].center,nn[1].center))nn.reverse();
 const rp=netRules(board,rules,pair.positive),rn=netRules(board,rules,pair.negative);
 if(Math.abs(rp.width-rn.width)>1e-6)return fail('Pair trace widths must match');
 if(pair.gap<Math.max(rp.clearance,rn.clearance)-1e-7)return fail('Pair gap is below the manufacturing clearance');
 const layers=pp[0].layers.filter(l=>[pp[1],...nn].every(p=>p.layers.includes(l)) && [pair.positive,pair.negative].every(net=>{const nc=netClassFor(board,net);return !nc?.allowedLayers||nc.allowedLayers.includes(l);}));
 if(!layers.length)return fail('No common allowed layer; coupled via transitions are not supported');
 const width=rp.width,half=(width+pair.gap)/2,radius=(half+width/2)*Math.SQRT2;
 const start={x:(pp[0].center.x+nn[0].center.x)/2,y:(pp[0].center.y+nn[0].center.y)/2},end={x:(pp[1].center.x+nn[1].center.x)/2,y:(pp[1].center.y+nn[1].center.y)/2};
 if(dist(start,end)<1e-6)return fail('Pair endpoints overlap');
 const bounds=boardBounds(board),grid=Math.max(.1,options.grid??.5),deadline=options.deadline??Date.now()+5000;
 const fills=zoneFills(board,rules),space=new RoutingSpace(board,rules);space.removeNet(pair.positive);space.removeNet(pair.negative);
 const antennas=board.footprints.map(f=>antennaGeometry(f,board)?.area).filter(a=>a!==undefined);
 const inside=(a:Vec,b:Vec,r:number)=>antennas.every(area=>segRectDist(a,b,area)>r+1e-7)&&board.outline.length>=3&&pointInPolygon(a,board.outline)&&pointInPolygon(b,board.outline)&&board.outline.every((p,i)=>segSegDist(a,b,p,board.outline[(i+1)%board.outline.length])>=r+rules.copperToEdge-1e-7);
 const clearance=Math.max(rp.clearance,rn.clearance);
 const clear=(a:Vec,b:Vec,layer:CopperLayer)=>inside(a,b,radius)&&space.segmentFree(a,b,radius,layer,'',clearance)&&!fills.some(f=>f.zone.layer===layer && f.polygons.some(poly=>traceTouchesPolygon({points:[a,b],width:2*(radius+clearance)},poly)));
 const dirs=[{x:1,y:0},{x:1,y:1},{x:0,y:1},{x:-1,y:1},{x:-1,y:0},{x:-1,y:-1},{x:0,y:-1},{x:1,y:-1}];
 const originalSpace=new RoutingSpace(board,rules);
 const legal=(t:Output,other?:Output)=>t.points.slice(1).every((b,i)=>t.points.slice(i+3).every((d,k)=>segSegDist(t.points[i],b,t.points[i+2+k],d)>t.width-1e-7))&&t.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))&&t.points.slice(1).every((b,i)=>{
  const a=t.points[i];return inside(a,b,t.width/2)&&originalSpace.segmentFree(a,b,t.width/2,t.layer,t.net,clearance)&&!fills.some(f=>f.zone.layer===t.layer&&f.zone.net!==t.net&&f.polygons.some(poly=>traceTouchesPolygon({points:[a,b],width:t.width+2*clearance},poly)))&&(!other||other.points.slice(1).every((d,j)=>segSegDist(a,b,other.points[j],d)>=(t.width+other.width)/2+pair.gap-1e-6));
 });
 for(const layer of layers){
  const q=new Queue(),cost=new Map<string,number>(),parents=new Map<string,string>(),points=new Map<string,Vec>();
  const root='0,0,8';q.push(root,dist(start,end));cost.set(root,0);points.set(root,start);let expanded=0;
  while(q.length&&expanded++<(options.maxNodes??60000)&&Date.now()<deadline){
   const cur=q.pop(),a=points.get(cur.key)!,g=cost.get(cur.key)!;if(cur.f>g+dist(a,end)+1e-6)continue;
   const [x,y,heading]=cur.key.split(',').map(Number);
   if(dist(a,end)<=grid*1.5&&clear(a,end,layer)&&Math.abs((dist(a,end)>1e-7?end.x-a.x:dirs[heading%8].x)*(pp[1].center.x-nn[1].center.x)+(dist(a,end)>1e-7?end.y-a.y:dirs[heading%8].y)*(pp[1].center.y-nn[1].center.y))<1e-6){
    const path:Vec[]=[end];let k:string|undefined=cur.key;while(k){path.push(points.get(k)!);k=parents.get(k);}path.reverse();const center=simplify(path);
    if(center.length<2)continue;
    const first=unit(center[0],center[1]),side=((pp[0].center.x-start.x)*-first.y+(pp[0].center.y-start.y)*first.x)>=0?1:-1;
    let p:Output={net:pair.positive,layer,width,points:simplify([pp[0].center,...offset(center,half*side),pp[1].center])};
    let n:Output={net:pair.negative,layer,width,points:simplify([nn[0].center,...offset(center,-half*side),nn[1].center])};
    if(!legal(p,n)||!legal(n,p))continue;
    const before=Math.abs(pairTraceLength(p.points)-pairTraceLength(n.points));
    if(before>pair.maxSkew){
     if(pairTraceLength(p.points)<pairTraceLength(n.points)){const tuned=compensatePair(p,n,pair.maxSkew,points=>legal({...p,points},n));if(!tuned)continue;p=tuned;}
     else{const tuned=compensatePair(n,p,pair.maxSkew,points=>legal({...n,points},p));if(!tuned)continue;n=tuned;}
    }
    const validated=validateRoutingProposal(board,rules,[p,n],[]);
    if(validated.traces.length===2&&!validated.rejectedNets.length)return {traces:[p,n],compensated:before>pair.maxSkew};
    continue;
   }
   for(let h=0;h<dirs.length;h++){
    if(heading!==8&&Math.min((h-heading+8)%8,(heading-h+8)%8)>2)continue;
    const d=dirs[h];if(heading===8&&Math.abs(d.x*(pp[0].center.x-nn[0].center.x)+d.y*(pp[0].center.y-nn[0].center.y))>1e-6)continue;const nx=x+d.x,ny=y+d.y,b={x:nx!==0&&nx===Math.round((end.x-start.x)/grid)?end.x:start.x+nx*grid,y:ny!==0&&ny===Math.round((end.y-start.y)/grid)?end.y:start.y+ny*grid};
    if(b.x<bounds.x||b.y<bounds.y||b.x>bounds.x+bounds.w||b.y>bounds.y+bounds.h||!clear(a,b,layer))continue;
    const key=`${nx},${ny},${h}`,ng=g+dist(a,b)+(heading===8||h===heading?0:grid*.5);
    if(ng>=(cost.get(key)??Infinity))continue;cost.set(key,ng);parents.set(key,cur.key);points.set(key,b);q.push(key,ng+dist(b,end));
   }
  }
 }
 return fail(Date.now()>=deadline?'Coupled search time budget exhausted':'No legal coupled corridor or length compensation space');
}
