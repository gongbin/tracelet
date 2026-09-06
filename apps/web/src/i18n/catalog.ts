import { zhCN, type MessageKey } from './zh-CN.js';
import { en } from './en.js';
import zhTW from './locales/zh-TW.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import de from './locales/de.json';
import fr from './locales/fr.json';
import es from './locales/es.json';
import pt from './locales/pt-BR.json';
import hi from './locales/hi.json';

export const LOCALE_NAMES = {
  'zh-CN': '简体中文', 'zh-TW': '繁體中文', en: 'English', ja: '日本語', ko: '한국어',
  de: 'Deutsch', fr: 'Français', es: 'Español', 'pt-BR': 'Português (Brasil)', hi: 'हिन्दी'
} as const;
export type Locale = keyof typeof LOCALE_NAMES;
export const LOCALES = Object.keys(LOCALE_NAMES) as Locale[];
export const DICTS: Record<Locale, Partial<Record<MessageKey, string>>> = { 'zh-CN': zhCN, 'zh-TW': zhTW, en, ja, ko, de, fr, es, 'pt-BR': pt, hi };

/** Match saved preferences and browser language variants; unsupported languages use English. */
export function resolveLocale(value: string): Locale {
  const tag = value.toLowerCase().replace(/_/g, '-');
  const exact = LOCALES.find((l) => l.toLowerCase() === tag);
  if (exact) return exact;
  if (/^zh(?:-|$)/.test(tag)) return /(?:hant|tw|hk|mo)/.test(tag) ? 'zh-TW' : 'zh-CN';
  if (/^pt(?:-|$)/.test(tag)) return 'pt-BR';
  return LOCALES.find((l) => l === tag.split('-')[0]) ?? 'en';
}
