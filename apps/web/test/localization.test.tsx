import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AppearanceControls } from '../src/components/AppearanceControls';
import { DICTS, LOCALES, resolveLocale } from '../src/i18n/catalog';
import { translate, usePrefs } from '../src/i18n/index';
import { zhCN, type MessageKey } from '../src/i18n/zh-CN';
import { setAutoTranslate, translateText } from '../src/i18n/auto';

afterEach(() => { cleanup(); setAutoTranslate(false); usePrefs.getState().setLocale('zh-CN'); usePrefs.getState().setTheme('dark'); });

describe('ten-language localization', () => {
  it('contains every semantic key and preserves placeholder sets in each added language', () => {
    expect(LOCALES).toHaveLength(10);
    expect(LOCALES).toContain('zh-TW'); expect(LOCALES).not.toContain('ru');
    for (const locale of LOCALES.filter((l) => l !== 'en')) for (const key of Object.keys(zhCN) as MessageKey[]) {
      const value = DICTS[locale][key];
      expect(value, `${locale}: ${key}`).toBeTruthy();
      expect(value?.match(/\{\w+\}/g)?.sort() ?? []).toEqual(zhCN[key].match(/\{\w+\}/g)?.sort() ?? []);
    }
    expect(translate('de', 'pager.page', { page: 2, count: 8, total: '$&' })).toBe('Seite 2 / 8 · $& Einträge');
  });
  it('resolves browser variants and invalid preferences', () => {
    for (const [source, expected] of [['zh-HK', 'zh-TW'], ['zh-Hant', 'zh-TW'], ['zh-SG', 'zh-CN'], ['pt-PT', 'pt-BR'], ['en-GB', 'en'], ['ja-JP', 'ja'], ['ko-KR', 'ko'], ['hi-IN', 'hi'], ['unknown', 'en']]) expect(resolveLocale(source)).toBe(expected);
  });
  it('switches language and theme from the header and persists the selections', () => {
    usePrefs.getState().setLocale('zh-CN');
    render(<AppearanceControls />);
    fireEvent.click(screen.getByRole('button', { name: '语言' }));
    fireEvent.click(screen.getByRole('button', { name: 'Deutsch' }));
    expect(document.documentElement.lang).toBe('de');
    expect(localStorage.getItem('tracelet:locale')).toBe('de');
    fireEvent.click(screen.getByRole('button', { name: 'Design' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hell' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: 'Design' }));
    fireEvent.click(screen.getByRole('button', { name: 'System' }));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem('tracelet:theme')).toBe('system');
    fireEvent.click(screen.getByRole('button', { name: 'Sprache' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('group')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sprache' }));
  });
  it('restores legacy strings and attributes on language changes without touching project data', async () => {
    const { container } = render(<div><p>取消</p><input placeholder="新建项目" defaultValue="取消" /><span data-no-translate>新建项目</span></div>);
    act(() => setAutoTranslate('ja'));
    expect(container.querySelector('p')?.textContent).toBe('キャンセル');
    expect(container.querySelector('input')?.placeholder).toBe('新規プロジェクト');
    act(() => setAutoTranslate('fr'));
    expect(container.querySelector('p')?.textContent).toBe('Annuler');
    expect(container.querySelector('input')?.value).toBe('取消');
    expect(container.querySelector('[data-no-translate]')?.textContent).toBe('新建项目');
    act(() => setAutoTranslate(false));
    expect(container.querySelector('p')?.textContent).toBe('取消');
    expect(container.querySelector('input')?.placeholder).toBe('新建项目');
  });
  it('localizes the net-class warning in all languages, retaining numeric limits', () => {
    for (const locale of LOCALES) {
      const source = '走线宽度低于网络类 Power（0.25 < 0.5mm）';
      const text = translateText(source, locale);
      expect(text).toContain('Power'); expect(text).toContain('0.25'); expect(text).toContain('0.5mm');
      if (locale !== 'zh-CN') expect(text).not.toContain('走线宽度低于网络类');
    }
  });
});
