import * as THREE from 'three';
import { boardBounds, footprintBody, footprintDef, pointInPolygon, polygonBounds, rotate, type Board, type BoardFootprint, type Vec } from '@tracelet/kernel';

const TEXT_Z = .045;

/** Flat, single-sided ink. Unlike a Sprite, this has no camera-facing transform. */
export function surfaceText(text: string, color: string, size: number): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')!;
  const font = '64px "JetBrains Mono", monospace';
  ctx.font = font;
  const measured = ctx.measureText(text), padding = 8;
  canvas.width = Math.max(1, Math.ceil(Math.max(measured.width, (measured.actualBoundingBoxLeft ?? 0) + (measured.actualBoundingBoxRight ?? 0))) + padding * 2);
  canvas.height = 96;
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: .05, depthTest: true, depthWrite: false, side: THREE.FrontSide, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(canvas.width / 64 * size, canvas.height / 64 * size), material);
  mesh.userData = { kind: 'surface-text', text };
  return mesh;
}

/** Mirror the local X axis on the bottom, THEN rotate, matching the kernel's pad transform. */
export function placeOnBoard(object: THREE.Object3D, board: Board, at: Vec, side: 'F' | 'B', rotation = 0, offset = TEXT_Z): void {
  const b = boardBounds(board);
  object.position.set(at.x - b.x - b.w / 2, b.y + b.h / 2 - at.y, side === 'F' ? board.thickness + offset : -offset);
  object.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -rotation * Math.PI / 180);
  if (side === 'B') object.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
}

/** Put references next to the footprint, considering its origin offset, pads and board edge. */
export function referencePosition(board: Board, fp: BoardFootprint, width: number, height: number): Vec {
  const def = footprintDef(fp), body = def.physicalBody ?? def.body;
  let x1 = (body.x ?? 0) - body.w / 2, x2 = x1 + body.w, y1 = (body.y ?? 0) - body.h / 2, y2 = y1 + body.h;
  for (const pad of def.pads) {
    x1 = Math.min(x1, pad.x - pad.w / 2); x2 = Math.max(x2, pad.x + pad.w / 2);
    y1 = Math.min(y1, pad.y - pad.h / 2); y2 = Math.max(y2, pad.y + pad.h / 2);
  }
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, gap = .25;
  const candidates = [{ x: cx, y: y1 - height / 2 - gap }, { x: cx, y: y2 + height / 2 + gap }, { x: x2 + width / 2 + gap, y: cy }, { x: x1 - width / 2 - gap, y: cy }];
  const toBoard = (p: Vec) => { const r = rotate({ x: fp.side === 'B' ? -p.x : p.x, y: p.y }, fp.rotation); return { x: fp.x + r.x, y: fp.y + r.y }; };
  const obstacles = board.footprints.filter(f => f.id !== fp.id && f.side === fp.side).map(footprintBody);
  const score = (p: Vec) => {
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => toBoard({ x: p.x + x * width / 2, y: p.y + y * height / 2 }));
    const samples = [...corners, toBoard(p), ...corners.map((c, i) => ({ x: (c.x + corners[(i + 1) % 4].x) / 2, y: (c.y + corners[(i + 1) % 4].y) / 2 }))];
    const r = polygonBounds(corners);
    const overlap = obstacles.reduce((sum, o) => sum + Math.max(0, Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x)) * Math.max(0, Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y)), 0);
    return samples.filter(c => !pointInPolygon(c, board.outline)).length * 10000 + overlap;
  };
  let best = candidates[0], bestScore = score(best);
  for (const candidate of candidates.slice(1)) { const s = score(candidate); if (s < bestScore) { best = candidate; bestScore = s; } }
  return toBoard(best);
}

export function referenceText(board: Board, fp: BoardFootprint, color: string): THREE.Mesh {
  const def = footprintDef(fp), size = Math.max(.7, Math.min(1.2, Math.min(def.body.w, def.body.h) * .35));
  const mesh = surfaceText(fp.ref, color, size);
  const at = referencePosition(board, fp, mesh.geometry.parameters.width, mesh.geometry.parameters.height);
  placeOnBoard(mesh, board, at, fp.side, fp.rotation);
  mesh.userData.footprintId = fp.id;
  return mesh;
}
