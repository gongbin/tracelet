import type { Locale } from './catalog.js';

/** Use the user's locale for relative times rather than translating Chinese time fragments. */
export function relativeTime(timestamp: number, locale: Locale, now = Date.now()): string {
  if (!Number.isFinite(timestamp)) return '';
  const seconds = Math.min(0, Math.round((timestamp - now) / 1000));
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (seconds > -60) return formatter.format(0, 'second');
  if (seconds > -3600) return formatter.format(Math.ceil(seconds / 60), 'minute');
  if (seconds > -86400) return formatter.format(Math.ceil(seconds / 3600), 'hour');
  if (seconds > -604800) return formatter.format(Math.ceil(seconds / 86400), 'day');
  return new Intl.DateTimeFormat(locale).format(timestamp);
}
