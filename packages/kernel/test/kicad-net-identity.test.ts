import { describe, expect, it } from 'vitest';
import { importKicadSchematic, importKicadProject } from '../src/io/kicad.js';
import { buildNetlist, buildSchematicNetlist } from '../src/schematic/connectivity.js';
import { runErc, runSchematicErc } from '../src/schematic/erc.js';
import { pinGeoms } from '../src/schematic/geometry.js';
import { getSymbol } from '../src/library/symbols.js';
import { SheetSchema } from '../src/model/schematic.js';
import { syncBoardDetailed, diffBoardFromSchematic } from '../src/board/sync.js';
import { buildBom, exportNetlistJson } from '../src/export/netlist.js';
import { findFootprint } from '../src/library/footprints.js';

const pinSymbol = `(symbol "Test:Pin" (property "Reference" "U")
  (symbol "Pin_1_1" (pin output line (at 0 0 0) (length 2.54) (name "OUT") (number "1"))))`;
const instance = (ref = 'U1', x = 25.4, unit = 1, lib = 'Test:Pin') =>
  `(symbol (lib_id "${lib}") (at ${x} 25.4 0) (unit ${unit}) (property "Reference" "${ref}") (property "Value" "Part"))`;
const source = (labels = '', ref = 'U1') => `(kicad_sch (lib_symbols ${pinSymbol}) ${instance(ref)} ${labels})`;
const label = (name: string, kind = 'label', x = 25.4) => `(${kind} "${name}" (at ${x} 25.4 0))`;
const projectWith = (a: string, b: string) => importKicadProject({ schematics: [{ name: 'a', text: a }, { name: 'b', text: b }] }).project;
const groups = (project: ReturnType<typeof projectWith>) => buildSchematicNetlist(project.schematic).nets.map(n => n.pins.map(p => p.ref).sort());

describe('KiCad label scope and aliases', () => {
  it('keeps equal local labels on separate sheets electrically isolated, without output-conflict false positives', () => {
    const p = projectWith(source(label('DATA')), source(label('DATA'), 'U2'));
    expect(groups(p)).toEqual([['U1'], ['U2']]);
    const nl = buildSchematicNetlist(p.schematic);
    expect(new Set(nl.nets.map(n => n.name)).size).toBe(2);
    for (const net of nl.nets) for (const pin of net.pins) expect(nl.pinNet.get(`${pin.componentId}:${pin.pinNumber}`)).toBe(net.name);
    expect(runSchematicErc(p.schematic).items.filter(i => i.rule === 'output-conflict')).toHaveLength(0);
    expect(SheetSchema.parse(p.schematic.sheets[0]).labels[0].scope).toBe('local');
  });
  it('merges explicit global labels and retains true output conflicts', () => {
    const p = projectWith(source(label('DATA', 'global_label')), source(label('DATA', 'global_label'), 'U2'));
    expect(groups(p)).toEqual([['U1', 'U2']]);
    expect(runSchematicErc(p.schematic).items.filter(i => i.rule === 'output-conflict')).toHaveLength(1);
  });
  it('does not short a local label to an unrelated global label on another sheet', () => {
    const p = projectWith(source(label('DATA')), source(label('DATA', 'global_label'), 'U2'));
    expect(buildSchematicNetlist(p.schematic).nets).toHaveLength(2);
  });
  it('retains legacy cross-sheet label behavior when scope is omitted', () => {
    const p = projectWith(source(label('DATA')), source(label('DATA'), 'U2'));
    for (const s of p.schematic.sheets) delete s.labels[0].scope;
    expect(groups(p)).toEqual([['U1', 'U2']]);
  });
  it('warns on unsupported hierarchy instead of treating unrelated ports as global nets', () => {
    const a = importKicadSchematic(source(label('DATA', 'hierarchical_label')));
    expect(a.warnings.some(w => w.where === 'hierarchy')).toBe(true);
    expect(runErc(SheetSchema.parse(a.sheet)).items.some(i => i.rule === 'unresolved-hierarchy')).toBe(true);
    const p = projectWith(source(label('DATA', 'hierarchical_label')), source(label('DATA', 'hierarchical_label'), 'U2'));
    expect(buildSchematicNetlist(p.schematic).nets).toHaveLength(2);
  });
  it('unions every label alias, not only the alphabetically first label', () => {
    const { sheet } = importKicadSchematic(source(label('A') + label('B') + label('B', 'label', 50.8)));
    const second = importKicadSchematic(source('', 'U2')).sheet.components[0];
    second.x += 1000;
    sheet.components.push(second);
    const nl = buildNetlist(sheet);
    expect(nl.nets).toHaveLength(1);
    expect(nl.nets[0].pins.map(p => p.ref)).toEqual(['U1', 'U2']);
    expect(nl.pinNet.get(`${second.id}:1`)).toBe('A');
  });
  it('merges cross-sheet aliases transitively even when canonical local names differ', () => {
    const p = projectWith(source(label('A') + label('X', 'global_label') + label('Y', 'global_label')), source(label('B') + label('Y', 'global_label'), 'U2'));
    expect(groups(p)).toEqual([['U1', 'U2']]);
  });
  it('does not turn an imported label named GND into a power symbol', () => {
    const { sheet } = importKicadSchematic(source(label('GND')));
    expect(sheet.labels[0].kind).toBe('net');
  });
});

const dual = `(symbol "Test:Dual" (property "Reference" "U")
  (symbol "Dual_1_1" (pin output line (at 0 0 0) (length 2.54) (name "A") (number "1")))
  (symbol "Dual_2_1" (pin output line (at 0 0 0) (length 2.54) (name "B") (number "2"))))`;
describe('KiCad symbol and unit identity', () => {
  it('keeps existing geometry and pin types unchanged when a different project embeds the same library ID', () => {
    const a = importKicadSchematic(source());
    const original = structuredClone(getSymbol(a.sheet.components[0].symbolId));
    const endpoints = pinGeoms(a.sheet.components[0]);
    const b = importKicadSchematic(source().replace('(at 0 0 0)', '(at -5.08 0 0)').replace('pin output', 'pin input'));
    expect(a.symbols[0].id).not.toBe(b.symbols[0].id);
    expect(getSymbol(a.sheet.components[0].symbolId)).toEqual(original);
    expect(pinGeoms(a.sheet.components[0])).toEqual(endpoints);
    expect(importKicadSchematic(source()).symbols[0].id).toBe(a.symbols[0].id);
  });
  it('accepts distinct units of one package while still rejecting a duplicated unit', () => {
    const { sheet } = importKicadSchematic(`(kicad_sch (lib_symbols ${dual}) ${instance('U1', 25.4, 1, 'Test:Dual')} ${instance('U1', 50.8, 2, 'Test:Dual')})`);
    expect(runErc(SheetSchema.parse(sheet)).items.filter(i => i.rule === 'duplicate-ref')).toHaveLength(0);
    sheet.components.push({ ...sheet.components[0], id: 'duplicate', x: 5000 });
    expect(runErc(sheet).items.filter(i => i.rule === 'duplicate-ref')).toHaveLength(1);
  });
  it('rejects same-reference units with different values instead of hiding a physical package conflict', () => {
    const { sheet } = importKicadSchematic(`(kicad_sch (lib_symbols ${dual}) ${instance('U1', 25.4, 1, 'Test:Dual')} ${instance('U1', 50.8, 2, 'Test:Dual')})`);
    sheet.components[1].value = 'Different part';
    expect(runErc(sheet).items.some(i => i.rule === 'duplicate-ref')).toBe(true);
  });
  it('syncs one physical package with pins from every unit and counts it once in the BOM', () => {
    const text = `(kicad_sch (lib_symbols ${dual}) ${instance('U1', 25.4, 1, 'Test:Dual')} ${instance('U1', 50.8, 2, 'Test:Dual')} ${label('A')} ${label('B', 'label', 50.8)})`;
    const { project } = importKicadProject({ schematics: [{ name: 'dual', text }] });
    expect(diffBoardFromSchematic(project).added).toEqual(['U1']);
    const result = syncBoardDetailed(project);
    expect(result.board.footprints).toHaveLength(1);
    const fp = result.board.footprints[0];
    expect(fp.padNets).toEqual({ '1': 'A', '2': 'B' });
    expect(findFootprint(fp.footprintId)!.pads.map(p => p.number)).toEqual(['1', '2']);
    expect(buildBom(project).flatMap(row => row.refs)).toEqual(['U1']);
    expect(buildBom(project)[0].qty).toBe(1);
    project.board = result.board;
    // An older board may be associated with the second unit. Keep its placement.
    fp.componentId = project.schematic.sheets[0].components[1].id;
    fp.x = 42; fp.y = 43;
    expect(diffBoardFromSchematic(project).added).toEqual([]);
    expect(syncBoardDetailed(project).board.footprints[0]).toMatchObject({ id: fp.id, x: 42, y: 43 });
  });
  it('accepts a package split across sheets and preserves both unit connections during PCB sync', () => {
    const sheet = (unit: number) => `(kicad_sch (lib_symbols ${dual}) ${instance('U1', 25.4, unit, 'Test:Dual')} ${label('DATA')})`;
    const p = projectWith(sheet(1), sheet(2));
    expect(runSchematicErc(p.schematic).errors).toBe(0);
    const result = syncBoardDetailed(p);
    expect(result.board.footprints).toHaveLength(1);
    expect(result.board.footprints[0].padNets).toEqual({ '1': '/a/DATA', '2': '/b/DATA' });
  });
  it.each([false, true])('joins shared physical pins without output conflicts or duplicate netlist pins (across sheets: %s)', acrossSheets => {
    const shared = dual.replace('(property "Reference" "U")', '(property "Reference" "U") (symbol "Dual_0_1" (pin output line (at 0 2.54 0) (length 2.54) (name "SHARED") (number "3")))');
    const text = (unit: number) => `(kicad_sch (lib_symbols ${shared}) ${instance('U1', unit * 25.4, unit, 'Test:Dual')})`;
    const p = projectWith(text(1), text(2));
    if (!acrossSheets) { p.schematic.sheets[0].components.push(...p.schematic.sheets[1].components); p.schematic.sheets.pop(); }
    const units = p.schematic.sheets.flatMap(s => s.components);
    const pos = pinGeoms(units[0]).find(p => p.def.number === '3')!.end;
    p.schematic.sheets[0].labels.push({ id: 'shared', text: 'COMMON', scope: 'global', ...pos });
    const nl = buildSchematicNetlist(p.schematic);
    expect(nl.nets.find(n => n.name === 'COMMON')?.pins).toHaveLength(2);
    expect(nl.unconnectedPins.some(p => p.pinNumber === '3')).toBe(false);
    expect(runSchematicErc(p.schematic).items.some(i => i.rule === 'output-conflict')).toBe(false);
    expect(exportNetlistJson(p).nets.find(n => n.name === 'COMMON')?.pins).toEqual([{ ref: 'U1', pin: '3', name: 'SHARED' }]);
    expect(exportNetlistJson(p).components).toHaveLength(1);
  });
  it('does not merge nets whose generated names happen to match because references are duplicated', () => {
    const { sheet } = importKicadSchematic(`(kicad_sch (lib_symbols ${pinSymbol}) ${instance()} ${instance('U1', 50.8)}
      (wire (pts (xy 25.4 25.4) (xy 27.94 25.4))) (wire (pts (xy 50.8 25.4) (xy 53.34 25.4))))`);
    expect(buildNetlist(sheet).nets).toHaveLength(2);
    expect(runErc(sheet).items.filter(i => i.rule === 'duplicate-ref')).toHaveLength(1);
    expect(runErc(sheet).items.filter(i => i.rule === 'output-conflict')).toHaveLength(0);
  });
  it('applies no-connect intent to a shared physical pin but still catches a wired copy', () => {
    const shared = dual.replace('(property "Reference" "U")', '(property "Reference" "U") (symbol "Dual_0_1" (pin output line (at 0 2.54 0) (length 2.54) (name "SHARED") (number "3")))');
    const { sheet } = importKicadSchematic(`(kicad_sch (lib_symbols ${shared}) ${instance('U1', 25.4, 1, 'Test:Dual')} ${instance('U1', 50.8, 2, 'Test:Dual')})`);
    sheet.components[0].noConnectPins = ['3'];
    expect(buildNetlist(sheet).unconnectedPins.some(p => p.pinNumber === '3')).toBe(false);
    const pos = pinGeoms(sheet.components[1]).find(p => p.def.number === '3')!.end;
    sheet.labels.push({ id: 'connected', text: 'COMMON', ...pos });
    expect(runErc(sheet).items.some(i => i.rule === 'no-connect-connected')).toBe(true);
  });
});
