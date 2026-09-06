/** DC copper + user-supplied lumped thermal resistance; NOT IPC-2152 or a field solver.
 * rho25=16.8e-9 ohm m, alpha=.0039/K, per TI TIDUCS7 equation 6.
 * Reference: https://www.ti.com/lit/ug/tiducs7/tiducs7.pdf
 */
import type {Board,NetClass} from '../model/board.js';
import {allPads,netClassFor} from './geometry.js';
import {segSegDist} from '../geometry.js';
export type PowerInput=NonNullable<NetClass['power']>;
export function solveCopperThermal(resistance25:number,p:PowerInput){
 if(![resistance25,p.currentA,p.copperThicknessMm,p.ambientC].every(Number.isFinite)||resistance25<0||p.currentA<0||p.copperThicknessMm<=0||p.ambientC< -50||p.ambientC>200||p.thermalResistanceKPerW!==undefined&&(!Number.isFinite(p.thermalResistanceKPerW)||p.thermalResistanceKPerW<=0))throw new Error('Invalid conductor model parameters');
 if(!Number.isFinite(p.currentA*p.currentA))throw new Error('Current outside model range');
 const alpha=.0039,base=resistance25*(1+alpha*(p.ambientC-25)),theta=p.thermalResistanceKPerW;
 const denominator=1-(theta??0)*p.currentA*p.currentA*resistance25*alpha;
 if(denominator<=0)return {status:'unstable' as const,resistanceOhm:null,dropV:null,lossW:null,riseC:null,temperatureC:null};
 const resistanceOhm=base/denominator,lossW=p.currentA*p.currentA*resistanceOhm,dropV=p.currentA*resistanceOhm,riseC=theta===undefined?null:theta*lossW;
 return {status:theta===undefined?'electrical-only' as const:'estimated' as const,resistanceOhm,dropV,lossW,riseC,temperatureC:riseC===null?null:p.ambientC+riseC};
}
export interface PowerEstimate {net:string;status:'unassessed'|'electrical-only'|'estimated'|'unstable';reason?:string;currentA:number;resistanceOhm:number|null;dropV:number|null;lossW:number|null;riseC:number|null;temperatureC:number|null;minimumWidthMm:number|null;warnings:string[]}
/** Only unbranched two-terminal, single-layer trace chains. Pours/vias/parallel paths require a network solver. */
export function powerThermalReport(board:Board):PowerEstimate[]{
 const pads=allPads(board).filter(p=>!p.def.npth),nets=[...new Set([...board.traces.map(t=>t.net),...pads.map(p=>p.net),...board.netClasses.flatMap(n=>n.nets)])].filter(Boolean);
 return nets.filter(n=>netClassFor(board,n)?.power).map(net=>{
  const p=netClassFor(board,net)!.power!,traces=board.traces.filter(t=>t.net===net),terminals=pads.filter(p=>p.net===net);
  const empty:PowerEstimate={net,status:'unassessed',currentA:p.currentA,resistanceOhm:null,dropV:null,lossW:null,riseC:null,temperatureC:null,minimumWidthMm:null,warnings:[]};
  if(terminals.length!==2||board.zones.some(z=>z.net===net)||board.vias.some(v=>v.net===net)||!traces.length)return {...empty,reason:'Requires a two-terminal trace chain without vias or copper pours'};
  if(new Set(traces.map(t=>t.layer)).size!==1||terminals.some(p=>!p.layers.includes(traces[0].layer)))return {...empty,reason:'No verified single-layer terminal path'};
  const key=(v:{x:number;y:number})=>`${v.x.toFixed(7)},${v.y.toFixed(7)}`;
  const adjacency=new Map<string,Set<string>>(),positions=new Map<string,{x:number;y:number}>();
  const segments=traces.flatMap(t=>t.points.slice(1).map((b,i)=>({a:t.points[i],b,width:t.width})));
  let resistance25=0;
  for(const s of segments){
   const len=Math.hypot(s.b.x-s.a.x,s.b.y-s.a.y);if(len<1e-7||s.width<=0||!Number.isFinite(s.width))return {...empty,reason:'Invalid or zero-length conductor'};
   const a=key(s.a),b=key(s.b);positions.set(a,s.a);positions.set(b,s.b);
   if(adjacency.get(a)?.has(b))return {...empty,reason:'Parallel or duplicate conductor segments'};
   if(!adjacency.has(a))adjacency.set(a,new Set());if(!adjacency.has(b))adjacency.set(b,new Set());adjacency.get(a)!.add(b);adjacency.get(b)!.add(a);
   resistance25+=16.8e-6*len/(s.width*p.copperThicknessMm); // mm units
  }
  const ends=[...adjacency].filter(([,neighbors])=>neighbors.size===1).map(([k])=>k);
  if(ends.length!==2||[...adjacency.values()].some(v=>v.size>2))return {...empty,reason:'Branched or cyclic copper requires a current-distribution solver'};
  const seen=new Set<string>(),queue=[ends[0]];while(queue.length){const k=queue.pop()!;if(seen.has(k))continue;seen.add(k);queue.push(...adjacency.get(k)!);}
  if(seen.size!==adjacency.size)return {...empty,reason:'Disconnected conductor fragments'};
  // Reject mid-segment contacts or overlaps that the endpoint graph cannot represent.
  for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++){
   const a=segments[i],b=segments[j],shared=[a.a,a.b].some(p=>[b.a,b.b].some(q=>key(p)===key(q)));
   if(shared){const c=[a.a,a.b].find(p=>[b.a,b.b].some(q=>key(p)===key(q)))!,u=key(a.a)===key(c)?a.b:a.a,v=key(b.a)===key(c)?b.b:b.a;if(Math.abs((u.x-c.x)*(v.y-c.y)-(u.y-c.y)*(v.x-c.x))<1e-8&&(u.x-c.x)*(v.x-c.x)+(u.y-c.y)*(v.y-c.y)>0)return {...empty,reason:'Overlapping conductor segments'};}
   if(!shared&&segSegDist(a.a,a.b,b.a,b.b)<=(a.width+b.width)/2)return {...empty,reason:'Copper intersections require a current-distribution solver'};
  }
  const endpoint=ends.map(k=>positions.get(k)!);
  const near=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y)<1e-5;
  if(!(near(endpoint[0],terminals[0].center)&&near(endpoint[1],terminals[1].center)||near(endpoint[1],terminals[0].center)&&near(endpoint[0],terminals[1].center)))return {...empty,reason:'Trace endpoints must terminate at the two pad centers'};
  const result=solveCopperThermal(resistance25,p),warnings:string[]=[];
  if(result.status==='unstable')warnings.push('No stable equilibrium in this lumped model');
  if(p.maxDropV!==undefined&&result.dropV!==null&&result.dropV>p.maxDropV)warnings.push('Voltage drop exceeds configured limit');
  if(p.maxRiseC!==undefined&&result.riseC!==null&&result.riseC>p.maxRiseC)warnings.push('Temperature rise exceeds configured limit');
  if(result.temperatureC!==null&&result.temperatureC>200)warnings.push('Temperature outside the model reporting range; review manually');
  return {...empty,...result,minimumWidthMm:Math.min(...traces.map(t=>t.width)),warnings};
 });
}
