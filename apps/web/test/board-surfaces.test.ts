import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BoardFootprintSchema, createProject, footprintPads, registerFootprints, rectOutline, holeFootprint, castellatedFootprint, type Board, type ZoneFill } from '@tracelet/kernel';
import { buildBoardSurfaces, DEFAULT_SURFACES, surfacePalette } from '../src/editors/three/surfaces';
import { disposeObject, needsModel } from '../src/editors/three/models';
function fixture() {
  const board = createProject({ name: '3D geometry' }).board;
  Object.assign(board, { outline: rectOutline(0, 0, 30, 20), footprints: [], traces: [], vias: [], zones: [], texts: [], hiddenLayers: [] });
  return board;
}
const meshes = (g: THREE.Group, kind: string) => g.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh && o.userData.kind === kind);
function hit(board: Board, g: THREE.Group, x: number, y: number, below = false, kind?: string) {
  g.updateMatrixWorld(true);
  const r = new THREE.Raycaster(new THREE.Vector3(x - 15, 10 - y, below ? -10 : board.thickness + 10), new THREE.Vector3(0, 0, below ? 1 : -1));
  return r.intersectObjects(kind ? meshes(g, kind) : g.children, true);
}
function fill(layer: 'F.Cu' | 'B.Cu'): ZoneFill {
  const polygon = rectOutline(1, 1, 28, 18);
  return { zone: { id: layer, net: 'GND', layer, polygon, thermal: 'solid', thermalGap: .3, spokeWidth: .4, clearance: .2 }, polygons: [[polygon]] };
}
describe('3D copper surfaces', () => {
  it('renders pours under the mask on BOTH sides, with independently visible and colored traces', () => {
    const board = fixture(); board.traces = [{ id: 't', layer: 'F.Cu', width: .127, net: 'SIG', points: [{ x: 5, y: 5 }, { x: 20, y: 5 }] }];
    const before = JSON.stringify(board), g = buildBoardSurfaces(board, [fill('F.Cu'), fill('B.Cu')], DEFAULT_SURFACES);
    expect(hit(board, g, 10, 10, false, 'zone')).toHaveLength(2);
    expect(hit(board, g, 10, 10, true, 'zone')).toHaveLength(2);
    const trace = meshes(g, 'trace')[0], zone = meshes(g, 'zone')[0];
    expect((trace.material as THREE.MeshStandardMaterial).color.getHexString()).not.toBe((zone.material as THREE.MeshStandardMaterial).color.getHexString());
    const tracesOff = buildBoardSurfaces(board, [fill('F.Cu')], { ...DEFAULT_SURFACES, traces: false });
    expect(meshes(tracesOff, 'trace')).toHaveLength(0); expect(meshes(tracesOff, 'zone')).toHaveLength(1);
    const zonesOff = buildBoardSurfaces(board, [fill('F.Cu')], { ...DEFAULT_SURFACES, zones: false });
    expect(meshes(zonesOff, 'zone')).toHaveLength(0); expect(meshes(zonesOff, 'trace')).toHaveLength(1);
    expect(JSON.stringify(board)).toBe(before); [g, tracesOff, zonesOff].forEach(disposeObject);
  });
  it('preserves 0.127 mm copper width, round endpoints and connected corners', () => {
    const board = fixture(); board.traces = [{ id: 't', layer: 'F.Cu', width: .127, net: 'SIG', points: [{ x: 5, y: 5 }, { x: 10, y: 5 }, { x: 10, y: 10 }] }];
    const g = buildBoardSurfaces(board, [], DEFAULT_SURFACES);
    expect(hit(board, g, 7, 5 + .127 / 2 - .001, false, 'trace').length).toBeGreaterThan(0);
    expect(hit(board, g, 7, 5 + .127 / 2 + .001, false, 'trace')).toHaveLength(0);
    expect(hit(board, g, 5 - .06, 5, false, 'trace').length).toBeGreaterThan(0);
    expect(hit(board, g, 10.04, 4.96, false, 'trace').length).toBeGreaterThan(0);
    disposeObject(g);
  });
  it('opens plated and unplated holes through board, pads, zones and crossing traces', () => {
    const board = fixture();
    for (const [i, plated] of [true, false].entries()) {
      const def = holeFootprint(3.2, plated, .5); registerFootprints([def]);
      const f = BoardFootprintSchema.parse({ id: `f${i}`, ref: `H${i}`, footprintId: def.id, x: 10 + i * 10, y: 10 });
      board.footprints.push(f); expect(needsModel(f)).toBe(false);
    }
    board.traces = [{ id: 't', layer: 'F.Cu', width: .5, net: 'SIG', points: [{ x: 5, y: 10 }, { x: 25, y: 10 }] }];
    const g = buildBoardSurfaces(board, [fill('F.Cu'), fill('B.Cu')], DEFAULT_SURFACES);
    for (const x of [10, 20]) { expect(hit(board, g, x, 10)).toHaveLength(0); expect(hit(board, g, x, 10, true)).toHaveLength(0); }
    expect(hit(board, g, 11.8, 10, false, 'pad').length).toBeGreaterThan(0);
    expect(hit(board, g, 21.8, 10, false, 'pad')).toHaveLength(0);
    expect(meshes(g, 'barrel')).toHaveLength(1); disposeObject(g);
  });
  it('keeps half-holes open at the board edge without off-board copper or placeholder bodies', () => {
    const board = fixture(), def = castellatedFootprint(1, .4, 3, 2.4); registerFootprints([def]);
    const f = BoardFootprintSchema.parse({ id: 'cast', ref: 'CAST1', footprintId: def.id, x: 15, y: 0 }); board.footprints.push(f);
    expect(needsModel(f)).toBe(false);
    const g = buildBoardSurfaces(board, [], DEFAULT_SURFACES);
    for (const x of [12.6, 15, 17.4]) { expect(hit(board, g, x, .2)).toHaveLength(0); expect(hit(board, g, x, -.2)).toHaveLength(0); expect(hit(board, g, x, .7, false, 'pad').length).toBeGreaterThan(0); }
    const box = new THREE.Box3().setFromObject(g); expect(box.max.y).toBeLessThanOrEqual(10.00001); disposeObject(g);
  });
  it('uses the oriented oval outline for top and bottom pads, including rotation', () => {
    const board = fixture(), def = { ...holeFootprint(1, true, .4), id: '3d:oval', pads: [{ number: '1', x: 0, y: 0, w: 4, h: 2, shape: 'oval' as const, drill: 0, npth: false }] }; registerFootprints([def]);
    for (const side of ['F', 'B'] as const) {
      const f = BoardFootprintSchema.parse({ id: 'oval', ref: 'J1', footprintId: def.id, x: 15, y: 10, rotation: 90, side }); board.footprints = [f];
      const g = buildBoardSurfaces(board, [], DEFAULT_SURFACES), pad = meshes(g, 'pad')[0];
      const size = new THREE.Box3().setFromObject(pad).getSize(new THREE.Vector3()); expect(size.x).toBeCloseTo(2); expect(size.y).toBeCloseTo(4);
      expect(hit(board, g, 15, 11.9, side === 'B', 'pad').length).toBeGreaterThan(0);
      expect(hit(board, g, 15.9, 11.9, side === 'B', 'pad')).toHaveLength(0);
      expect(footprintPads(f, board)[0].center).toEqual({ x: 15, y: 10 }); disposeObject(g);
    }
  });
  it('uses actual inner depths and backdrilling; blind holes do not punch through the opposite face', () => {
    const board = fixture(); board.copperCount = 4; board.thickness = 1.6; board.stackup = { ...board.stackup!, copperDepths: [0, .2, 1.3, 1.6] };
    board.vias = [{ id: 'blind', x: 10, y: 10, drill: .3, size: .6, net: 'SIG', startLayer: 'F.Cu', endLayer: 'In1.Cu' }, { id: 'backdrill', x: 20, y: 10, drill: .3, size: .6, net: 'SIG', backdrill: { side: 'F', stopLayer: 'In2.Cu', diameter: .8, stub: .1 } }];
    const g = buildBoardSurfaces(board, [], { ...DEFAULT_SURFACES, copper: true });
    const blindBottom = hit(board, g, 10, 10, true)[0]; expect(blindBottom.point.z).toBeCloseTo(0);
    const blindTop = hit(board, g, 10, 10)[0]; expect(blindTop.point.z).toBeCloseTo(1.4);
    expect(hit(board, g, 20, 10)).toHaveLength(0);
    const inner = meshes(g, 'via').find(m => m.userData.id === 'blind' && m.userData.layer === 'In1.Cu')!; expect(inner.position.z).toBeCloseTo(1.4);
    const bd = meshes(g, 'barrel').find(m => m.userData.id === 'backdrill')!; expect(bd.userData.depthStart).toBeCloseTo(1.2);
    expect(meshes(g, 'via').filter(m => m.userData.id === 'backdrill').map(m => m.userData.layer)).toEqual(['In2.Cu', 'B.Cu']); disposeObject(g);
  });
  it('honors project finish and mask color while keeping inspection preferences independent', () => {
    const board = fixture(); board.stackup = { ...board.stackup!, maskColor: '红', finish: 'ENIG' };
    const real = surfacePalette(board, { ...DEFAULT_SURFACES, mode: 'realistic' });
    expect(real.trace.r).toBeGreaterThan(real.trace.g); expect(real.zone.r).toBeGreaterThan(real.zone.g);
    expect(real.pad.getHexString()).toBe('d9b65f');
    board.stackup.finish = 'OSP'; expect(surfacePalette(board, DEFAULT_SURFACES).pad.getHexString()).toBe('bd7949');
    board.hiddenLayers = ['F.Cu']; const g = buildBoardSurfaces(board, [fill('F.Cu'), fill('B.Cu')], DEFAULT_SURFACES);
    expect(meshes(g, 'zone').map(m => m.userData.layer)).toEqual(['B.Cu']); disposeObject(g);
  });
});
