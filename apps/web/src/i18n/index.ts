import { create } from 'zustand';
import { zhCN, type MessageKey } from './zh-CN.js';
import { en } from './en.js';
import { DICTS, resolveLocale, type Locale } from './catalog.js';
export { LOCALES, LOCALE_NAMES, resolveLocale, type Locale } from './catalog.js';
import { setAutoTranslate } from './auto.js';

export type Theme = 'dark' | 'light' | 'system';
export type WheelMode = 'pan' | 'zoom';

interface PrefState { locale: Locale; theme: Theme; wheelMode: WheelMode; /** 用户姓名：写入原理图标题栏作者；远程模式同步到服务器 */ userName: string; setLocale: (l: Locale) => void; setTheme: (t: Theme) => void; setWheelMode: (m: WheelMode) => void; setUserName: (n: string) => void }
const load = <T,>(k: string, d: T): T => { try { return (localStorage.getItem(k) as T) ?? d; } catch { return d; } };

/** 界面偏好：语言与主题。持久化到 localStorage，主题写到 <html data-theme>。 */
export const usePrefs = create<PrefState>((set) => ({
  locale: resolveLocale(load<string>('tracelet:locale', typeof navigator !== 'undefined' ? navigator.language : 'en')),
  theme: load<Theme>('tracelet:theme', 'dark'),
  wheelMode: load<WheelMode>('tracelet:wheel', 'pan'),
  userName: load<string>('tracelet:user', ''),
  setUserName: (userName) => { try { localStorage.setItem('tracelet:user', userName); } catch { /* ignore */ } set({ userName }); },
  setWheelMode: (wheelMode) => { try { localStorage.setItem('tracelet:wheel', wheelMode); } catch { /* ignore */ } set({ wheelMode }); },
  setLocale: (value) => { const locale = resolveLocale(value); if (typeof document !== 'undefined') { setAutoTranslate(false); document.documentElement.lang = locale; } try { localStorage.setItem('tracelet:locale', locale); } catch { /* ignore */ } set({ locale }); if (typeof document !== 'undefined') setAutoTranslate(locale); },
  setTheme: (theme) => { try { localStorage.setItem('tracelet:theme', theme); } catch { /* ignore */ } applyTheme(theme); set({ theme }); }
}));

export function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme);
}

/** Missing translations fall back to English, then the source; preserve literal placeholder values. */
export function translate(locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
  let s = DICTS[locale]?.[key] ?? en[key] ?? zhCN[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, () => String(v));
  return s;
}

export function useT() {
  const locale = usePrefs((s) => s.locale);
  return (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars);
}

applyTheme(usePrefs.getState().theme);
if (typeof document !== 'undefined') {
  document.documentElement.lang = usePrefs.getState().locale;
  queueMicrotask(() => setAutoTranslate(usePrefs.getState().locale));
}
