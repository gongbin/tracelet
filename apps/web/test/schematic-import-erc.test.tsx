import { afterEach, expect, it } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { createProject, importKicadSchematic } from '@tracelet/kernel';
import { PropertiesPanel } from '../src/panels/PropertiesPanel';
import { CheckPanel } from '../src/panels/CheckPanel';
import { useApp } from '../src/store/app';
import { LOCALES, usePrefs, translate } from '../src/i18n';
import { translateText } from '../src/i18n/auto';

afterEach(() => { cleanup(); useApp.getState().closeProject(); });

it('shows the imported local scope instead of claiming that same-name labels connect across sheets', () => {
  usePrefs.getState().setLocale('en');
  const p = createProject({ name: 'label scope' });
  p.schematic.sheets = ['a', 'b'].map((name) => importKicadSchematic('(kicad_sch (label "DATA" (at 25.4 25.4 0)))', { sheetName: name }).sheet);
  useApp.getState().openProjectObject(p);
  useApp.getState().patch({ screen: 'sch', sheetId: p.schematic.sheets[0].id, selection: [p.schematic.sheets[0].labels[0].id] });
  const view = render(<PropertiesPanel />);
  expect(view.getByText('Local label: matching labels connect only within this sheet.')).toBeTruthy();
  expect(view.queryByText('This net also appears on other sheets.')).toBeNull();
});

it('keeps an incomplete hierarchy visible in the Web ERC panel', () => {
  usePrefs.getState().setLocale('en');
  const p = createProject({ name: 'hierarchy' });
  p.schematic.sheets = [importKicadSchematic('(kicad_sch (hierarchical_label "DATA" (at 25.4 25.4 0)))').sheet];
  useApp.getState().openProjectObject(p);
  useApp.getState().patch({ screen: 'sch', sheetId: p.schematic.sheets[0].id });
  expect(render(<CheckPanel />).getByText('Unresolved hierarchical connections')).toBeTruthy();
});

it.each(LOCALES)('localizes the new import diagnostics in %s', locale => {
  for (const key of ['erc.hierarchy.title', 'erc.hierarchy.why'] as const) {
    expect(translateText(translate('zh-CN', key), locale)).toBe(translate(locale, key));
  }
});
