import {runSchematicErc} from '../schematic/erc.js';
import type {Project} from '../model/project.js';
import {ruleSetOf} from '../model/project.js';
import {runDrc} from './drc.js';
import {computeRatsnest} from './ratsnest.js';
import {checkPlacement} from './placement.js';
import {traceLengthStats} from './stats.js';
import {estimateImpedance} from './impedance.js';
import type {Vec} from '../geometry.js';
export interface EngineeringIssue {rule:string;severity:'error'|'warning'|'info';message:string;refs:string[];objectIds?:string[];location?:Vec;suggestion?:string;deduction:number}
export interface EngineeringCategory {id:'manufacturing'|'layout'|'routing'|'signal'|'impedance'|'appearance';score:number|null;weight:number;issues:EngineeringIssue[]}
const SIGNAL=new Set(['allowed-layers','max-length','neckdown','reference-plane','differential-gap','differential-skew','differential-incomplete','differential-unverified']);
export function engineeringReport(project:Project, cached?:{drc:ReturnType<typeof runDrc>;ratsnest:ReturnType<typeof computeRatsnest>;erc?:ReturnType<typeof runSchematicErc>}){
 const b=project.board,rules=ruleSetOf(project),drc=cached?.drc??runDrc(b,rules),rats=cached?.ratsnest??computeRatsnest(b,rules);
 const hasSchematic=project.schematic.sheets.some(s=>s.components.length>0);
 const erc={assessed:hasSchematic,report:hasSchematic?(cached?.erc??runSchematicErc(project.schematic)):null};
 const populated=b.footprints.length>0, placement=checkPlacement(b,rules),stats=traceLengthStats(b);
 const signalConfigured=b.netClasses.filter(n=>n.maxLength!==undefined||n.allowedLayers||n.referenceLayer||n.referenceNet||n.neckdown).length+(b.differentialPairs?.length??0);
 const score=(items:EngineeringIssue[],enabled=true)=>enabled?Math.max(0,100-Math.round(items.reduce((s,i)=>s+i.deduction,0))):null;
 const issues=(items:{rule:string;severity:'error'|'warning'|'info';message:string;refs:string[];location?:Vec;objectIds?:string[];suggestion?:string}[],penalty:{error:number;warning:number;info:number}):EngineeringIssue[]=>items.map(i=>({...i,deduction:penalty[i.severity]}));
 const manufacturing=issues(drc.items.filter(i=>!SIGNAL.has(i.rule)),{error:15,warning:3,info:0});
 const layout=issues(placement.filter(i=>!['alignment','grouping'].includes(i.rule)),{error:15,warning:4,info:1});
 const appearance=issues(placement.filter(i=>['alignment','grouping'].includes(i.rule)),{error:0,warning:2,info:2});
 const scale=Math.max(1,b.footprints.length/10);
 for(const issue of [...layout,...appearance])issue.deduction=Math.round(issue.deduction/scale*1000)/1000;
 const signal=issues(drc.items.filter(i=>SIGNAL.has(i.rule)),{error:15,warning:5,info:0});
 const routing:EngineeringIssue[]=[];
 if(rats.unrouted)routing.push({rule:'unrouted',severity:'error',message:`${rats.unrouted} / ${rats.total}`,refs:[],deduction:Math.ceil(100*rats.unrouted/Math.max(1,rats.total))});
 const unassigned=b.traces.filter(t=>!t.net);
 if(unassigned.length)routing.push({rule:'unassigned',severity:'warning',message:`${unassigned.length}`,refs:[],objectIds:unassigned.map(t=>t.id),location:unassigned[0].points[0],deduction:Math.min(20,unassigned.length*5)});
 let segments=0,non45=0;
 for(const t of b.traces)for(let i=1;i<t.points.length;i++){const dx=Math.abs(t.points[i].x-t.points[i-1].x),dy=Math.abs(t.points[i].y-t.points[i-1].y);if(Math.hypot(dx,dy)<1e-6)continue;segments++;if(Math.min(dx,dy,Math.abs(dx-dy))>1e-4)non45++;}
 // Non-45-degree routing is descriptive only: RF/mechanical geometry may legitimately require it.
 const categories:EngineeringCategory[]=[
  {id:'manufacturing',score:score(manufacturing,populated),weight:35,issues:manufacturing},
  {id:'layout',score:score(layout,populated),weight:25,issues:layout},
  {id:'routing',score:score(routing,populated&&rats.total>0),weight:25,issues:routing},
  {id:'signal',score:score(signal,populated&&signalConfigured>0&&rats.total>0&&rats.unrouted===0),weight:10,issues:signal},
  {id:'impedance',score:null,weight:0,issues:[]},
  {id:'appearance',score:score(appearance,b.footprints.length>1),weight:5,issues:appearance}
 ];
 const assessed=categories.filter(c=>c.score!==null),weight=assessed.reduce((s,c)=>s+c.weight,0);
 const blockers:string[]=[];
 if(!populated)blockers.push('empty');if(b.outline.length<3)blockers.push('outline');if(rats.unrouted)blockers.push('unrouted');if(drc.errors)blockers.push('drc');if(erc.report?.errors)blockers.push('erc');
 const impedance=(b.stackup?.impedanceProfiles??[]).map(p=>{try{const ohms=estimateImpedance(p);return {...p,ohms,deviationPercent:100*(ohms-p.target)/p.target};}catch{return {...p,ohms:null,deviationPercent:null};}});
 return {version:1,projectId:project.id,projectName:project.name,updatedAt:project.updatedAt,ruleSet:rules.name,score:weight?Math.round(assessed.reduce((s,c)=>s+c.score!*c.weight,0)/weight):null,assessed:assessed.length,categories,blockers,erc,
  facts:{components:b.footprints.length,layers:b.copperCount,drcErrors:drc.errors,drcWarnings:drc.warnings,totalConnections:rats.total,unrouted:rats.unrouted,completion:rats.total?100*(rats.total-rats.unrouted)/rats.total:null,traceLength:stats.total,vias:b.vias.length,segments,non45,signalConfigured,overlaps:placement.filter(i=>i.rule==='overlap').length,outside:placement.filter(i=>i.rule==='outside').length},
  nets:stats.nets,impedance,
  methodology:'v1 heuristic review, not fabrication approval or SI certification. Category weights 35/25/25/10/0/5; unassessed categories excluded from denominator. DRC -15/error -3/warning; layout -15/error -4/warning -1/info; signal -15/error -5/warning; appearance -2/issue. Layout and appearance deductions are divided by max(1, component count / 10), then total deductions rounded; this normalizes board size. Routing deducts missing connection percentage (rounded up), plus 5/unassigned trace (max 20). Scores floor at zero. Impedance profile estimates are not verified trace impedance. Segment angles are descriptive only.'};
}
