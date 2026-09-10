import polygonClipping from 'polygon-clipping';
import { RULE_SETS, type RuleSet } from '../model/project.js';
import { zoneFills } from './zones.js';
import type { Board } from '../model/board.js';
import { allPads, boardBounds, footprintBody, footprintDef } from './geometry.js';
import { antennaGeometry } from './antennaPlacement.js';
import { pointInPolygon, pointSegDist, type Rect, type Vec } from '../geometry.js';
export interface PanelOptions { columns:number; rows:number; gap:number; rail:number; tabWidth:number; mouseBiteDrill?:number; mouseBitePitch?:number }
export interface PanelPlan { width:number;height:number;instances:{id:string;x:number;y:number;outline:Vec[]}[];rails:Rect[];tabs:Rect[];holes:Vec[];fiducials:Vec[];profile:Vec[][];errors:string[];options:PanelOptions }
const overlap=(a:Rect,b:Rect)=>a.x<b.x+b.w && b.x<a.x+a.w && a.y<b.y+b.h && b.y<a.y+a.h;
const inflate=(r:Rect,d:number):Rect=>({x:r.x-d,y:r.y-d,w:r.w+2*d,h:r.h+2*d});
const rect=(r:Rect):Vec[]=>[{x:r.x,y:r.y},{x:r.x+r.w,y:r.y},{x:r.x+r.w,y:r.y+r.h},{x:r.x,y:r.y+r.h}];
/** A non-destructive grid panel with continuous horizontal support rails. No V-score approximation. */
export function planPanel(board:Board,options:PanelOptions,rules:RuleSet=RULE_SETS[0]):PanelPlan {
  const {columns,rows,gap,rail,tabWidth}=options;
  if(![columns,rows].every(n=>Number.isInteger(n)&&n>=1&&n<=6)||![gap,rail,tabWidth].every(Number.isFinite)||gap<2||rail<5||tabWidth<2||tabWidth>10)throw new Error('Panel: rows/columns 1–6, gap ≥2 mm, rail ≥5 mm, tabs 2–10 mm');
  const mouseBiteDrill=options.mouseBiteDrill??.5,mouseBitePitch=options.mouseBitePitch??.85;
  if(![mouseBiteDrill,mouseBitePitch].every(Number.isFinite)||mouseBiteDrill<.3||mouseBiteDrill>1||mouseBitePitch-mouseBiteDrill<Math.max(.3,rules.minHoleToHole)-1e-7||mouseBitePitch+mouseBiteDrill+.4>tabWidth)throw new Error('Mouse bites: drill 0.3–1 mm, hole-edge gap ≥0.3 mm, at least two holes fit inside each tab');
  const holeKeepout=mouseBiteDrill/2+Math.max(rules.minNpthClearance,.25);
  const bb=boardBounds(board);
  if(board.outline.length<3 || bb.w<=0||bb.h<=0)throw new Error('Panel requires a closed board outline');
  const width=2*rail+2*gap+columns*bb.w+(columns-1)*gap;
  const height=(rows+1)*rail+rows*(bb.h+2*gap);
  const plan:PanelPlan={width,height,instances:[],rails:[],tabs:[],holes:[],fiducials:[],profile:[],errors:[],options:{...options,mouseBiteDrill,mouseBitePitch}};
  plan.rails.push({x:0,y:0,w:rail,h:height},{x:width-rail,y:0,w:rail,h:height});
  for(let r=0;r<=rows;r++)plan.rails.push({x:0,y:r*(bb.h+2*gap+rail),w:width,h:rail});
  const protectedAreas=board.footprints.flatMap(f=>{
    const ant=antennaGeometry(f,board),connector=footprintDef(f).connector;
    return [...(ant?[inflate(ant.area,5)]:[]),...(connector || /^(J|CN|USB|P)\d/i.test(f.ref)?[inflate(footprintBody(f),connector?.clearance ?? 3)]:[])];
  });
  const pads=allPads(board);
  if(pads.some(p=>p.def.castellated))plan.errors.push('Castellated boards require a fabricator-approved support layout; export the single board with its castellation manifest');
  const fills=zoneFills(board,rules).flatMap(f=>f.polygons);
  const copperNear=(p:Vec)=>fills.some(poly=>(pointInPolygon(p,poly[0])&&!poly.slice(1).some(h=>pointInPolygon(p,h))) || poly.some(r=>r.some((a,i)=>pointSegDist(p,a,r[(i+1)%r.length])<holeKeepout))) || pads.some(a=>overlap(inflate(a.rect,holeKeepout),{x:p.x,y:p.y,w:0.001,h:0.001})) || board.traces.some(t=>t.points.slice(1).some((b,i)=>pointSegDist(p,t.points[i],b)<t.width/2+holeKeepout)) || board.vias.some(v=>Math.hypot(v.x-p.x,v.y-p.y)<v.size/2+holeKeepout);
  for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
    const x=rail+gap+col*(bb.w+gap)-bb.x,y=rail+gap+row*(bb.h+2*gap+rail)-bb.y,id=`B${row*columns+col+1}`;
    plan.instances.push({id,x,y,outline:board.outline.map(p=>({x:p.x+x,y:p.y+y}))});
    for(const a of protectedAreas)if(plan.rails.some(r=>overlap(r,{...a,x:a.x+x,y:a.y+y})))plan.errors.push(`${id}: protected antenna / connector area intersects rail; increase gap`);
    for(const edge of ['top','bottom'] as const){
      const ey=edge==='top'?bb.y:bb.y+bb.h;
      let chosen:Rect|undefined;
      for(let cx=bb.x+tabWidth;cx<=bb.x+bb.w-tabWidth;cx+=Math.max(1,tabWidth)){
        const a={x:cx-tabWidth/2,y:ey-(edge==='top'?gap:0),w:tabWidth,h:gap};
        // A tab must attach to a straight exposed edge, never span a concave notch.
        const flat=board.outline.some((p,i)=>{const q=board.outline[(i+1)%board.outline.length];return Math.abs(p.y-ey)<1e-6&&Math.abs(q.y-ey)<1e-6&&Math.min(p.x,q.x)<=a.x&&Math.max(p.x,q.x)>=a.x+a.w;});
        if(!flat||protectedAreas.some(r=>overlap(inflate(a,0.3),r)))continue;
        const count=Math.floor((tabWidth-mouseBiteDrill-.4)/mouseBitePitch)+1;
        const start=a.x+(tabWidth-(count-1)*mouseBitePitch)/2;
        const bites=Array.from({length:count},(_,i)=>({x:start+i*mouseBitePitch,y:ey+(edge==='top'?-1:1)*(mouseBiteDrill/2+.1)}));
        if(bites.some(copperNear))continue;
        chosen=a;plan.holes.push(...bites.map(p=>({x:p.x+x,y:p.y+y})));break;
      }
      if(chosen)plan.tabs.push({...chosen,x:chosen.x+x,y:chosen.y+y});else plan.errors.push(`${id}: no safe ${edge} tab location`);
    }
  }
  // Reject protected-area intrusion into neighbouring boards as well as the support frame.
  for(const i of plan.instances)for(const a of protectedAreas)for(const other of plan.instances)if(i!==other && overlap({...a,x:a.x+i.x,y:a.y+i.y},{x:bb.x+other.x,y:bb.y+other.y,w:bb.w,h:bb.h}))plan.errors.push(`${i.id}: protected area intersects ${other.id}; increase gap`);
  const rings=[...plan.instances.map(i=>i.outline),...plan.rails.map(rect),...plan.tabs.map(t=>rect(inflate(t,0.01)))];
  const union=polygonClipping.union(...rings.map(r=>[r.map(p=>[p.x,p.y] as [number,number])]) as [polygonClipping.Polygon,...polygonClipping.Polygon[]]);
  if(union.length!==1)plan.errors.push('Panel has disconnected mechanical islands');
  plan.profile=union.flat().map(r=>r.map(([x,y])=>({x,y})));
  // Three asymmetric tooling holes and fiducials, deliberately separated along the rail.
  plan.fiducials=[{x:rail/2,y:rail*2},{x:width-rail/2,y:rail*2},{x:rail/2,y:height-rail*2}];
  const features=[...plan.fiducials.map(p=>({...p,r:1})),{x:rail/2,y:rail/2,r:0.75},{x:width-rail/2,y:rail/2,r:0.75},{x:rail/2,y:height-rail/2,r:0.75}];
  if(features.some((a,i)=>features.slice(i+1).some(b=>Math.hypot(a.x-b.x,a.y-b.y)<a.r+b.r+0.25)))plan.errors.push('Tooling/fiducial features overlap; adjust panel dimensions');
  return plan;
}
