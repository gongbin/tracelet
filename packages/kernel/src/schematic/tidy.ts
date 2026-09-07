import type { Schematic, Sheet } from '../model/schematic.js';
import { buildSchematicNetlist } from './connectivity.js';
import { componentBounds, pinGeoms } from './geometry.js';
import { symbolTextPositions } from './render.js';
import { getSymbol } from '../library/symbols.js';
import { pointOnSeg, UnionFind, type Vec } from '../geometry.js';

/** Compare identities and electrical partitions, including aliases and isolated pins. */
export function electricalIdentity(schematic:Schematic):string {
  const nl=buildSchematicNetlist(schematic);
  const pin=(p:{sheetId?:string;componentId:string;pinNumber:string})=>JSON.stringify([p.sheetId,p.componentId,p.pinNumber]);
  return JSON.stringify({
    components:schematic.sheets.flatMap(s=>s.components.map(c=>JSON.stringify([s.id,c.id,c.ref,c.symbolId,c.value,c.footprint,c.pinMap ?? null]))).sort(),
    nets:nl.nets.map(n=>JSON.stringify([n.name,n.pins.map(pin).sort(),[...n.labels].sort(),[...n.powerNames].sort(),n.driven])).sort(),
    isolated:[...nl.pinNet.entries()].filter(([,net])=>!net).sort(),
  });
}
export function assertElectricalIdentity(before:Schematic,after:Schematic):void {
  if(electricalIdentity(before)!==electricalIdentity(after))throw new Error('Schematic electrical identity changed; cleanup rejected');
}

/** Arrange complete geometric islands; never tear a component away from an existing wire. */
export function tidySchematic(source:Schematic,sheetId:string):{schematic:Schematic;groups:number;cleanedWires:number;movedTexts:number} {
  const schematic=structuredClone(source), sheet=schematic.sheets.find(s=>s.id===sheetId);
  if(!sheet)throw new Error('Unknown sheet');
  const uf=new UnionFind(), nodes=new Map<string,Vec[]>();
  for(const c of sheet.components)nodes.set(c.id,pinGeoms(c).map(p=>p.end));
  for(const w of sheet.wires)nodes.set(w.id,w.points);
  for(const p of [...sheet.labels,...sheet.junctions])nodes.set(p.id,[p]);
  for(const id of nodes.keys())uf.find(id);
  const segs=sheet.wires.flatMap(w=>w.points.slice(1).map((b,i)=>({id:w.id,a:w.points[i],b})));
  const at=new Map<string,string>();
  for(const [id,pts] of nodes)for(const p of pts){
    const k=`${p.x.toFixed(3)},${p.y.toFixed(3)}`;if(at.has(k))uf.union(id,at.get(k)!);else at.set(k,id);
    for(const s of segs)if(pointOnSeg(p,s.a,s.b,0.5))uf.union(id,s.id);
  }
  const named=new Map<string,string>();
  for(const c of sheet.components)if(c.props.group){const prev=named.get(c.props.group);if(prev)uf.union(prev,c.id);else named.set(c.props.group,c.id);}
  const groups=[...uf.groups().values()];
  // Graphics/buses carry user-authored spatial intent; retain placement in those sheets.
  if(!sheet.buses.length && !sheet.graphics.length){
    let x=700,y=700,rowH=0;
    for(const ids of groups){
      const set=new Set(ids), points:Vec[]=[];
      for(const id of ids)points.push(...nodes.get(id)!);
      for(const c of sheet.components.filter(c=>set.has(c.id))){const b=componentBounds(c);points.push({x:b.x-200,y:b.y-200},{x:b.x+b.w+Math.max(c.value.length,c.ref.length)*80+250,y:b.y+b.h+250});}
      for(const l of sheet.labels.filter(l=>set.has(l.id)))points.push({x:l.x+l.text.length*80+100,y:l.y-200});
      if(!points.length)continue;
      const minX=Math.min(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y));
      const w=Math.max(...points.map(p=>p.x))-minX,h=Math.max(...points.map(p=>p.y))-minY;
      if(x>700 && x+w>10000){x=700;y+=rowH+600;rowH=0;}
      const dx=x-minX,dy=y-minY; const move=(p:Vec)=>{p.x+=dx;p.y+=dy;};
      for(const c of sheet.components)if(set.has(c.id))move(c);
      for(const w of sheet.wires)if(set.has(w.id))w.points.forEach(move);
      for(const p of [...sheet.labels,...sheet.junctions])if(set.has(p.id))move(p);
      x+=w+600;rowH=Math.max(rowH,h);
    }
  }
  // Remove redundant collinear vertices only if the full netlist stays identical.
  let cleanedWires=0;
  for(const w of sheet.wires){
    const old=w.points;
    w.points=old.filter((p,i)=>i===0||i===old.length-1||!pointOnSeg(p,old[i-1],old[i+1],1e-7));
    if(w.points.length<2 || electricalIdentity(source)!==electricalIdentity(schematic))w.points=old;
    else if(w.points.length!==old.length)cleanedWires++;
  }
  const boxes=sheet.components.map(c=>componentBounds(c));let movedTexts=0;
  for(const c of sheet.components){
    if(getSymbol(c.symbolId).power)continue;
    c.textOffset={ref:{x:0,y:0},value:{x:0,y:0}};
    const pos=symbolTextPositions(c,getSymbol(c.symbolId));
    for(const field of ['ref','value'] as const){
      const width=Math.max(80,c[field].length*80),p=pos[field];
      for(let step=0;step<80;step++){
        const b={x:p.x-(p.anchor==='middle'?width/2:0),y:p.y-100-step*150,w:width,h:130};
        if(boxes.some(a=>a.x<b.x+b.w && b.x<a.x+a.w && a.y<b.y+b.h && b.y<a.y+a.h))continue;
        c.textOffset[field]={x:0,y:-step*150};boxes.push(b);if(step)movedTexts++;break;
      }
    }
  }
  assertElectricalIdentity(source,schematic);
  return {schematic,groups:groups.length,cleanedWires,movedTexts};
}
