import { en } from './en';
import { it } from './it';

/**
 * Framework-free i18n shared by the library (React) and the player page.
 * Locale = first supported language in the browser's preference list, falling back to English;
 * a manual choice in the sidebar overrides it.
 */

export type Locale = 'en' | 'it';
export type LocalePref = 'auto' | Locale;
export const LOCALES: readonly Locale[] = ['en', 'it'];
/** Language names are always written in their own language. */
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', it: 'Italiano' };
/** EmulatorJS localisation file (data/localization/<name>.json) for its own menus. */
export const EJS_LANGUAGE: Record<Locale, string> = { en: 'en-US', it: 'it-IT' };

type Reference = typeof en;
export type Messages = { readonly [K in keyof Reference]: Reference[K] extends readonly string[] ? readonly string[] : string };

type StringKey = { [K in keyof Reference]: Reference[K] extends string ? K : never }[keyof Reference];
export type ListKey = { [K in keyof Reference]: Reference[K] extends readonly string[] ? K : never }[keyof Reference];
export type PluralKey = { [K in StringKey]: K extends `${infer Base}_other` ? Base : never }[StringKey];
export type MessageKey = Exclude<StringKey, `${string}_one` | `${string}_other`>;
export type Params = Record<string, string | number>;

const DICTIONARIES: Record<Locale, Messages> = { en, it };

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'it';
}

export function detectLocale(): Locale {
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of preferred) {
    const base = tag?.toLowerCase().split('-')[0];
    if (isLocale(base)) return base;
  }
  return 'en';
}

export function resolveLocale(pref: LocalePref): Locale {
  return pref === 'auto' ? detectLocale() : pref;
}

export interface Translator {
  locale: Locale;
  t(key: MessageKey, params?: Params): string;
  plural(key: PluralKey, count: number, params?: Params): string;
  list(key: ListKey): readonly string[];
  number(value: number): string;
  bytes(bytes: number): string;
  /** "2001-09-10" → "10 September 2001" / "10 settembre 2001"; "1996" stays "1996". */
  date(value: string | undefined): string | undefined;
  relative(timestamp: number): string;
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function createTranslator(locale: Locale): Translator {
  const dictionary = DICTIONARIES[locale] as Record<string, string | readonly string[]>;
  const fallback = en as Record<string, string | readonly string[]>;
  const numbers = new Intl.NumberFormat(locale);
  const decimals = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const plurals = new Intl.PluralRules(locale);
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  const lookup = (key: string): string => {
    const value = dictionary[key] ?? fallback[key];
    return typeof value === 'string' ? value : key;
  };
  // Numbers are localised ("1.204" in Italian); pass years and decades as strings.
  const interpolate = (template: string, params?: Params): string =>
    params
      ? template.replace(/\{(\w+)\}/g, (match, name: string) => {
          const value = params[name];
          return value === undefined ? match : typeof value === 'number' ? numbers.format(value) : value;
        })
      : template;

  return {
    locale,
    t: (key, params) => interpolate(lookup(key), params),
    plural: (key, count, params) => {
      const specific = dictionary[`${key}_${plurals.select(count)}`];
      const template = typeof specific === 'string' ? specific : lookup(`${key}_other`);
      return interpolate(template, { ...params, count });
    },
    list: (key) => {
      const value = dictionary[key] ?? fallback[key];
      return Array.isArray(value) ? value : [];
    },
    number: (value) => numbers.format(value),
    bytes: (bytes) => {
      let value = bytes;
      let unit = 0;
      while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
        value /= 1024;
        unit += 1;
      }
      return `${value >= 100 || unit === 0 ? numbers.format(Math.round(value)) : decimals.format(value)} ${BYTE_UNITS[unit]}`;
    },
    date: (value) => {
      if (!value) return undefined;
      const [year, month, day] = value.split('-').map(Number);
      if (!year) return undefined;
      if (!month) return String(year);
      const options: Intl.DateTimeFormatOptions = day ? { year: 'numeric', month: 'long', day: 'numeric' } : { year: 'numeric', month: 'long' };
      return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(Date.UTC(year, month - 1, day || 1));
    },
    relative: (timestamp) => {
      const seconds = Math.round((timestamp - Date.now()) / 1000);
      const abs = Math.abs(seconds);
      if (abs < 60) return relative.format(seconds, 'second');
      if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
      if (abs < 86400) return relative.format(Math.round(seconds / 3600), 'hour');
      if (abs < 86400 * 30) return relative.format(Math.round(seconds / 86400), 'day');
      return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(timestamp);
    },
  };
}
