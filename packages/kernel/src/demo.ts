import { createProject, type Project } from './model/project.js';
import { ProjectEditor } from './history.js';
import { placeComponent, connectPins } from './commands/schematic.js';
import { syncFromSchematic, moveFootprint, addTrace, addBoardText, setOutlineRect, addZone, addVia } from './commands/board.js';
import { footprintPads } from './board/geometry.js';

/** 与设计稿一致的示例项目：ESP32 传感器板。 */
export function createDemoProject(): Project {
  const ed = new ProjectEditor(createProject({ name: 'ESP32 传感器板' }));
  const sheet = ed.project.schematic.sheets[0].id;
  const place = (symbolId: string, center: { x: number; y: number }, value?: string) => {
    const r = placeComponent(ed.project, { sheetId: sheet, symbolId, center, value });
    ed.dispatch(r.command);
    return r.id;
  };
  const U1 = place('sym:ESP32-WROOM-32E', { x: 3800, y: 2300 });
  const C1 = place('sym:C', { x: 5750, y: 1800 }, '10uF');
  const PWR1 = place('sym:PWR', { x: 5750, y: 870 }, '+3V3');
  const GND1 = place('sym:GND', { x: 5750, y: 2480 });
  const GND2 = place('sym:GND', { x: 6200, y: 3680 });
  const R1 = place('sym:R', { x: 1920, y: 3900 }, '330Ω');
  const D1 = place('sym:LED', { x: 2600, y: 4600 }, '红 0603');
  const GND3 = place('sym:GND', { x: 3500, y: 4980 });
  const wire = (a: string, ap: string, b: string, bp: string) => ed.dispatch(connectPins(sheet, { componentId: a, pin: ap }, { componentId: b, pin: bp }));
  wire(U1, '5', C1, '1');
  wire(PWR1, '1', C1, '1');
  wire(C1, '2', GND1, '1');
  wire(U1, '8', GND2, '1');
  wire(U1, '2', R1, '1');
  wire(R1, '2', D1, '1');
  wire(D1, '2', GND3, '1');

  ed.dispatch(setOutlineRect(50, 30));
  ed.dispatch(syncFromSchematic());
  const fpOf = (ref: string) => ed.project.board.footprints.find((f) => f.ref === ref)!;
  ed.dispatch(moveFootprint(fpOf('U1').id, { x: 16, y: 15 }));
  ed.dispatch(moveFootprint(fpOf('C1').id, { x: 28, y: 9 }));
  ed.dispatch(moveFootprint(fpOf('R1').id, { x: 30, y: 21 }));
  ed.dispatch(moveFootprint(fpOf('D1').id, { x: 36, y: 21 }));

  const pad = (ref: string, n: string) => footprintPads(fpOf(ref), ed.project.board).find((p) => p.number === n)!.center;
  const u5 = pad('U1', '5'), c1 = pad('C1', '1');
  ed.dispatch(addTrace({ layer: 'F.Cu', net: '+3V3', width: 0.5, points: [u5, { x: c1.x - 2, y: u5.y }, { x: c1.x, y: c1.y }] }).command);
  const u2 = pad('U1', '2'), r1 = pad('R1', '1');
  ed.dispatch(addTrace({ layer: 'F.Cu', net: 'Net-(R1-Pad1)', width: 0.25, points: [u2, { x: u2.x - 2, y: u2.y }, { x: u2.x - 2, y: 26 }, { x: r1.x - 1, y: 26 }, { x: r1.x, y: r1.y }] }).command);
  const r2 = pad('R1', '2'), d1 = pad('D1', '1');
  ed.dispatch(addTrace({ layer: 'F.Cu', net: 'Net-(D1-Pad1)', width: 0.25, points: [r2, { x: (r2.x + d1.x) / 2, y: r2.y }, d1] }).command);
  // GND：U1.8 → 过孔 → 底层铺铜
  const u8 = pad('U1', '8');
  ed.dispatch(addTrace({ layer: 'F.Cu', net: 'GND', width: 0.5, points: [u8, { x: u8.x + 1.5, y: u8.y }, { x: u8.x + 1.5, y: 17 }, { x: 40, y: 17 }] }).command);
  ed.dispatch(addVia({ x: 40, y: 17, size: 0.8, drill: 0.4, net: 'GND' }));
  ed.dispatch(addZone({ layer: 'B.Cu', net: 'GND', polygon: [{ x: 30, y: 16 }, { x: 48, y: 16 }, { x: 48, y: 28 }, { x: 30, y: 28 }] }));
  ed.dispatch(addBoardText({ layer: 'F.Silk', text: 'ESP32-SENSOR v3', x: 25, y: 28.5, size: 1 }));
  return ed.project;
}
