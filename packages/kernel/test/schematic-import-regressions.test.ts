import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { importKicadSchematic } from '../src/io/kicad.js';
import { parseSExpr, child, children, str, hasFlag } from '../src/io/sexpr.js';
import { buildNetlist } from '../src/schematic/connectivity.js';
import { runErc } from '../src/schematic/erc.js';
import { pinGeoms, snapComponentOrigin } from '../src/schematic/geometry.js';
import { SheetSchema } from '../src/model/schematic.js';
import { getSymbol } from '../src/library/symbols.js';
import { componentStrokes, pinDecoration, symbolTextPositions, netLabelLayout, netLabelBounds } from '../src/schematic/render.js';

const source = (extra = '', libExtra = '', instExtra = '') => `(kicad_sch
  (lib_symbols (symbol "Test:Pin" ${libExtra}
    (property "Reference" "U") (property "Value" "GND")
    (symbol "Pin_1_1" (pin passive line (at 0 0 0) (length 2.54) (name "P") (number "1")))))
  (symbol (lib_id "Test:Pin") (at 25.4 25.4 0) (unit 1) ${instExtra}
    (property "Reference" "U1") (property "Value" "GND")) ${extra})`;

describe('KiCad schematic compatibility', () => {
  it('understands legacy and modern boolean flags without treating no as true', () => {
    for (const v of ['(x hide)', '(x (hide))', '(x (hide yes))']) expect(hasFlag(parseSExpr(v), 'hide')).toBe(true);
    expect(hasFlag(parseSExpr('(x (hide no))'), 'hide')).toBe(false);
  });
  it('recognizes KiCad global power symbols and hidden pin numbers', () => {
    const r = importKicadSchematic(source('(wire (pts (xy 25.4 25.4) (xy 30.48 25.4)))', '(power global) (pin_numbers (hide yes))'));
    expect(r.symbols[0].power).toBe(true);
    expect(r.symbols[0].showPinNumbers).toBe(false);
    expect(r.sheet.components[0].ref).toBe('U1');
    expect(runErc(r.sheet).errors).toBe(0);
    expect(componentStrokes(r.sheet.components[0]).texts.some((t) => t.text === '1')).toBe(false);
  });
  it('preserves property placement, font sizes and visibility through serialization', () => {
    const text = source().replace('(property "Reference" "U1")', '(property "Reference" "U1" (at 30.48 20.32 0) (hide yes) (effects (font (size 1.27 1.27))))').replace('(property "Value" "GND"))', '(property "Value" "GND" (at 35.56 22.86 0) (effects (font (size 2.54 2.54)) (justify right))))');
    const r = importKicadSchematic(text); const c = SheetSchema.parse(r.sheet).components[0];
    expect(c.textStyle?.ref.hidden).toBe(true);
    expect(c.textStyle?.value.size).toBe(100);
    expect(symbolTextPositions(c, getSymbol(c.symbolId)).value).toEqual({ x: 1400, y: 935, anchor: 'end' });
    expect(componentStrokes(c).texts.some((t) => t.text === 'U1')).toBe(false);
  });
  it('retains clock/inversion decoration without changing electrical pin endpoints', () => {
    const r = importKicadSchematic(source().replace('pin passive line', 'pin passive inverted_clock'));
    const g = pinGeoms(r.sheet.components[0])[0];
    expect(g.end).toEqual({ x: 1000, y: 1000 });
    expect(pinDecoration(g).circles).toHaveLength(1);
    expect(pinDecoration(g).lines).toHaveLength(1);
  });
  it('retains explicit no-connect intent through serialization and reports contradictory wiring', () => {
    const r = importKicadSchematic(source('(no_connect (at 25.4 25.4))'));
    expect(SheetSchema.parse(r.sheet).components[0].noConnectPins).toEqual(['1']);
    expect(runErc(r.sheet).items).toEqual([]);
    r.sheet.wires.push({ id: 'w', points: [{ x: 1000, y: 1000 }, { x: 1200, y: 1000 }] });
    expect(runErc(r.sheet).items.some((i) => i.rule === 'no-connect-connected')).toBe(true);
  });
  it('preserves missing symbols as explicit errors rather than deleting components', () => {
    const r = importKicadSchematic(source().replace('(lib_id "Test:Pin")', '(lib_id "Missing:Part")'));
    expect(r.sheet.components).toHaveLength(1);
    expect(r.warnings).toHaveLength(1);
    expect(runErc(r.sheet).items.some((i) => i.rule === 'missing-symbol')).toBe(true);
  });
  it('does not strip the leading slash from a signal label', () => {
    const r = importKicadSchematic(source('(label "/RESET" (at 25.4 25.4 0))'));
    expect(buildNetlist(r.sheet).nets[0].name).toBe('/RESET');
  });
  it.each([0, 90, 180, 270])('retains label font size and alignment at %s degrees without moving its electrical anchor', angle => {
    const right = angle === 180 || angle === 270;
    const { sheet } = importKicadSchematic(source(`(global_label "USB_D+" (at 25.4 25.4 ${angle}) (effects (font (size 1.27 1.27)) (justify ${right ? 'right' : 'left'})))`));
    const label = SheetSchema.parse(sheet).labels[0], lay = netLabelLayout(sheet, label), bounds = netLabelBounds(label, lay);
    expect(label).toMatchObject({x:1000,y:1000,textStyle:{size:50,anchor:right?'end':'start',rotation:angle%180===0?0:-90}});
    expect(lay.text.size).toBe(50);
    expect(bounds.w).toBeGreaterThan(0); expect(bounds.h).toBeGreaterThan(0);
    if (angle === 180) expect(lay.text.x).toBeLessThan(label.x);
    if (angle === 0) expect(lay.text.x).toBeGreaterThan(label.x);
    if (angle === 90) expect(lay.text.y).toBeLessThan(label.y);
    if (angle === 270) expect(lay.text.y).toBeGreaterThan(label.y);
    expect(buildNetlist(sheet).pinNet.get(`${sheet.components[0].id}:1`)).toBe('USB_D+');
    expect(runErc(sheet).items.some(i=>i.rule==='dangling-label')).toBe(false);
  });
  it('snaps asymmetric imported symbols by a real pin at every rotation', () => {
    const r = importKicadSchematic(source()); const c = r.sheet.components[0], sym = getSymbol(c.symbolId);
    for (const rotation of [0, 90, 180, 270]) for (const mirror of [false, true]) {
      const origin = snapComponentOrigin(sym, { x: 1053, y: 984 }, rotation, mirror, 25);
      const end = pinGeoms({ ...c, ...origin, rotation, mirror })[0].end;
      expect(end.x / 25).toBeCloseTo(Math.round(end.x / 25));
      expect(end.y / 25).toBeCloseTo(Math.round(end.y / 25));
    }
  });
  it('connects T endpoints but not bare wire crossings', () => {
    const { sheet } = importKicadSchematic(source()); sheet.components = [];
    sheet.wires = [{ id: 'h', points: [{ x: 0, y: 100 }, { x: 200, y: 100 }] }, { id: 'v', points: [{ x: 100, y: 0 }, { x: 100, y: 200 }] }];
    sheet.labels = [{ id: 'a', text: 'A', x: 0, y: 100 }, { id: 'b', text: 'B', x: 100, y: 0 }];
    expect(buildNetlist(sheet).nets).toHaveLength(2);
    sheet.wires[1].points[1].y = 100;
    expect(buildNetlist(sheet).nets).toHaveLength(1);
  });
});

// Optional local verification: never commit private user schematics or generated netlists.
it.skipIf(!process.env.TRACELET_SCH_FIXTURE || !process.env.TRACELET_NET_FIXTURE)('matches independently exported KiCad multi-pin connectivity', () => {
  const { sheet } = importKicadSchematic(readFileSync(process.env.TRACELET_SCH_FIXTURE!, 'utf8'));
  const netlist = buildNetlist(sheet);
  const actual = netlist.nets.map((n) => n.pins.map((p) => `${p.ref}:${p.pinNumber}`).sort().join(','));
  const root = parseSExpr(readFileSync(process.env.TRACELET_NET_FIXTURE!, 'utf8'));
  const expected = children(child(root, 'nets')!, 'net').map((n) => children(n, 'node').map((p) => `${str(child(p, 'ref')?.[1])}:${str(child(p, 'pin')?.[1])}`).sort()).filter((pins) => pins.length > 1).map((pins) => pins.join(','));
  expect(expected.length).toBeGreaterThan(0);
  expect(actual.filter((pins) => pins.includes(',')).sort()).toEqual(expected.sort());
});
