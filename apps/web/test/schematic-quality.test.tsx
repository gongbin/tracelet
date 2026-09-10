import { afterEach, expect, it } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { createProject, pinGeoms, sch, electricalIdentity } from '@tracelet/kernel';
import { SchematicCanvas } from '../src/editors/schematic/SchematicCanvas';
import { SchematicTidy } from '../src/components/SchematicTidy';
import { CheckPanel } from '../src/panels/CheckPanel';
import { Workspace } from '../src/screens/Workspace';
import { useApp } from '../src/store/app';
import { usePrefs, LOCALES, translate } from '../src/i18n';
import { translateText } from '../src/i18n/auto';

afterEach(() => { cleanup(); useApp.getState().closeProject(); });
function fixture() {
  usePrefs.getState().setLocale('en');
  const p = createProject({ name: 'Schematic quality interaction' }), s = p.schematic.sheets[0]; s.frame.size = 'none';
  s.components = [{ id: 'c1', ref: 'R1', symbolId: 'sym:R', value: '10k', footprint: '', x: 25, y: 25, rotation: 0, mirror: false, props: {} }];
  s.wires = [{ id: 'target', points: [{ x: 1500, y: 25 }, { x: 2500, y: 25 }] }];
  s.labels = [{ id: 'local', text: 'DATA', scope: 'local', kind: 'net', x: 2000, y: 25 }];
  useApp.getState().openProjectObject(p); useApp.getState().setSchTool('select');
  useApp.getState().patch({ screen: 'sch', sheetId: s.id, selection: [], wireDraft: null, pendingPin: null, labelPrompt: null });
  return { p, s, editor: useApp.getState().editor!, pinPos: pinGeoms(s.components[0])[0].end };
}
function canvasEvents(container: HTMLElement) {
  const svg = container.querySelector('svg.stage')!;
  const pointer = (type: string, target: Element, x: number, y: number) => {
    const [tx, ty, k] = svg.querySelector('g[transform]')!.getAttribute('transform')!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    const ev = new MouseEvent(type, { bubbles: true, clientX: x * k + tx, clientY: y * k + ty });
    Object.defineProperties(ev, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } }); fireEvent(target, ev);
  };
  const pin = [...svg.querySelectorAll('circle')].find(e => e.querySelector('title')?.textContent?.startsWith('R1.1'))!;
  return { svg, pin, down: (target: Element, x: number, y: number) => pointer('pointerdown', target, x, y), move: (x: number, y: number) => pointer('pointermove', svg, x, y), up: (x: number, y: number) => pointer('pointerup', svg, x, y) };
}
it('continues a pin-started wire across blank corners and finishes on an exact label anchor', () => {
  const { editor, pinPos } = fixture(), view = render(<SchematicCanvas />), { svg, pin, down } = canvasEvents(view.container);
  down(pin, pinPos.x, pinPos.y); down(svg, 600, -500);
  const first = useApp.getState().wireDraft!.length;
  down(svg, 900, -800); expect(useApp.getState().wireDraft!.length).toBeGreaterThan(first);
  down(view.getByText('DATA'), 2050, -40);
  expect(useApp.getState().wireDraft).toBeNull();
  expect(editor.project.schematic.sheets[0].wires).toHaveLength(2);
  expect(editor.project.schematic.sheets[0].wires[1].points.at(-1)).toEqual({ x: 2000, y: 25 });
  act(() => editor.undo()); expect(editor.project.schematic.sheets[0].wires).toHaveLength(1);
});
it('attaches labels exactly to imported off-grid pins and preserves the chosen local scope', () => {
  const { editor, pinPos } = fixture(); useApp.getState().setSchTool('label');
  const view = render(<SchematicCanvas />), { pin, down } = canvasEvents(view.container);
  down(pin, pinPos.x + 5, pinPos.y + 5);
  expect(useApp.getState().labelPrompt).toEqual(pinPos);
  fireEvent.change(view.getByRole('combobox', { name: 'Scope' }), { target: { value: 'local' } });
  const input = view.container.querySelector('.label-prompt input')!;
  fireEvent.change(input, { target: { value: 'SENSE' } }); fireEvent.keyDown(input, { key: 'Enter' });
  expect(editor.project.schematic.sheets[0].labels.at(-1)).toMatchObject({ text: 'SENSE', scope: 'local', ...pinPos });
  expect(useApp.getState().pendingPin).toBeNull();
});
it('keeps label identity through more than one pointer move and undoes the drag as one action', () => {
  const { editor, s } = fixture(), view = render(<SchematicCanvas />), { down, move, up } = canvasEvents(view.container);
  down(view.getByText('DATA'), 2000, 25); move(2100, 25); move(2200, 25); up(2200, 25);
  expect(editor.project.schematic.sheets[0].labels[0]).toEqual({ ...s.labels[0], x: 2200 });
  act(() => editor.undo()); expect(editor.project.schematic.sheets[0].labels[0]).toEqual(s.labels[0]);
});
it('Backspace edits the draft instead of deleting selection, and Enter finishes committed segments', () => {
  const { editor } = fixture(); useApp.getState().patch({ selection: ['c1'], wireDraft: [{ x: 0, y: -500 }, { x: 500, y: -500 }, { x: 500, y: -800 }] });
  render(<Workspace />);
  fireEvent.keyDown(window, { key: 'Backspace' });
  expect(editor.project.schematic.sheets[0].components).toHaveLength(1);
  expect(useApp.getState().wireDraft).toHaveLength(2);
  fireEvent.keyDown(window, { key: 'Enter' });
  expect(editor.project.schematic.sheets[0].wires).toHaveLength(2);
  expect(useApp.getState().wireDraft).toBeNull();
  act(() => editor.undo()); expect(editor.project.schematic.sheets[0].wires).toHaveLength(1);
});
it('filters and expands warnings, locates the pin, and marks intentional no-connect with undo', () => {
  const { editor, s } = fixture(), view = render(<CheckPanel />);
  fireEvent.change(view.getByRole('searchbox'), { target: { value: 'R1' } });
  const warnings = view.getAllByRole('button', { name: /Pin unconnected/ }); expect(warnings).toHaveLength(2);
  fireEvent.click(warnings[0]);
  expect(useApp.getState().sheetId).toBe(s.id); expect(useApp.getState().selection).toEqual(['c1']);
  fireEvent.click(view.getByRole('button', { name: 'Mark no-connect' }));
  expect(editor.project.schematic.sheets[0].components[0].noConnectPins).toEqual(['1']);
  act(() => editor.undo()); expect(editor.project.schematic.sheets[0].components[0].noConnectPins).toBeUndefined();
  fireEvent.change(view.getByRole('searchbox'), { target: { value: 'nothing-matches' } });
  expect(view.getByText('No matching issues')).toBeTruthy();
});
it('only applies the cleanup proposal on request and rejects stale proposals', () => {
  const { editor, s } = fixture(); s.components[0].textOffset = { ref: { x: -200, y: 20 }, value: { x: 0, y: 0 } };
  const before = editor.project.schematic, view = render(<SchematicTidy />);
  fireEvent.click(view.getByRole('button', { name: 'Tidy & verify' }));
  fireEvent.click(view.getByRole('button', { name: 'Tidy text only' }));
  expect(editor.project.schematic).toBe(before);
  fireEvent.click(view.getByRole('button', { name: 'Apply cleanup' }));
  expect(editor.project.schematic).not.toBe(before); expect(electricalIdentity(editor.project.schematic)).toBe(electricalIdentity(before));
  act(() => editor.undo()); expect(editor.project.schematic).toBe(before);
  fireEvent.click(view.getByRole('button', { name: 'Tidy & verify' }));
  fireEvent.click(view.getByRole('button', { name: 'Tidy text only' }));
  act(() => editor.dispatch(sch.updateLabel(s.id, 'local', { text: 'CHANGED' })));
  const changed = editor.project.schematic;
  fireEvent.click(view.getByRole('button', { name: 'Apply cleanup' }));
  expect(editor.project.schematic).toBe(changed);
  expect(view.queryByRole('button', { name: 'Apply cleanup' })).toBeNull();
});
it.each(LOCALES)('localizes new actionable diagnostics in %s', locale => {
  for (const key of ['erc.danglingLabel.title', 'erc.danglingLabel.why', 'erc.danglingWire.title', 'erc.danglingWire.why'] as const) expect(translateText(translate('zh-CN', key), locale)).toBe(translate(locale, key));
});
