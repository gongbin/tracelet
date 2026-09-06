import { usePrefs } from './index.js';
import { translateText } from './auto.js';

/** Render kernel diagnostics in the selected language, including updates to existing rows. */
export function DiagnosticText({ children }: { children: string }) {
  const locale = usePrefs((s) => s.locale);
  return <span data-no-translate>{translateText(children, locale)}</span>;
}
