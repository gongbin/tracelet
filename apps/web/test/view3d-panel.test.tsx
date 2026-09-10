import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { createProject } from '@tracelet/kernel';
import { View3dPanel } from '../src/panels/View3dPanel';
import { use3d } from '../src/editors/three/ThreeView';
import { DEFAULT_SURFACES } from '../src/editors/three/surfaces';
import { useApp } from '../src/store/app';
import { usePrefs, translate, LOCALES } from '../src/i18n';
afterEach(() => { cleanup(); use3d.setState(DEFAULT_SURFACES); useApp.getState().closeProject(); });
it('changes display mode, separate colors and visibility without editing manufacturing data', () => {
  usePrefs.getState().setLocale('en'); useApp.getState().openProjectObject(createProject({ name: '3D display' }));
  const editor = useApp.getState().editor!, before = JSON.stringify(editor.project), ui = render(<View3dPanel />);
  fireEvent.change(ui.getByLabelText('Trace color'), { target: { value: '#ffaa00' } });
  fireEvent.change(ui.getByLabelText('Copper-pour color'), { target: { value: '#445566' } });
  fireEvent.click(ui.getByRole('checkbox', { name: 'Traces', exact: true }));
  expect(use3d.getState()).toMatchObject({ traceColor: '#ffaa00', zoneColor: '#445566', traces: false, zones: true });
  fireEvent.change(ui.getByRole('combobox', { name: 'View mode' }), { target: { value: 'realistic' } });
  expect(ui.queryByLabelText('Trace color')).toBeNull(); expect(use3d.getState().mode).toBe('realistic');
  expect(JSON.stringify(editor.project)).toBe(before);
  expect([...ui.container.querySelectorAll('#three-mask option')].map(o => o.getAttribute('value'))).toEqual(['绿', '黑', '白', '蓝', '红', '黄', '紫']);
  fireEvent.change(ui.container.querySelector('#three-finish')!, { target: { value: 'ENIG' } });
  expect(editor.project.board.stackup?.finish).toBe('ENIG');
  editor.undo(); expect(JSON.stringify(editor.project)).toBe(before);
});
it('provides translated display controls in all ten supported locales', () => {
  for (const locale of LOCALES) for (const key of ['three.mode', 'three.inspect', 'three.realistic', 'three.inspectHint', 'three.realisticHint', 'three.traces', 'three.zones', 'three.traceColor', 'three.zoneColor', 'three.labels', 'three.fit'] as const) {
    const text = translate(locale, key); expect(text).not.toBe(key);
    if (!locale.startsWith('zh') && locale !== 'ja') expect(text).not.toMatch(/[\u4e00-\u9fff]/u);
  }
});
