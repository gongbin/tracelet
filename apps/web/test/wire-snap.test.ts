import { describe, it, expect } from 'vitest';
import { wireSnap } from '../src/editors/schematic/wireSnap.js';

describe('schematic wire attachment', () => {
  it('uses exact off-grid pin coordinates', () => {
    expect(wireSnap({ x: 102, y: 27 }, [{ x: 100, y: 25 }], [], 100, 10)).toEqual({ point: { x: 100, y: 25 }, attached: true });
  });
  it('projects onto off-grid wire without rounding its fixed axis', () => {
    expect(wireSnap({ x: 100, y: 29 }, [], [{ id: 'w', points: [{ x: 0, y: 25 }, { x: 200, y: 25 }] }], 50, 10)).toEqual({ point: { x: 100, y: 25 }, attached: true });
  });
  it('falls back to the grid outside the capture radius', () => {
    expect(wireSnap({ x: 133, y: 66 }, [{ x: 0, y: 0 }], [], 50, 10)).toEqual({ point: { x: 150, y: 50 }, attached: false });
  });
});
