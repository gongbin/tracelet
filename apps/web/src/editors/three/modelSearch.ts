import { footprintDef, type BoardFootprint, type Project } from '@tracelet/kernel';
import { MODEL_CATALOG, approximateCatalogKey } from './models.js';

/** Prefer an explicitly recorded manufacturer part number to a generic footprint name. */
export function modelSearchTerm(f: BoardFootprint, project: Project): string {
  const c = project.schematic.sheets.flatMap(s => s.components).find(c => c.id === f.componentId || c.ref === f.ref);
  const mpn = Object.entries(c?.props ?? {}).find(([k]) => /^(mpn|manufacturer[ _-]?part[ _-]?number|mfr[ ._-]*part[ _-]?(number|no)|型号|料号)$/i.test(k))?.[1];
  return mpn?.trim() || f.value?.trim() || f.footprintId.split(':').pop()!;
}
export function modelSearchLinks(query: string) {
  const q = encodeURIComponent(query.trim());
  return [
    { name: 'KiCad', url: `https://gitlab.com/kicad/libraries/kicad-packages3D/-/tree/master?search=${q}` },
    { name: 'SnapMagic', url: `https://www.snapeda.com/search/?q=${q}&search-type=parts` },
    { name: 'Component Search Engine', url: `https://componentsearchengine.com/search?term=${q}` },
    { name: 'manufacturer', url: `https://www.google.com/search?q=${encodeURIComponent(query.trim() + ' manufacturer STEP 3D model')}` }
  ];
}
/** Expose candidates without silently substituting them for a missing model. */
export function modelCandidates(f: BoardFootprint, filter = ''): string[] {
  const key = f.footprintId.split(':').pop()!, approx = approximateCatalogKey(key);
  const candidates = Object.keys(MODEL_CATALOG).filter(k => k.toLowerCase().includes(filter.toLowerCase()));
  return candidates.sort((a, b) => Number(b === key) - Number(a === key) || Number(b === approx) - Number(a === approx) || a.localeCompare(b));
}
export function padSpan(f: BoardFootprint): [number, number] {
  const pads = footprintDef(f).pads;
  if (!pads.length) return [0, 0];
  return [Math.max(...pads.map(p => p.x + p.w / 2)) - Math.min(...pads.map(p => p.x - p.w / 2)), Math.max(...pads.map(p => p.y + p.h / 2)) - Math.min(...pads.map(p => p.y - p.h / 2))];
}
