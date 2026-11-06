import { isLocale, type LocalePref } from '../i18n';

/**
 * Tiny persisted stores on top of localStorage, shared by the library and the player.
 * Framework-free on purpose (the player page doesn't ship React); see hooks/useStore.ts.
 */

type Listener = () => void;

export interface Store<T> {
  get(): T;
  set(next: T | ((previous: T) => T)): void;
  subscribe(listener: Listener): () => void;
}

export function persistedStore<T>(key: string, fallback: T, validate: (raw: unknown) => T): Store<T> {
  const listeners = new Set<Listener>();
  const read = (): T => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : validate(JSON.parse(raw));
    } catch {
      return fallback;
    }
  };
  let value = read();

  // Keep tabs (and the player window) in sync.
  window.addEventListener('storage', (event) => {
    if (event.key !== key) return;
    value = read();
    listeners.forEach((listener) => listener());
  });

  return {
    get: () => value,
    set(next) {
      value = typeof next === 'function' ? (next as (previous: T) => T)(value) : next;
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* storage full or disabled: keep the in-memory value */
      }
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/* ---------------- Preferences ---------------- */

export type ThemePref = 'system' | 'dark' | 'light';
export type SortKey = 'name' | 'name-desc' | 'newest' | 'oldest' | 'rating' | 'recent';
export type Density = 'comfortable' | 'compact';

export interface Prefs {
  theme: ThemePref;
  sort: SortKey;
  density: Density;
  /** `auto` follows the browser/system language, falling back to English. */
  locale: LocalePref;
}

const THEMES: ThemePref[] = ['system', 'dark', 'light'];
const SORTS: SortKey[] = ['name', 'name-desc', 'newest', 'oldest', 'rating', 'recent'];
const DEFAULT_PREFS: Prefs = { theme: 'system', sort: 'name', density: 'comfortable', locale: 'auto' };

/** Key read by the inline theme script in index.html before first paint. */
export const prefsStore = persistedStore<Prefs>('retroshelf:prefs', DEFAULT_PREFS, (raw) => {
  const value = (raw ?? {}) as Partial<Prefs>;
  return {
    theme: THEMES.includes(value.theme as ThemePref) ? (value.theme as ThemePref) : DEFAULT_PREFS.theme,
    sort: SORTS.includes(value.sort as SortKey) ? (value.sort as SortKey) : DEFAULT_PREFS.sort,
    density: value.density === 'compact' ? 'compact' : 'comfortable',
    locale: isLocale(value.locale) ? value.locale : 'auto',
  };
});

/* ---------------- Favorites & recently played ---------------- */

export const favoritesStore = persistedStore<string[]>('retroshelf:favorites', [], (raw) =>
  Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string').slice(0, 5000) : [],
);

export function toggleFavorite(id: string): boolean {
  const isFavorite = favoritesStore.get().includes(id);
  favoritesStore.set((list) => (isFavorite ? list.filter((x) => x !== id) : [id, ...list]));
  return !isFavorite;
}

const RECENT_LIMIT = 100;
export const recentStore = persistedStore<Record<string, number>>('retroshelf:recent', {}, (raw) => {
  if (!raw || typeof raw !== 'object') return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number'));
});

export function markPlayed(id: string): void {
  recentStore.set((recent) => {
    const entries = Object.entries({ ...recent, [id]: Date.now() }).sort((a, b) => b[1] - a[1]);
    return Object.fromEntries(entries.slice(0, RECENT_LIMIT));
  });
}
