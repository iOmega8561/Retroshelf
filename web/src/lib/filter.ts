import type { GameSummary } from '../types';
import type { SortKey } from './store';

export type Shelf = { kind: 'all' } | { kind: 'favorites' } | { kind: 'recent' } | { kind: 'system'; id: string };

export interface IndexedGame extends GameSummary {
  /** Lowercase, accent-free text searched by the query box. */
  haystack: string;
  decade?: number;
  genreKeys: string[];
}

export interface ActiveFilters {
  query: string;
  genres: string[];
  decade: number | null;
  sort: SortKey;
}

export function normalize(text: string): string {
  return text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function indexGames(games: GameSummary[]): IndexedGame[] {
  return games.map((game) => ({
    ...game,
    haystack: normalize([game.name, game.developer, game.publisher, game.fileName, ...(game.genres ?? [])].filter(Boolean).join(' ')),
    decade: game.year ? Math.floor(game.year / 10) * 10 : undefined,
    genreKeys: (game.genres ?? []).map((g) => g.toLowerCase()),
  }));
}

export function shelfGames(games: IndexedGame[], shelf: Shelf, favorites: Set<string>, recent: Record<string, number>): IndexedGame[] {
  switch (shelf.kind) {
    case 'all':
      return games;
    case 'favorites':
      return games.filter((g) => favorites.has(g.id));
    case 'recent':
      return games.filter((g) => recent[g.id] !== undefined);
    case 'system':
      return games.filter((g) => g.system === shelf.id);
  }
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function byName(a: IndexedGame, b: IndexedGame): number {
  return collator.compare(a.sortName, b.sortName);
}

/** Missing values always sort last, whichever direction is chosen. */
function byOptional(a: number | undefined, b: number | undefined, direction: 1 | -1): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return (a - b) * direction;
}

export function applyFilters(games: IndexedGame[], filters: ActiveFilters, recent: Record<string, number>): IndexedGame[] {
  const tokens = normalize(filters.query).split(/\s+/).filter(Boolean);
  const genres = filters.genres.map((g) => g.toLowerCase());

  const result = games.filter(
    (game) =>
      (filters.decade === null || game.decade === filters.decade) &&
      genres.every((genre) => game.genreKeys.includes(genre)) &&
      tokens.every((token) => game.haystack.includes(token)),
  );

  const compare: Record<SortKey, (a: IndexedGame, b: IndexedGame) => number> = {
    name: byName,
    'name-desc': (a, b) => byName(b, a),
    newest: (a, b) => byOptional(a.year, b.year, -1) || byName(a, b),
    oldest: (a, b) => byOptional(a.year, b.year, 1) || byName(a, b),
    rating: (a, b) => byOptional(a.rating, b.rating, -1) || byName(a, b),
    recent: (a, b) => byOptional(recent[a.id], recent[b.id], -1) || byName(a, b),
  };
  return result.sort(compare[filters.sort]);
}

export interface Facets {
  genres: Array<{ name: string; count: number }>;
  decades: Array<{ decade: number; count: number }>;
}

export function computeFacets(games: IndexedGame[]): Facets {
  const genres = new Map<string, { name: string; count: number }>();
  const decades = new Map<number, number>();
  for (const game of games) {
    for (const genre of game.genres ?? []) {
      const key = genre.toLowerCase();
      const entry = genres.get(key);
      if (entry) entry.count += 1;
      else genres.set(key, { name: genre, count: 1 });
    }
    if (game.decade) decades.set(game.decade, (decades.get(game.decade) ?? 0) + 1);
  }
  return {
    genres: [...genres.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 60),
    decades: [...decades.entries()].map(([decade, count]) => ({ decade, count })).sort((a, b) => a.decade - b.decade),
  };
}
