# UI localization

Supported locales: `zh-CN`, `zh-TW`, `en`, `ja`, `ko`, `de`, `fr`, `es`, `pt-BR`, `hi`.

- `catalog.ts`: native language names, browser locale matching, dictionaries.
- `zh-CN.ts`: semantic source keys. `en.ts` and `locales/*.json` provide translations.
- New components should use `useT()`; keep user names, project names and board text in `data-no-translate` elements.
- `auto.ts` handles existing hardcoded Chinese UI text using `dict-en.ts` and `locales/*-legacy.json`. Switching languages restores the original strings, including attributes, without remounting the editor or changing project data.
- `DiagnosticText` renders changing DRC/ERC messages explicitly. `format.ts` formats relative dates via `Intl`.
- Missing translations fall back to English, then the source string. All semantic keys are translated in the added locales; legacy editor instructions, some diagnostic explanations and advanced dialogs still have English fallbacks. Native-speaker terminology review remains desirable.
- Traditional Chinese legacy translations were initially generated with the macOS Foundation Simplified–Traditional transform; subsequent edits can be made directly in the JSON files. No conversion service is called at runtime.
- `test/localization.test.tsx` checks key/placeholder coverage, locale matching, preference controls and reversible legacy translation. Add regression cases when migrating legacy strings.

Translation files ship with the application. Language changes work offline; no project data or text is sent to a translation service.
