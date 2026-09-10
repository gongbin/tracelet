import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { BoardFootprintSchema, createProject, footprintPads, pointInPolygon, rectOutline, registerFootprints } from '@tracelet/kernel';
import { placeOnBoard, referencePosition, referenceText, surfaceText } from '../src/editors/three/labels';
import { disposeObject } from '../src/editors/three/models';
const def = { id: '3d:offset-body-label', name: 'Offset body', body: { x: 2, y: 3, w: 6, h: 4 }, height: 12, description: '', pads: [{ number: '1', x: 2, y: 3, w: 1, h: 1, shape: 'circle' as const, drill: 0, npth: false }] };
registerFootprints([def]);
function setup(side: 'F' | 'B' = 'F', rotation = 0) {
  const board = createProject({ name: 'Surface text' }).board; board.outline = rectOutline(0, 0, 40, 30);
  const f = BoardFootprintSchema.parse({ id: 'u1', ref: 'U1', footprintId: def.id, x: 20, y: 15, side, rotation });
  board.footprints = [f]; return { board, f };
}
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (text: string) => ({ width: text.length * 40, actualBoundingBoxLeft: 0, actualBoundingBoxRight: text.length * 40 }), fillText: vi.fn() } as unknown as CanvasRenderingContext2D);
});
afterEach(() => vi.restoreAllMocks());
describe('3D surface text', () => {
  it('renders reference ink on the board, independent of component height, with proper depth and face culling', () => {
    for (const side of ['F', 'B'] as const) {
      const { board, f } = setup(side, 30), before = JSON.stringify(board), mesh = referenceText(board, f, '#fff');
      mesh.updateMatrixWorld(true);
      expect(mesh).toBeInstanceOf(THREE.Mesh); expect(mesh).not.toBeInstanceOf(THREE.Sprite);
      const box = new THREE.Box3().setFromObject(mesh); expect(box.max.z - box.min.z).toBeLessThan(1e-6);
      expect(box.min.z).toBeCloseTo(side === 'F' ? board.thickness + .045 : -.045);
      const mat = mesh.material as THREE.MeshBasicMaterial; expect(mat.depthTest).toBe(true); expect(mat.depthWrite).toBe(false); expect(mat.side).toBe(THREE.FrontSide);
      const center = mesh.getWorldPosition(new THREE.Vector3()), normal = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion);
      expect(normal.z).toBeCloseTo(side === 'F' ? 1 : -1);
      const front = new THREE.Raycaster(center.clone().addScaledVector(normal, 5), normal.clone().negate());
      const back = new THREE.Raycaster(center.clone().addScaledVector(normal, -5), normal.clone());
      expect(front.intersectObject(mesh).length).toBeGreaterThan(0); expect(back.intersectObject(mesh)).toHaveLength(0);
      expect(JSON.stringify(board)).toBe(before); disposeObject(mesh);
    }
  });
  it('keeps model and text orientation aligned with kernel pad coordinates for both sides and arbitrary rotations', () => {
    for (const side of ['F', 'B'] as const) for (const angle of [0, 30, 90, 180, 270]) {
      const { board, f } = setup(side, angle), root = new THREE.Group();
      placeOnBoard(root, board, f, side, angle, .015); root.updateMatrixWorld(true);
      const pad = footprintPads(f, board)[0], actual = root.localToWorld(new THREE.Vector3(def.pads[0].x, -def.pads[0].y, 0));
      expect(actual.x).toBeCloseTo(pad.center.x - 20); expect(actual.y).toBeCloseTo(15 - pad.center.y);
      const label = referenceText(board, f, '#fff');
      expect(label.quaternion.angleTo(root.quaternion)).toBeLessThan(1e-6);
      disposeObject(label);
    }
  });
  it('places references outside the offset body and chooses another side near a board edge', () => {
    const { board, f } = setup();
    const at = referencePosition(board, f, 2, 1); expect(at).toEqual({ x: 22, y: 15.25 });
    f.y = -.5; const edge = referencePosition(board, f, 2, 1);
    for (const x of [-1, 1]) for (const y of [-.5, .5]) expect(pointInPolygon({ x: edge.x + x, y: edge.y + y }, board.outline)).toBe(true);
    expect(edge.y).toBeGreaterThan(f.y + def.body.y + def.body.h / 2);
  });
  it('measures long and Unicode text without clipping and keeps board text flat on its chosen side', () => {
    const { board } = setup();
    const short = surfaceText('U1', '#fff', 1), long = surfaceText('电源 / POWER SUPPLY', '#fff', 1);
    expect(long.geometry.parameters.width).toBeGreaterThan(short.geometry.parameters.width * 4);
    placeOnBoard(long, board, { x: 10, y: 10 }, 'B'); long.updateMatrixWorld(true);
    expect(long.getWorldDirection(new THREE.Vector3()).z).toBeCloseTo(-1); expect(long.position.z).toBeCloseTo(-.045);
    disposeObject(short); disposeObject(long);
  });
});
