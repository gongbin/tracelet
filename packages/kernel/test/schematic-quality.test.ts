import { describe, expect, it } from 'vitest';
import { createProject, ProjectEditor, sch, buildSchematicNetlist, electricalIdentity, getSymbol, importKicadSchematic, pinGeoms, runErc, tidySchematicTexts, type SchComponent } from '../src/index.js';

const resistor = (id = 'r1', x = 1000, y = 1000): SchComponent => ({ id, ref: id.toUpperCase(), symbolId: 'sym:R', value: '10k', footprint: '', x, y, rotation: 0, mirror: false, props: {} });
const fixture = () => { const p = createProject({ name: 'Schematic quality' }); const s = p.schematic.sheets[0]; s.frame.size = 'none'; s.components = [resistor()]; return { p, s, pins: pinGeoms(s.components[0]) }; };
const errors = (s: ReturnType<typeof fixture>['s'], rule: string) => runErc(s).items.filter(i => i.rule === rule);

describe('safe label editing', () => {
  it('keeps identity and scope through repeated dragging, renaming and undo', () => {
    const { p, s } = fixture();
    s.labels = [{ id: 'l1', text: 'DATA', x: 700, y: 700, kind: 'net', scope: 'local' }];
    const e = new ProjectEditor(p); e.begin('Drag label');
    e.dispatch(sch.updateLabel(s.id, 'l1', { x: 800 }));
    e.dispatch(sch.updateLabel(s.id, 'l1', { x: 900, y: 800 })); e.commit();
    e.dispatch(sch.updateLabel(s.id, 'l1', { text: 'DATA2' }));
    expect(e.project.schematic.sheets[0].labels).toEqual([{ ...s.labels[0], x: 900, y: 800, text: 'DATA2' }]);
    e.undo(); expect(e.project.schematic.sheets[0].labels[0].text).toBe('DATA');
    e.undo(); expect(e.project.schematic.sheets[0].labels).toEqual(s.labels);
  });
});

describe('precise electrical diagnostics', () => {
  it('reports the free end of a pin wire once, at its actual location', () => {
    const { s, pins } = fixture(); const end = { x: pins[0].end.x + 500, y: pins[0].end.y };
    s.wires = [{ id: 'w1', points: [pins[0].end, end] }];
    expect(errors(s, 'dangling-wire')).toMatchObject([{ location: end, objectIds: ['w1'], sheetId: s.id }]);
    expect(errors(s, 'single-pin-net')).toHaveLength(0);
  });
  it('does not flag attached pin labels, wire labels, T junctions or bus entries as dangling', () => {
    const { s, pins } = fixture(); const a = pins[0].end;
    s.wires = [{ id: 'w1', points: [a, { x: a.x + 1000, y: a.y }] }, { id: 'w2', points: [{ x: a.x + 500, y: a.y }, { x: a.x + 500, y: a.y - 500 }] }];
    s.buses = [{ id: 'b', points: [{ x: a.x + 400, y: a.y - 500 }, { x: a.x + 700, y: a.y - 500 }] }];
    s.labels = [{ id: 'l1', text: 'DATA', scope: 'local', ...a }, { id: 'l2', text: 'DATA', scope: 'local', x: a.x + 1000, y: a.y }];
    expect(errors(s, 'dangling-wire')).toHaveLength(0);
    expect(errors(s, 'dangling-label')).toHaveLength(0);
    // The branch has an explicit signal name anywhere on its own polyline.
    s.labels.push({ id: 'l3', text: 'DATA', scope: 'local', x: a.x + 500, y: a.y - 250 });
    expect(errors(s, 'bus-entry-unnamed')).toHaveLength(0);
    s.labels.pop(); expect(errors(s, 'bus-entry-unnamed')).toHaveLength(1);
  });
  it.each([10, 0.2])('distinguishes a label offset by %s mil from an electrical connection', offset => {
    const { s, pins } = fixture();
    s.labels = [{ id: 'l1', text: 'DATA', scope: 'local', x: pins[0].end.x, y: pins[0].end.y + offset }];
    expect(errors(s, 'dangling-label')).toMatchObject([{ objectIds: ['l1'], refs: ['DATA'] }]);
    expect(errors(s, 'unconnected-pin')).toHaveLength(2);
    s.labels[0].y = pins[0].end.y;
    expect(errors(s, 'dangling-label')).toHaveLength(0);
    expect(errors(s, 'unconnected-pin')).toHaveLength(1);
  });
  it('remaps every branch to the resolved local/global net across sheets without joining bare crossings', () => {
    const { p, s, pins } = fixture(); const a = pins[0].end;
    s.wires = [{ id: 'w1', points: [a, { x: a.x + 1000, y: a.y }] }, { id: 'branch', points: [{ x: a.x + 500, y: a.y }, { x: a.x + 500, y: a.y + 500 }] }, { id: 'cross', points: [{ x: a.x + 750, y: a.y - 500 }, { x: a.x + 750, y: a.y + 500 }] }];
    s.labels = [{ id: 'l1', text: 'LOCAL', scope: 'local', ...a }, { id: 'global', text: 'DATA', scope: 'global', ...a }, { id: 'cross-label', text: 'OTHER', scope: 'local', x: a.x + 750, y: a.y - 500 }];
    const s2 = structuredClone(s); s2.id = 's2'; s2.name = 'second'; s2.components = [resistor('r2')]; s2.labels = [{ id: 'l2', text: 'DATA', scope: 'global', ...a }]; s2.wires = [{ id: 'secondwire', points: [a, { x: a.x + 1000, y: a.y }] }]; p.schematic.sheets.push(s2);
    const nl = buildSchematicNetlist(p.schematic), net = nl.pinNet.get('r1:1');
    expect(nl.pinNet.get('r2:1')).toBe(net);
    expect(nl.wireNet?.get(`${s.id}:branch`)).toBe(net);
    expect(nl.wireNet?.get('s2:secondwire')).toBe(net);
    expect(nl.wireNet?.get(`${s.id}:cross`)).not.toBe(net);
  });
});

describe('symbol inheritance import', () => {
  const base = '(symbol "Base" (pin_names hide) (pin_numbers hide) (property "Reference" "U") (symbol "Base_1_1" (pin input line (at -2.54 0 0) (length 2.54) (name "IN") (number "1"))))';
  const imp = (defs: string) => importKicadSchematic(`(kicad_sch (lib_symbols ${defs}) (symbol (lib_id "Child") (at 25.4 25.4 0) (unit 1) (property "Reference" "U1")))`);
  it('resolves a reversed multi-level inheritance chain and explicit visibility overrides', () => {
    const r = imp(`(symbol "Child" (extends "Middle") (pin_names (hide no)) (pin_numbers (hide no))) (symbol "Middle" (extends "Base")) ${base}`);
    expect(r.warnings).toEqual([]);
    const c = r.sheet.components[0], sym = getSymbol(c.symbolId);
    expect(pinGeoms(c)).toMatchObject([{ end: { x: 900, y: 1000 }, def: { number: '1', type: 'input' } }]);
    expect(sym.showPinNames).toBe(true); expect(sym.showPinNumbers).toBe(true);
  });
  it.each(['(symbol "Child" (extends "Missing"))', '(symbol "Child" (extends "Middle")) (symbol "Middle" (extends "Child"))'])('retains unresolved instances and reports their actual missing pin definition', defs => {
    const r = imp(defs);
    expect(r.sheet.components).toHaveLength(1);
    expect(r.sheet.components[0].props.unresolvedSymbol).toMatch(/Missing parent|Cyclic/);
    expect(errors(r.sheet, 'missing-symbol')).toHaveLength(1);
    expect(pinGeoms(r.sheet.components[0])).toEqual([]);
  });
});

describe('annotation cleanup', () => {
  it('moves colliding text while preserving geometry, hidden fields, text size, source and electrical identity', () => {
    const { p, s, pins } = fixture();
    const c = s.components[0]; c.textOffset = { ref: { x: -200, y: 20 }, value: { x: 0, y: 0 } };
    c.textStyle = { ref: { size: 90, hidden: false, anchor: 'start' }, value: { size: 80, hidden: true, anchor: 'start' } };
    s.wires = [{ id: 'w1', points: [pins[0].end, { x: pins[0].end.x + 600, y: pins[0].end.y }] }];
    const original = JSON.stringify(p.schematic), result = tidySchematicTexts(p.schematic, s.id), next = result.schematic.sheets[0];
    expect(result.movedTexts).toBeGreaterThan(0);
    expect(next.components[0]).toMatchObject({ x: c.x, y: c.y, rotation: c.rotation, textStyle: c.textStyle });
    expect(next.components[0].textOffset?.value).toEqual(c.textOffset.value);
    expect(next.wires).toEqual(s.wires);
    expect(electricalIdentity(result.schematic)).toBe(electricalIdentity(p.schematic));
    expect(JSON.stringify(p.schematic)).toBe(original);
    expect(tidySchematicTexts(result.schematic, s.id).movedTexts).toBe(0);
  });
  it('preserves an already legible imported annotation position', () => {
    const { p, s } = fixture();
    s.components[0].textOffset = { ref: { x: 1800, y: -800 }, value: { x: 1800, y: -800 } };
    const result = tidySchematicTexts(p.schematic, s.id);
    expect(result.movedTexts).toBe(0);
    expect(result.schematic).toEqual(p.schematic);
  });
});
