import { afterEach, expect, it } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { createProject } from '@tracelet/kernel';
import { SchematicCanvas } from '../src/editors/schematic/SchematicCanvas';
import { useApp } from '../src/store/app';

afterEach(() => { cleanup(); useApp.getState().closeProject(); });
function setup() {
  const p = createProject({ name: 'schematic interaction regression' });
  const sheet = p.schematic.sheets[0]; sheet.frame.size = 'none';
  sheet.components = [{ id: 'c1', ref: 'R1', symbolId: 'sym:R', value: '10k', footprint: '', x: 0, y: 0, rotation: 0, mirror: false, props: {} }];
  sheet.wires = [{ id: 'target', points: [{ x: 500, y: 25 }, { x: 1500, y: 25 }] }];
  useApp.getState().openProjectObject(p); useApp.getState().setSchTool('select');
  const view = render(<SchematicCanvas />);
  const svg = view.container.querySelector('svg.stage')!;
  const [tx, ty, k] = svg.querySelector('g[transform]')!.getAttribute('transform')!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  const pointer = (target: Element, x: number, y: number, altKey = false) => {
    const ev = new MouseEvent('pointerdown', { bubbles: true, clientX: x * k + tx, clientY: y * k + ty, altKey });
    Object.defineProperties(ev, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } }); fireEvent(target, ev);
  };
  const pin = [...svg.querySelectorAll('circle')].find((e) => e.querySelector('title')?.textContent?.startsWith('R1.1'))!;
  return { ...view, svg, pointer, pin, sheet };
}
it('finishes a pending pin connection on an off-grid wire and supports undo', () => {
  const { svg, pointer, pin } = setup();
  pointer(pin, 120, -200);
  expect(useApp.getState().pendingPin?.pin).toBe('1');
  const target = [...svg.querySelectorAll('path')].find((p) => p.getAttribute('d') === 'M500 25 L1500 25' || p.getAttribute('d') === 'M500 25L1500 25')!;
  expect(target).toBeTruthy(); pointer(target, 1000, 28);
  const editor = useApp.getState().editor!;
  expect(editor.project.schematic.sheets[0].wires).toHaveLength(2);
  expect(editor.project.schematic.sheets[0].wires[1].points.at(-1)).toEqual({ x: 1000, y: 25 });
  expect(useApp.getState().pendingPin).toBeNull();
  editor.undo(); expect(editor.project.schematic.sheets[0].wires).toHaveLength(1);
});
it('Alt-click toggles no-connect intent without starting a wire', () => {
  const { pointer, pin } = setup(); pointer(pin, 120, -200, true);
  const editor = useApp.getState().editor!;
  expect(editor.project.schematic.sheets[0].components[0].noConnectPins).toEqual(['1']);
  expect(useApp.getState().pendingPin).toBeNull();
  editor.undo(); expect(editor.project.schematic.sheets[0].components[0].noConnectPins).toBeUndefined();
});
