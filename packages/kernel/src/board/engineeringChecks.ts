import type { Board } from '../model/board.js';
import type { RuleSet } from '../model/project.js';
import type { CheckItem } from '../schematic/erc.js';
import { pointSegDist } from '../geometry.js';
import { engineeringRules, isPairPartner, closeParallelLength } from './engineeringRules.js';
import { viaLayers } from './via.js';

export function engineeringChecks(board: Board, rules?: RuleSet): Omit<CheckItem,'id'>[] {
  const out: Omit<CheckItem,'id'>[]=[];
  const push=(rule:string,message:string,refs:string[],objectIds:string[])=>out.push({rule,message,refs,objectIds,severity:'warning',why:'Explicit engineering recommendation; geometric screening, not SI or thermal certification.'});
  // Aggregate by net pair/layer so splitting a trace cannot hide prolonged coupling.
  const parallel=new Map<string,{length:number;limit:number;refs:string[];ids:Set<string>}>();
  for(let i=0;i<board.traces.length;i++)for(let j=i+1;j<board.traces.length;j++){
    const a=board.traces[i],b=board.traces[j];if(a.net===b.net||a.layer!==b.layer||isPairPartner(board,a.net,b.net))continue;
    const ra=engineeringRules(board,a.net),rb=engineeringRules(board,b.net);
    const gap=Math.max(ra.preferredClearance??0,rb.preferredClearance??0);
    const limit=Math.min(ra.maxParallelLength??Infinity,rb.maxParallelLength??Infinity);
    if(!gap||!Number.isFinite(limit))continue;
    let length=0;
    for(let x=1;x<a.points.length;x++)for(let y=1;y<b.points.length;y++)length+=closeParallelLength(a.points[x-1],a.points[x],b.points[y-1],b.points[y],gap+(a.width+b.width)/2);
    if(!length)continue;
    const refs=[a.net,b.net].sort(),key=JSON.stringify([...refs,a.layer]);
    const item=parallel.get(key)??{length:0,limit,refs,ids:new Set<string>()};item.length+=length;item.ids.add(a.id);item.ids.add(b.id);parallel.set(key,item);
  }
  for(const p of parallel.values())if(p.length>p.limit+1e-6)push('parallel-exposure',`Close parallel copper ${p.length.toFixed(2)} mm exceeds ${p.limit} mm recommendation`,p.refs,[...p.ids]);
  for(const v of board.vias){
    const r=engineeringRules(board,v.net);if(!r.returnViaDistance)continue;
    const span=viaLayers(board,v);
    const used=new Set(board.traces.filter(t=>t.net===v.net && t.points.slice(1).some((p,i)=>pointSegDist(v,t.points[i],p)<=(v.size+t.width)/2)).map(t=>t.layer));
    if(used.size<2)continue;
    if(!r.referenceNet){push('return-via-unassessed','Set a reference net to assess return vias',[v.net],[v.id]);continue;}
    const candidates=board.vias.filter(g=>g.net===r.referenceNet && Math.hypot(g.x-v.x,g.y-v.y)<=r.returnViaDistance! && span.every(l=>viaLayers(board,g).includes(l)));
    if(!candidates.length)push('return-via','No reference-net via spanning the signal via layers within the configured distance',[v.net,r.referenceNet],[v.id]);
  }
  return out;
}
