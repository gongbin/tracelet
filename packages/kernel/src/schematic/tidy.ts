import type { Schematic, Sheet } from '../model/schematic.js';
import { buildSchematicNetlist } from './connectivity.js';
import { componentBounds, componentBody, pinGeoms } from './geometry.js';
import { symbolTextPositions, netLabelLayout, netLabelBounds } from './render.js';
import { getSymbol } from '../library/symbols.js';
import { pointOnSeg, rectsOverlap, segRectDist, UnionFind, type Vec, type Rect } from '../geometry.js';
import { paperSize } from '../model/schematic.js';

const textWidth = (text: string, size: number) => [...text].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 1 : 0.62) * size, 0);
const textBox = (text: string, size: number, pos: { x: number; y: number; anchor: 'start' | 'middle' | 'end' }): Rect => {
  const w = Math.max(size / 2, textWidth(text, size));
  return { x: pos.x - (pos.anchor === 'middle' ? w / 2 : pos.anchor === 'end' ? w : 0) - 8, y: pos.y - size * 0.85 - 8, w: w + 16, h: size + 16 };
};

/** Move only colliding visible annotations. Keep imported positions, sizes and hidden fields. */
function arrangeTexts(sheet: Sheet): number {
  const fixed: Rect[] = [];
  for (const l of sheet.labels) fixed.push(netLabelBounds(l, netLabelLayout(sheet, l)));
  for (const g of sheet.graphics) if (g.kind === 'text') fixed.push(textBox(g.text, g.size, { ...g, anchor: 'start' }));
  const segments = [...sheet.wires.flatMap(w => w.points.slice(1).map((b, i) => ({ a: w.points[i], b }))),
    ...sheet.components.flatMap(c => pinGeoms(c).filter(p => !p.def.hidden).map(p => ({ a: p.end, b: p.base })))];
  const annotations = sheet.components.flatMap(c => {
    const sym = getSymbol(c.symbolId), pos = symbolTextPositions(c, sym);
    return (['ref', 'value'] as const).filter(field => !(field === 'ref' && sym.power) && !c.textStyle?.[field].hidden).map(field => {
      const size = c.textStyle?.[field].size ?? (field === 'ref' ? 120 : sym.power ? 100 : 110);
      return { c, field, size, pos: pos[field], box: textBox(c[field], size, pos[field]) };
    });
  });
  const bodies = sheet.components.map(c => ({ id: c.id, box: componentBody(c) }));
  const page = paperSize(sheet.frame);
  let moved = 0;
  for (const item of annotations) {
    const own = getSymbol(item.c.symbolId);
    const blocked = (box: Rect) => fixed.some(b => rectsOverlap(b, box)) || annotations.some(other => other !== item && rectsOverlap(other.box, box)) ||
      bodies.some(b => !(b.id === item.c.id && item.field === 'value' && own.graphic === 'box' && own.width >= 1000) && rectsOverlap(b.box, box)) ||
      segments.some(s => segRectDist(s.a, s.b, box) < 15);
    if (!blocked(item.box)) continue;
    const original = item.box;
    const step = Math.max(100, Math.ceil(item.size * 1.5 / 50) * 50);
    let found = false;
    // Nearby positions first; prevent a dense area from scattering labels far away.
    for (let radius = 1; radius <= 12 && !found; radius++) {
      const offsets = [[0, -radius], [0, radius], [radius, 0], [-radius, 0], [radius, -radius], [-radius, -radius], [radius, radius], [-radius, radius]];
      for (const [x, y] of offsets) {
        const dx = x * step, dy = y * step, box = { ...original, x: original.x + dx, y: original.y + dy };
        if (page && (box.x < 220 || box.y < 220 || box.x + box.w > page.w - 220 || box.y + box.h > page.h - 220)) continue;
        if (blocked(box)) continue;
        const old = item.c.textOffset ?? { ref: { x: 0, y: 0 }, value: { x: 0, y: 0 } };
        item.c.textOffset = { ...old, [item.field]: { x: old[item.field].x + dx, y: old[item.field].y + dy } };
        item.box = box; moved++; found = true; break;
      }
    }
  }
  return moved;
}

/** Annotation-only cleanup preserves component and wire positions exactly. */
export function tidySchematicTexts(source: Schematic, sheetId: string): { schematic: Schematic; movedTexts: number } {
  const schematic = structuredClone(source), sheet = schematic.sheets.find(s => s.id === sheetId);
  if (!sheet) throw new Error('Unknown sheet');
  const movedTexts = arrangeTexts(sheet);
  assertElectricalIdentity(source, schematic);
  return { schematic, movedTexts };
}

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
    const right = (paperSize(sheet.frame)?.w ?? 10700) - 700;
    for(const ids of groups){
      const set=new Set(ids), points:Vec[]=[];
      for(const id of ids)points.push(...nodes.get(id)!);
      for(const c of sheet.components.filter(c=>set.has(c.id))){const b=componentBounds(c);points.push({x:b.x-200,y:b.y-200},{x:b.x+b.w+Math.max(c.value.length,c.ref.length)*80+250,y:b.y+b.h+250});}
      for(const l of sheet.labels.filter(l=>set.has(l.id)))points.push({x:l.x+l.text.length*80+100,y:l.y-200});
      if(!points.length)continue;
      const minX=Math.min(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y));
      const w=Math.max(...points.map(p=>p.x))-minX,h=Math.max(...points.map(p=>p.y))-minY;
      if(x>700 && x+w>right){x=700;y+=rowH+600;rowH=0;}
      const dx=x-minX,dy=y-minY; const move=(p:Vec)=>{p.x+=dx;p.y+=dy;};
      for(const c of sheet.components)if(set.has(c.id))move(c);
      for(const w of sheet.wires)if(set.has(w.id))w.points.forEach(move);
      for(const p of [...sheet.labels,...sheet.junctions])if(set.has(p.id))move(p);
      x+=w+600;rowH=Math.max(rowH,h);
    }
  }
  // Remove redundant collinear vertices only if the full netlist stays identical.
  let cleanedWires=0;
  const identity = electricalIdentity(source);
  for(const w of sheet.wires){
    const old=w.points;
    w.points=old.filter((p,i)=>i===0||i===old.length-1||!pointOnSeg(p,old[i-1],old[i+1],1e-7));
    if(w.points.length<2 || identity!==electricalIdentity(schematic))w.points=old;
    else if(w.points.length!==old.length)cleanedWires++;
  }
  const movedTexts = arrangeTexts(sheet);
  assertElectricalIdentity(source,schematic);
  return {schematic,groups:groups.length,cleanedWires,movedTexts};
}
