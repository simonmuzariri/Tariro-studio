/**
 * Translation scaffolding (IDE_DESIGN.md M5). English is the source catalogue; a locale is a
 * partial map of the same keys, and anything missing falls back to English.
 *
 * To add a language: create `<code>.ts` exporting `Partial<Record<MessageKey, string>>`, add it
 * to LOCALES, and translate keys in any order. `npm test` checks that locales only use known
 * keys and keep the same {placeholders}.
 */
import { en, type MessageKey } from './en';

export type { MessageKey };
export type Locale = Partial<Record<MessageKey, string>>;

export const LOCALES: Record<string, Locale> = { en };

let active: Locale = en;

/** Pick the best available locale for a BCP-47 tag ("sn-ZW" → "sn"); returns the code in use. */
export function setLocale(tag: string): string {
  const code = [tag, tag.split('-')[0]!].find((c) => c in LOCALES) ?? 'en';
  active = LOCALES[code]!;
  return code;
}

export function t(key: MessageKey, vars: Record<string, string | number> = {}): string {
  const template = active[key] ?? en[key];
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

if (typeof navigator !== 'undefined') setLocale(navigator.language);
