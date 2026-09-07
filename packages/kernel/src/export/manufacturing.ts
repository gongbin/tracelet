import type { Project } from '../model/project.js';
import { isAssemblyComponent } from './netlist.js';

/** Manufacturing XY is top-view, mm, Y up, for every layer and drill operation. */
export function manufacturingBoard(project: Project): Project['board'] {
  const { x, y } = project.settings.manufacturing?.origin ?? { x: 0, y: 0 };
  if (![x,y].every(Number.isFinite)) throw new Error('Invalid manufacturing origin');
  const shift = <T extends {x:number;y:number}>(p:T):T => ({...p,x:p.x-x,y:p.y-y});
  const b = project.board;
  return {...b, outline:b.outline.map(shift), footprints:b.footprints.map(shift), vias:b.vias.map(shift), texts:b.texts.map(shift), traces:b.traces.map(t=>({...t,points:t.points.map(shift)})), zones:b.zones.map(z=>({...z,polygon:z.polygon.map(shift)}))};
}

export interface AssemblyIssue { code: 'duplicate-ref'|'missing-placement'|'orphan-placement'|'identity-mismatch'|'invalid-coordinate'; refs:string[] }
export function validateAssembly(project: Project): AssemblyIssue[] {
  const all = project.schematic.sheets.flatMap(s=>s.components);
  const fitted = all.filter(c=>isAssemblyComponent(c,project));
  const out:AssemblyIssue[]=[];
  for(const refs of [all.map(c=>c.ref),project.board.footprints.map(f=>f.ref)]) {
    const duplicates=[...new Set(refs.filter((r,i)=>refs.indexOf(r)!==i))];
    if(duplicates.length) out.push({code:'duplicate-ref',refs:duplicates});
  }
  for(const c of fitted) {
    const matches=project.board.footprints.filter(f=>f.componentId ? f.componentId===c.id : f.ref===c.ref);
    if(matches.length!==1)out.push({code:'missing-placement',refs:[c.ref]});
  }
  for(const f of project.board.footprints) {
    const c=all.find(c=>f.componentId ? c.id===f.componentId : c.ref===f.ref);
    if(!c && f.componentId)out.push({code:'orphan-placement',refs:[f.ref]});
    if(c && (c.ref!==f.ref || (c.footprint && c.footprint!==f.footprintId)))out.push({code:'identity-mismatch',refs:[f.ref]});
    if(![f.x,f.y,f.rotation].every(Number.isFinite))out.push({code:'invalid-coordinate',refs:[f.ref]});
  }
  return out;
}
