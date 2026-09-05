import { create } from 'zustand';
import { zhCN, type MessageKey } from './zh-CN.js';
import { en } from './en.js';

export type Locale = 'zh-CN' | 'en';
export type Theme = 'dark' | 'light' | 'system';
const DICTS: Record<Locale, Partial<Record<MessageKey, string>>> = { 'zh-CN': zhCN, en };
export const LOCALES: Locale[] = ['zh-CN', 'en'];

interface PrefState { locale: Locale; theme: Theme; setLocale: (l: Locale) => void; setTheme: (t: Theme) => void }
const load = <T,>(k: string, d: T): T => { try { return (localStorage.getItem(k) as T) ?? d; } catch { return d; } };

/** 界面偏好：语言与主题。持久化到 localStorage，主题写到 <html data-theme>。 */
export const usePrefs = create<PrefState>((set) => ({
  locale: load<Locale>('tracelet:locale', (typeof navigator !== 'undefined' && navigator.language.startsWith('en') ? 'en' : 'zh-CN')),
  theme: load<Theme>('tracelet:theme', 'dark'),
  setLocale: (locale) => { try { localStorage.setItem('tracelet:locale', locale); } catch { /* ignore */ } set({ locale }); },
  setTheme: (theme) => { try { localStorage.setItem('tracelet:theme', theme); } catch { /* ignore */ } applyTheme(theme); set({ theme }); }
}));

export function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme);
}

/** 翻译函数：缺失键回退到中文源文案；支持 {name} 占位。 */
export function translate(locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
  let s = DICTS[locale][key] ?? zhCN[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  return s;
}

export function useT() {
  const locale = usePrefs((s) => s.locale);
  return (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars);
}

applyTheme(usePrefs.getState().theme);
