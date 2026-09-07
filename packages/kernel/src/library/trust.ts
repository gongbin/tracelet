import type { Project } from '../model/project.js';
import { footprintDef } from '../board/geometry.js';
import { getSymbol } from './symbols.js';
export function partTrustReport(project:Project) {
  const components=project.schematic.sheets.flatMap(s=>s.components);
  return project.board.footprints.map(f=>{
    const def=footprintDef(f), c=components.find(c=>c.id===f.componentId);
    const pins=c ? getSymbol(c.symbolId).pins.filter(p=>p.type!=='no_connect').map(p=>p.number) : [];
    const missingPins=pins.filter(pin=>!def.pads.some(p=>!p.npth && p.number===(c?.pinMap?.[pin] ?? (c?.pinMap ? '' : pin))));
    const targets=c?.pinMap ? Object.values(c.pinMap) : [];
    return {ref:f.ref,source:def.provenance?.source ?? '',verified:def.provenance?.verified ?? false,physicalBody:!!def.physicalBody,connector:def.connector,modelPlacement:def.modelPlacement,missingPins,ambiguousMapping:new Set(targets).size!==targets.length};
  });
}
