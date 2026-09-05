import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { render, act, cleanup, screen } from '@testing-library/react';
import { createDemoProject, pcb, type AutorouteResult } from '@tracelet/kernel';
import { PcbCanvas } from '../src/editors/pcb/PcbCanvas';
import { useApp } from '../src/store/app';

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() { TestWorker.instances.push(this); }
  emit(data: unknown) { this.onmessage?.({ data }); }
}
const result: AutorouteResult = { traces: [], vias: [], routed: 0, total: 2, failed: [], ms: 1 };
const start = () => act(() => useApp.getState().setPcbTool('autoroute'));
beforeEach(() => {
  vi.stubGlobal('Worker', TestWorker); TestWorker.instances = [];
  act(() => { useApp.getState().openProjectObject(createDemoProject()); useApp.getState().go('pcb'); });
});
afterEach(() => { cleanup(); act(() => useApp.getState().closeProject()); vi.unstubAllGlobals(); });

it('invalidates a completed two-layer proposal and starts with the updated four-layer board', () => {
  render(<PcbCanvas />); start();
  const first = TestWorker.instances[0];
  expect(first.postMessage.mock.calls[0][0].board.copperCount).toBe(2);
  act(() => first.emit({ type: 'done', result }));
  expect(useApp.getState().autoroute.status).toBe('done');
  act(() => useApp.getState().editor!.dispatch(pcb.setCopperCount(4)));
  expect(useApp.getState().autoroute.status).toBe('idle');
  start();
  const second = TestWorker.instances[1];
  expect(second.postMessage.mock.calls[0][0].board.copperCount).toBe(4);
  expect(useApp.getState().autoroute.copperCount).toBe(4);
  act(() => first.emit({ type: 'done', result }));
  expect(useApp.getState().autoroute.status).toBe('running');
});
it('terminates a running job on unmount and ignores its late messages', () => {
  const view = render(<PcbCanvas />); start();
  const worker = TestWorker.instances[0];
  view.unmount();
  expect(worker.terminate).toHaveBeenCalled();
  act(() => worker.emit({ type: 'done', result }));
  expect(useApp.getState().autoroute.status).toBe('idle');
});
it('cancels a running job when layer count changes', () => {
  render(<PcbCanvas />); start();
  const worker = TestWorker.instances[0];
  act(() => useApp.getState().editor!.dispatch(pcb.setCopperCount(4)));
  expect(worker.terminate).toHaveBeenCalled();
  act(() => worker.emit({ type: 'progress', done: 1, total: 2, net: 'OLD' }));
  expect(useApp.getState().autoroute.status).toBe('idle');
  start();
  expect(TestWorker.instances[1].postMessage.mock.calls[0][0].board.copperCount).toBe(4);
});
it('reserves the same name width for preparation, short names, and long names', () => {
  render(<PcbCanvas />); start();
  expect(screen.getByTitle('准备中').style.flex).toBe('0 1 auto');
  for (const net of ['GND', 'VERY_LONG_COMPONENT_AND_NETWORK_NAME_123456789']) {
    act(() => TestWorker.instances[0].emit({ type: 'progress', done: 1, total: 99, net }));
    const label = screen.getByTitle(net);
    expect(label.style.flex).toBe('0 1 auto');
    expect(label.style.textOverflow).toBe('ellipsis');
  }
});
