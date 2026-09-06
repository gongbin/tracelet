import { translate, type Locale } from './index.js';
import type { MessageKey } from './zh-CN.js';

const keys: Record<string, MessageKey> = {
  blank: 'template.blank', esp32: 'template.esp32', stm32: 'template.stm32',
  arduino: 'template.arduino', demo: 'template.demo'
};
/** Localize built-in catalog entries by id, never infer translations from user project names. */
export function templateName(id: string, locale: Locale, fallback: string): string {
  return keys[id] ? translate(locale, keys[id]) : fallback;
}
