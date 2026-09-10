import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createProject } from '@tracelet/kernel';
import { LibraryPanel } from '../src/panels/LibraryPanel';
import { useApp } from '../src/store/app';
import { usePrefs } from '../src/i18n';

afterEach(() => { cleanup(); useApp.getState().closeProject(); });

it.each(['sch', 'pcb'] as const)('%s keeps categories in a collapsed picker and updates the part list on selection', (editor) => {
  usePrefs.getState().setLocale('en');
  useApp.getState().openProjectObject(createProject({ name: 'Library filtering' }));
  useApp.getState().patch({ screen: editor, libQuery: '', libSelected: null });
  const { container } = render(<LibraryPanel />);
  const categories = screen.getByRole('combobox', { name: 'All categories' }) as HTMLSelectElement;
  const results = screen.getByRole('region', { name: 'Parts library' });
  const firstResistor = '0402WGF0000TCE';
  expect(categories.multiple).toBe(false);
  expect(categories.size).toBe(0);
  expect(container.querySelector('.cat-chip')).toBeNull();
  expect(within(results).getByText(firstResistor)).toBeTruthy();

  const capacitors = within(categories).getByRole('option', { name: 'Capacitors' }) as HTMLOptionElement;
  fireEvent.change(categories, { target: { value: capacitors.value } });
  expect(categories.selectedOptions[0].textContent).toBe('Capacitors');
  expect(within(results).queryByText(firstResistor)).toBeNull();
  expect(within(results).getByText('CL05C100JB5NNNC')).toBeTruthy();

  fireEvent.change(categories, { target: { value: '' } });
  expect(categories.selectedOptions[0].textContent).toBe('All categories');
  expect(within(results).getByText(firstResistor)).toBeTruthy();
});
