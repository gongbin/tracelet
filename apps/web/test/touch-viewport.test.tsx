import { useRef } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useViewport, type ViewportApi } from '../src/hooks/useViewport';
import { usePrefs } from '../src/i18n/index';

let view: ViewportApi;
const cancel = vi.fn(), editDown = vi.fn(), editMove = vi.fn(), editUp = vi.fn();
function Harness() {
  const ref = useRef<SVGSVGElement>(null);
  view = useViewport(ref, { initial: { x: 10, y: 20, k: 2 }, minK: 1, maxK: 8, onTouchCancel: cancel });
  return <svg ref={ref} {...view.touchHandlers} onPointerMove={editMove} onPointerUp={editUp}><rect onPointerDown={editDown} /></svg>;
}
function setup() {
  const { container } = render(<Harness />);
  const svg = container.querySelector('svg')!;
  svg.setPointerCapture = vi.fn();
  svg.getBoundingClientRect = () => ({ left: 30, top: 50, width: 400, height: 600 } as DOMRect);
  return { svg, rect: container.querySelector('rect')! };
}
function pointer(target: Element, type: string, id: number, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: 'touch' } });
  fireEvent(target, event);
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('keeps one-finger editing but captures a second finger before it reaches objects', () => {
  const { svg, rect } = setup();
  pointer(rect, 'pointerdown', 1, 130, 150);
  pointer(svg, 'pointermove', 1, 135, 150);
  expect(editDown).toHaveBeenCalledTimes(1); expect(editMove).toHaveBeenCalledTimes(1);
  pointer(rect, 'pointerdown', 2, 235, 150);
  expect(editDown).toHaveBeenCalledTimes(1); expect(cancel).toHaveBeenCalledTimes(1);
  pointer(svg, 'pointermove', 1, 155, 180);
  pointer(svg, 'pointermove', 2, 255, 180);
  expect(view.vp).toEqual({ x: 30, y: 50, k: 2 });
  expect(editMove).toHaveBeenCalledTimes(1);
  pointer(svg, 'pointerup', 1, 155, 180);
  pointer(svg, 'pointermove', 2, 290, 220);
  pointer(svg, 'pointerup', 2, 290, 220);
  expect(editUp).not.toHaveBeenCalled(); expect(view.vp).toEqual({ x: 30, y: 50, k: 2 });
  pointer(rect, 'pointerdown', 3, 130, 150);
  pointer(svg, 'pointerup', 3, 130, 150);
  expect(editDown).toHaveBeenCalledTimes(2); expect(editUp).toHaveBeenCalledTimes(1);
});

it('pins zoom to the midpoint with canvas offsets and clamps zoom', () => {
  const { svg, rect } = setup();
  pointer(rect, 'pointerdown', 1, 130, 150); pointer(rect, 'pointerdown', 2, 230, 150);
  pointer(svg, 'pointermove', 1, 80, 150); pointer(svg, 'pointermove', 2, 280, 150);
  expect(view.vp).toEqual({ x: -130, y: -60, k: 4 });
  pointer(svg, 'pointermove', 2, 10000, 150);
  expect(view.vp.k).toBe(8);
});

it('rebases replacement fingers and handles cancellation without committing edits', () => {
  const { svg, rect } = setup();
  pointer(rect, 'pointerdown', 1, 130, 150); pointer(rect, 'pointerdown', 2, 230, 150);
  pointer(rect, 'pointerdown', 3, 330, 150);
  pointer(svg, 'pointerup', 1, 130, 150);
  pointer(svg, 'pointermove', 2, 240, 170); pointer(svg, 'pointermove', 3, 340, 170);
  expect(view.vp).toEqual({ x: 20, y: 40, k: 2 });
  pointer(svg, 'pointercancel', 2, 240, 170); pointer(svg, 'pointercancel', 3, 340, 170);
  expect(view.panning).toBe(false); expect(editUp).not.toHaveBeenCalled();
  pointer(rect, 'pointerdown', 4, 130, 150); pointer(svg, 'pointercancel', 4, 130, 150);
  expect(cancel).toHaveBeenCalledTimes(2);
});

it('preserves Mac wheel pan and pinch and processes batched wheel updates', () => {
  const { svg } = setup();
  usePrefs.getState().setWheelMode('pan');
  act(() => {
    fireEvent.wheel(svg, { deltaX: 5, deltaY: 10 });
    fireEvent.wheel(svg, { deltaX: 5, deltaY: 10 });
  });
  expect(view.vp).toEqual({ x: 0, y: 0, k: 2 });
  fireEvent.wheel(svg, { clientX: 130, clientY: 150, deltaY: -20, ctrlKey: true });
  expect(view.vp.k).toBeGreaterThan(2);
  expect(view.toWorld(130, 150).x).toBeCloseTo(50);
});
