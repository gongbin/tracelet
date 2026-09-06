import { afterEach, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Wizard } from '../src/screens/Wizard';
import { usePrefs } from '../src/i18n/index';
import { templateName } from '../src/i18n/templates';

afterEach(() => { cleanup(); act(() => usePrefs.getState().setLocale('zh-CN')); });

it('localizes template choices and suggested names, preserving manually entered names', () => {
  act(() => usePrefs.getState().setLocale('en'));
  render(<Wizard />);
  fireEvent.click(screen.getByText('STM32F103 minimal system'));
  const input = screen.getByRole('textbox') as HTMLInputElement;
  expect(input.value).toBe('STM32F103 minimal system');
  act(() => usePrefs.getState().setLocale('fr'));
  expect(screen.getByText('Système minimal STM32F103')).toBeTruthy();
  expect(input.value).toBe('Système minimal STM32F103');
  fireEvent.click(screen.getByText('Système minimal ESP32'));
  expect(input.value).toBe('Système minimal ESP32');
  fireEvent.change(input, { target: { value: '我的 STM32F103 最小系统' } });
  act(() => usePrefs.getState().setLocale('ja'));
  fireEvent.click(screen.getByText('STM32F103 最小構成'));
  expect(input.value).toBe('我的 STM32F103 最小系统');
});

it('uses template ids instead of translating arbitrary names', () => {
  expect(templateName('stm32', 'zh-TW', '')).toBe('STM32F103 最小系統');
  expect(templateName('esp32', 'de', '')).toBe('ESP32-Minimalsystem');
  expect(templateName('custom', 'en', 'STM32F103 最小系统')).toBe('STM32F103 最小系统');
});
