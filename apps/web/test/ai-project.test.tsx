import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ProjectSchema, getSymbol, buildNetlist } from '@tracelet/kernel';
import { projectFromAiPlan, validateProjectPlan } from '../src/ai/createProject';
import { AiProjectDialog } from '../src/components/AiProjectDialog';
import { useAiConfig } from '../src/ai/config';
import { usePrefs } from '../src/i18n';
import { useApp } from '../src/store/app';
import * as ai from '../src/ai/createProject';
const plan = { title: 'LED draft', summary: 'Power indicator', notes: ['Verify polarity.'], components: [
  { ref: 'R1', value: '1k', kind: 'resistor', footprint: '0603', description: 'Limit current', pins: [{ number: '1', name: '1', net: '5V' }, { number: '2', name: '2', net: 'LED' }] },
  { ref: 'D1', value: 'red LED', kind: 'led', footprint: '0603', description: 'Indicator', pins: [{ number: '1', name: 'A', net: 'LED' }, { number: '2', name: 'K', net: 'GND' }] }
] };
afterEach(() => { cleanup(); vi.restoreAllMocks(); useApp.getState().closeProject(); });
describe('AI project creation', () => {
  it('generates a serializable schematic with no PCB objects and advances reference counters', () => {
    const p = ProjectSchema.parse(projectFromAiPlan(plan));
    expect(p.schematic.sheets[0].components.filter((c) => !getSymbol(c.symbolId).power)).toHaveLength(2);
    expect(p.board.footprints).toEqual([]); expect(p.board.traces).toEqual([]);
    expect(p.schematic.counters.R).toBe(2);
    expect(p.schematic.sheets[0].components[0].props.verification).toBe('unverified');
    expect(JSON.parse(p.schematic.sheets[0].components[0].props.aiDesignNotes).notes).toEqual(plan.notes);
  });
  it('preserves cathode-1/anode-2 LED pin numbering without changing nets', () => {
    const input = structuredClone(plan);
    input.components[1].pins = [{ number: '1', name: 'K', net: 'GND' }, { number: '2', name: 'A', net: 'LED' }];
    const p = projectFromAiPlan(input); const sh = p.schematic.sheets[0];
    const led = sh.components.find((c) => c.ref === 'D1')!;
    expect(getSymbol(led.symbolId).pins.find((p) => p.name === 'K')?.number).toBe('1');
    expect(buildNetlist(sh).pinNet.get(`${led.id}:1`)).toBe('GND');
    expect(p.library.symbols.some((s) => s.id === led.symbolId)).toBe(true);
  });
  it('rejects empty circuits, duplicate references and duplicate pin numbers', () => {
    expect(() => validateProjectPlan({ ...plan, components: [] })).toThrow();
    expect(() => validateProjectPlan({ ...plan, components: [plan.components[0], plan.components[0]] })).toThrow('Duplicate reference');
    const bad = structuredClone(plan); bad.components[0].pins[1].number = '1';
    expect(() => validateProjectPlan(bad)).toThrow('Duplicate pin');
  });
  it('reviews the plan before creating a new project; editing requirements invalidates the old plan', async () => {
    usePrefs.getState().setLocale('en'); useAiConfig.getState().set({ apiKey: 'test-key', model: 'test' });
    vi.spyOn(ai, 'analyzeProjectRequirements').mockResolvedValue(plan);
    const open = vi.spyOn(useApp.getState(), 'openProjectObject').mockImplementation(() => {});
    const save = vi.spyOn(useApp.getState().store, 'save').mockResolvedValue(undefined);
    render(<AiProjectDialog onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Project requirements'), { target: { value: 'LED circuit' } });
    fireEvent.click(screen.getByText('Analyze requirements'));
    await screen.findByText('Generate schematic (2 components)');
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Generate schematic (2 components)'));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Project requirements'), { target: { value: 'Different circuit' } });
    expect(screen.queryByText('Generate schematic (2 components)')).toBeNull();
  });
  it('cancels a request and ignores a late result', async () => {
    usePrefs.getState().setLocale('en'); useAiConfig.getState().set({ apiKey: 'test-key' });
    let resolve!: (p: typeof plan) => void;
    const mock = vi.spyOn(ai, 'analyzeProjectRequirements').mockImplementation(() => new Promise((r) => { resolve = r; }));
    render(<AiProjectDialog onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Project requirements'), { target: { value: 'LED circuit' } });
    fireEvent.click(screen.getByText('Analyze requirements'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(mock.mock.calls[0][2].signal?.aborted).toBe(true);
    resolve(plan);
    await waitFor(() => expect((screen.getByText('Analyze requirements') as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText('Generate schematic (2 components)')).toBeNull();
  });
});

it('guides an unconfigured user to the missing field and never sends a request', async () => {
  usePrefs.getState().setLocale('en');
  useAiConfig.getState().set({ apiKey: '', model: '', baseUrl: '' });
  const analyze = vi.spyOn(ai, 'analyzeProjectRequirements');
  const save = vi.spyOn(useAiConfig.getState(), 'save');
  render(<AiProjectDialog onClose={() => {}} />);
  expect(screen.getByRole('alert').textContent).toContain('Set up AI first');
  expect(document.activeElement).toBe(screen.getByLabelText('API Key'));
  fireEvent.click(screen.getByText('Save settings'));
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('AI settings'));
  fireEvent.click(screen.getByText('Configure AI now'));
  expect(document.activeElement).toBe(screen.getByLabelText('API Key'));
  expect(analyze).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'test-key' } });
  fireEvent.click(screen.getByText('Save settings'));
  expect(document.activeElement).toBe(screen.getByLabelText('Model ID'));
  fireEvent.change(screen.getByLabelText('Model ID'), { target: { value: 'test-model' } });
  fireEvent.change(screen.getByLabelText('Anthropic-compatible API URL'), { target: { value: 'not-a-url' } });
  fireEvent.click(screen.getByText('Save settings'));
  expect(document.activeElement).toBe(screen.getByLabelText('Anthropic-compatible API URL'));
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Anthropic-compatible API URL'), { target: { value: '' } });
  fireEvent.click(screen.getByText('Save settings'));
  expect(save).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('Analyze requirements')).toBeTruthy();
});
