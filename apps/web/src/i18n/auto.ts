/** Compatibility layer for legacy Chinese UI strings. New UI should use semantic keys. */
import { DICT_EN } from './dict-en.js';
import { DICTS, type Locale } from './catalog.js';
import { zhCN, type MessageKey } from './zh-CN.js';
import zhTW from './locales/zh-TW-legacy.json';
import ja from './locales/ja-legacy.json';
import ko from './locales/ko-legacy.json';
import de from './locales/de-legacy.json';
import fr from './locales/fr-legacy.json';
import es from './locales/es-legacy.json';
import pt from './locales/pt-BR-legacy.json';
import hi from './locales/hi-legacy.json';

const legacy: Partial<Record<Locale, Record<string, string>>> = { 'zh-TW': zhTW, ja, ko, de, fr, es, 'pt-BR': pt, hi };
const tables = new Map<Locale, { dict: Record<string, string>; pattern: RegExp; localized: Set<string> }>();
function table(locale: Locale) {
  let entry = tables.get(locale);
  if (!entry) {
    const dict = { ...DICT_EN, ...legacy[locale] };
    for (const key of Object.keys(zhCN) as MessageKey[]) {
      const value = DICTS[locale][key];
      if (value) dict[zhCN[key]] = value;
    }
    // Legacy entries sometimes differ only by leading/trailing spaces.
    for (const source of Object.keys(dict)) {
      const value = legacy[locale]?.[source.trim()];
      if (value && source !== source.trim()) dict[source] = source.replace(source.trim(), () => value);
    }
    // Replace source fragments in a single pass: never translate the translated output again.
    const keys = Object.keys(dict).filter((k) => k.trim().length >= 2).sort((a, b) => b.length - a.length);
    const pattern = new RegExp(keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
    entry = { dict, pattern, localized: new Set(Object.values(dict)) };
    tables.set(locale, entry);
  }
  return entry;
}
const cache = new Map<string, string>();
export function translateText(s: string, locale: Locale = 'en'): string {
  if (locale === 'zh-CN' || !/[一-鿿]/.test(s)) return s;
  const key = `${locale}\0${s}`;
  const cached = cache.get(key); if (cached !== undefined) return cached;
  const { dict, pattern } = table(locale);
  const trimmed = s.trim();
  let out = dict[trimmed] !== undefined ? s.replace(trimmed, () => dict[trimmed]) : s.replace(pattern, (source) => dict[source]);
  if (locale !== 'zh-TW' && locale !== 'ja') {
    out = out.replace(/(\d)\s*段(?![一-鿿])/g, '$1 seg').replace(/(\d)\s*[个条段块处次根种张]\s*(?=[A-Za-z(])/g, '$1 ')
      .replace(/：/g, ': ').replace(/，/g, ', ').replace(/。/g, '. ').replace(/（/g, ' (').replace(/）/g, ') ').replace(/、/g, ', ').replace(/ {2,}/g, ' ').replace(/\s+([,.:)])/g, '$1');
  }
  if (cache.size > 5000) cache.clear();
  cache.set(key, out);
  return out;
}

const ATTRS = ['title', 'placeholder', 'aria-label'];
type Original = { source: string; rendered: string };
const originals = new WeakMap<Node, Original>();
const attributes = new WeakMap<Element, Map<string, Original>>();
let active: Locale = 'zh-CN';
let observer: MutationObserver | null = null;
function skip(el: Element | null, attribute = false): boolean {
  for (let p = el; p; p = p.parentElement) {
    if (p.hasAttribute('data-no-translate')) return true;
    if (['svg', 'script', 'style', 'code', 'pre', 'textarea'].includes(p.tagName.toLowerCase())) return true;
    if (!attribute && p.tagName === 'INPUT') return true;
  }
  return false;
}
function translated(value: string, old?: Original): Original {
  const source = old && value === old.rendered ? old.source : value;
  // React already renders semantic keys in the selected language.
  if (!old && active !== 'zh-CN' && table(active).localized.has(source)) return { source, rendered: source };
  return { source, rendered: translateText(source, active) };
}
function fixText(node: Text) {
  if (skip(node.parentElement)) return;
  const v = node.nodeValue ?? '';
  const old = originals.get(node);
  if (old && v === old.rendered && active !== 'zh-CN') return;
  const next = translated(v, old);
  if (next.rendered !== v) node.nodeValue = next.rendered;
  if (next.source !== next.rendered) originals.set(node, next); else originals.delete(node);
}
function fixAttrs(el: Element) {
  if (skip(el, true)) return;
  const stored = attributes.get(el) ?? new Map<string, Original>();
  for (const attr of ATTRS) {
    const v = el.getAttribute(attr); if (v === null) { stored.delete(attr); continue; }
    const old = stored.get(attr);
    if (old && v === old.rendered && active !== 'zh-CN') continue;
    const next = translated(v, old);
    if (next.rendered !== v) el.setAttribute(attr, next.rendered);
    if (next.source !== next.rendered) stored.set(attr, next); else stored.delete(attr);
  }
  attributes.set(el, stored);
}
function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) { fixText(root as Text); return; }
  if (root.nodeType === Node.ELEMENT_NODE) fixAttrs(root as Element);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE) fixText(node as Text); else fixAttrs(node as Element);
  }
}
const options = { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS };
/** Restore source text before each language change. Boolean arguments retain compatibility with tests. */
export function setAutoTranslate(locale: Locale | boolean) {
  observer?.disconnect(); observer = null;
  active = 'zh-CN';
  if (!document.body) return;
  walk(document.body);
  active = typeof locale === 'boolean' ? (locale ? 'en' : 'zh-CN') : locale;
  if (active === 'zh-CN') return;
  walk(document.body);
  observer = new MutationObserver((mutations) => {
    observer?.disconnect();
    try {
      for (const m of mutations) {
        if (m.type === 'characterData') fixText(m.target as Text);
        else if (m.type === 'attributes') fixAttrs(m.target as Element);
        else for (const node of Array.from(m.addedNodes)) walk(node);
      }
    } finally { observer?.observe(document.body, options); }
  });
  observer.observe(document.body, options);
}
