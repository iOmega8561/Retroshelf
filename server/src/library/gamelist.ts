import { XMLParser } from 'fast-xml-parser';

/** One <game> from an ES-DE / EmulationStation gamelist.xml, normalised. */
export interface GamelistEntry {
  path: string;
  name?: string;
  sortName?: string;
  description?: string;
  developer?: string;
  publisher?: string;
  genre?: string;
  players?: string;
  rating?: number;
  releaseDate?: string;
  year?: number;
  hidden: boolean;
  image?: string;
  thumbnail?: string;
  marquee?: string;
  video?: string;
  fanart?: string;
  titlescreen?: string;
  screenshot?: string;
  cover?: string;
}

const parser = new XMLParser({
  ignoreAttributes: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
  parseTagValue: false, // keep "0001" style values as strings
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
  isArray: (_name, jpath) => jpath === 'gameList.game',
});

function text(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // Elements with attributes or mixed content come back as objects: use their text node.
  if (typeof value === 'object' && '#text' in (value as Record<string, unknown>)) {
    return text((value as Record<string, unknown>)['#text']);
  }
  return undefined;
}

/** ES-DE stores dates as `19960927T000000`; some scrapers write `1996-09-27` or just `1996`. */
export function parseReleaseDate(raw: string | undefined): { date?: string; year?: number } {
  if (!raw) return {};
  const match = /^(\d{4})-?(\d{2})?-?(\d{2})?/.exec(raw.trim());
  if (!match) return {};
  const year = Number(match[1]);
  if (year < 1950 || year > 2100) return {};
  const month = match[2] && match[2] !== '00' ? match[2] : undefined;
  const day = month && match[3] && match[3] !== '00' ? match[3] : undefined;
  return { year, date: [String(year), month, day].filter(Boolean).join('-') };
}

function parseRating(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(Math.min(value, 1) * 100) / 100;
}

function parseBool(raw: string | undefined): boolean {
  return raw?.toLowerCase() === 'true' || raw === '1';
}

export function parseGamelist(xml: string): GamelistEntry[] {
  const doc = parser.parse(xml) as { gameList?: { game?: Array<Record<string, unknown>> } };
  const games = doc.gameList?.game ?? [];
  const entries: GamelistEntry[] = [];

  for (const raw of games) {
    if (!raw || typeof raw !== 'object') continue;
    const path = text(raw.path);
    if (!path) continue;
    const release = parseReleaseDate(text(raw.releasedate));
    entries.push({
      path,
      name: text(raw.name),
      sortName: text(raw.sortname),
      description: text(raw.desc),
      developer: text(raw.developer),
      publisher: text(raw.publisher),
      genre: text(raw.genre),
      players: text(raw.players),
      rating: parseRating(text(raw.rating)),
      releaseDate: release.date,
      year: release.year,
      hidden: parseBool(text(raw.hidden)),
      image: text(raw.image),
      thumbnail: text(raw.thumbnail),
      marquee: text(raw.marquee),
      video: text(raw.video),
      fanart: text(raw.fanart),
      titlescreen: text(raw.titlescreen),
      screenshot: text(raw.screenshot),
      cover: text(raw.cover) ?? text(raw.boxart),
    });
  }
  return entries;
}

/** "Platform / Action, Puzzle" → ["Platform", "Action", "Puzzle"] (deduplicated, case-insensitive). */
export function splitGenres(genre: string | undefined): string[] | undefined {
  if (!genre) return undefined;
  const seen = new Map<string, string>();
  for (const part of genre.split(/[/,;|]/)) {
    const trimmed = part.trim().replace(/\s+/g, ' ');
    if (trimmed && !seen.has(trimmed.toLowerCase())) seen.set(trimmed.toLowerCase(), trimmed);
  }
  return seen.size ? [...seen.values()] : undefined;
}

/** Lowercase, accent-free, leading article moved out of the way: "The Legend of Zelda" → "legend of zelda". */
export function sortKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
