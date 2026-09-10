import type { SchComponent } from '../model/schematic.js';

/** Only explicitly identified, distinct units can share a physical reference. */
export function isMultiUnitPackage(components: SchComponent[]): boolean {
  const first = components[0];
  return components.length > 1 && !!first.unit &&
    components.every(c => c.ref === first.ref && c.unit?.symbolId === first.unit!.symbolId &&
      c.value === first.value && c.footprint === first.footprint) &&
    new Set(components.map(c => c.unit!.number)).size === components.length;
}

/** Invalid duplicate references remain separate, so ERC and manufacturing can flag them. */
export function componentPackages(components: SchComponent[]): SchComponent[][] {
  const byRef = new Map<string, SchComponent[]>();
  for (const c of components) byRef.set(c.ref, [...(byRef.get(c.ref) ?? []), c]);
  return [...byRef.values()].flatMap(group => isMultiUnitPackage(group)
    ? [[...group].sort((a, b) => a.unit!.number - b.unit!.number)] : group.map(c => [c]));
}
