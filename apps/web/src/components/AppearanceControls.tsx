import { useEffect, useRef, useState } from 'react';
import { LOCALES, LOCALE_NAMES, usePrefs, useT, type Theme } from '../i18n/index.js';
import { Icon } from './Icon.js';

const globe = 'M21 12a9 9 0 11-18 0 9 9 0 0118 0M3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18';
const themeIcons: Record<Theme, string> = {
  dark: 'M20.5 13A8.5 8.5 0 1111 3.5 6.5 6.5 0 0020.5 13z',
  light: 'M12 8a4 4 0 100 8 4 4 0 000-8M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
  system: 'M3 4h18v13H3zM8 21h8M12 17v4'
};

/** Shared by the home page and editor, immediately after GitHub. */
export function AppearanceControls() {
  const prefs = usePrefs();
  const t = useT();
  const [open, setOpen] = useState<'language' | 'theme' | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const languageButton = useRef<HTMLButtonElement>(null);
  const themeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(null); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(null); (open === 'language' ? languageButton : themeButton).current?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
  }, [open]);
  return <div className="appearance-controls" ref={ref} data-no-translate onClick={(e) => e.stopPropagation()}>
    <button ref={languageButton} className={`btn quiet appearance-language${open === 'language' ? ' on' : ''}`} title={t('settings.language')} aria-label={t('settings.language')} aria-expanded={open === 'language'} onClick={() => setOpen(open === 'language' ? null : 'language')}>
      <Icon d={globe} size={16} /><span lang={prefs.locale}>{prefs.locale === 'pt-BR' ? 'Português' : LOCALE_NAMES[prefs.locale]}</span><span className="dim xs">▾</span>
    </button>
    <button ref={themeButton} className="iconbtn" title={`${t('settings.theme')}: ${t(`theme.${prefs.theme}`)}`} aria-label={t('settings.theme')} aria-expanded={open === 'theme'} onClick={() => setOpen(open === 'theme' ? null : 'theme')}><Icon d={themeIcons[prefs.theme]} size={17} /></button>
    {open && <div className="menu appearance-menu" role="group" aria-label={t(open === 'language' ? 'settings.language' : 'settings.theme')}>
      <div className="menu-head">{t(open === 'language' ? 'settings.language' : 'settings.theme')}</div>
      {open === 'language' ? LOCALES.map((locale) => <button key={locale} className={`menu-item${prefs.locale === locale ? ' on' : ''}`} lang={locale} aria-pressed={prefs.locale === locale} onClick={() => { prefs.setLocale(locale); setOpen(null); languageButton.current?.focus(); }}><span>{LOCALE_NAMES[locale]}</span><span className="ml-auto">{prefs.locale === locale ? '✓' : ''}</span></button>)
        : (['dark', 'light', 'system'] as Theme[]).map((theme) => <button key={theme} className={`menu-item${prefs.theme === theme ? ' on' : ''}`} aria-pressed={prefs.theme === theme} onClick={() => { prefs.setTheme(theme); setOpen(null); themeButton.current?.focus(); }}><Icon d={themeIcons[theme]} size={15} /><span>{t(`theme.${theme}`)}</span><span className="ml-auto">{prefs.theme === theme ? '✓' : ''}</span></button>)}
    </div>}
  </div>;
}
