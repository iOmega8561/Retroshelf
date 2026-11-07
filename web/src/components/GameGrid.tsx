import { Star } from 'lucide-react';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n/react';
import type { IndexedGame } from '../lib/filter';
import { hueFor } from '../lib/format';
import type { Density } from '../lib/store';
import type { SystemSummary } from '../types';

const PAGE = 120;

/** The cover's real proportions when the server measured them, else the typical box for its system. */
export function coverAspect(game: { coverAspect?: number }, system?: SystemSummary): number {
  return game.coverAspect ?? system?.coverAspect ?? 0.75;
}

interface Row {
  start: number;
  end: number;
  height: number;
  /** Last row: not stretched to the full width. */
  ragged: boolean;
}

/**
 * Justified rows (as in photo galleries): fill each row until its height would drop below the
 * target, then keep whichever break point lands closer to the target. Every cover keeps its own
 * proportions, rows span the full width, and heights stay close to the target. Covers of one
 * system share an aspect ratio, so their rows all come out identical.
 */
export function justifyRows(aspects: readonly number[], width: number, target: number, gap: number): Row[] {
  const rows: Row[] = [];
  let start = 0;
  while (start < aspects.length) {
    let sum = 0;
    let row: Row | null = null;
    for (let i = start; i < aspects.length; i += 1) {
      sum += aspects[i]!;
      const count = i - start + 1;
      const height = (width - gap * (count - 1)) / sum;
      if (height <= target) {
        const previous = count > 1 ? (width - gap * (count - 2)) / (sum - aspects[i]!) : Number.POSITIVE_INFINITY;
        row =
          Math.abs(previous - target) < Math.abs(height - target)
            ? { start, end: i - 1, height: previous, ragged: false }
            : { start, end: i, height, ragged: false };
        break;
      }
    }
    if (!row) row = { start, end: aspects.length - 1, height: target, ragged: true };
    rows.push(row);
    start = row.end + 1;
  }
  return rows;
}

interface GameGridProps {
  games: IndexedGame[];
  systems: Map<string, SystemSummary>;
  favorites: Set<string>;
  density: Density;
  showSystem: boolean;
  onOpen(id: string): void;
}

/**
 * Progressive rendering: tiles are added in pages as the sentinel nears the viewport, and
 * off-screen tiles use content-visibility, so even very large libraries stay responsive.
 */
export function GameGrid({ games, systems, favorites, density, showSystem, onOpen }: GameGridProps) {
  const { t } = useI18n();
  const [limit, setLimit] = useState(PAGE);
  const [width, setWidth] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => setLimit(PAGE), [games]);

  useLayoutEffect(() => {
    const node = container.current;
    if (!node) return;
    setWidth(node.clientWidth);
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || limit >= games.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setLimit((value) => Math.min(value + PAGE, games.length));
      },
      { rootMargin: '1200px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [limit, games.length]);

  const narrow = width > 0 && width < 480;
  const target = density === 'compact' ? (narrow ? 120 : 168) : narrow ? 168 : 232;
  const gap = narrow ? 14 : 20;
  const shown = games.slice(0, limit);
  const aspects = useMemo(() => shown.map((game) => coverAspect(game, systems.get(game.system))), [shown, systems]);
  const rows = useMemo(() => (width > 0 ? justifyRows(aspects, width, target, gap) : []), [aspects, width, target, gap]);

  return (
    <>
      <div ref={container} data-nav-scope className="shelf" role="list" aria-label={t('grid.label')} style={{ rowGap: narrow ? 20 : 28 }}>
        {rows.map((row) => (
          <div key={row.start} className="shelf-row" role="presentation" style={{ columnGap: gap }}>
            {shown.slice(row.start, row.end + 1).map((game, offset) => {
              const aspect = aspects[row.start + offset]!;
              return (
                <div key={game.id} role="listitem" className="min-w-0 shrink" style={{ width: row.height * aspect }}>
                  <GameTile
                    game={game}
                    system={systems.get(game.system)}
                    favorite={favorites.has(game.id)}
                    showSystem={showSystem}
                    aspect={aspect}
                    onOpen={onOpen}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {limit < games.length && <div ref={sentinel} className="h-px" aria-hidden />}
    </>
  );
}

interface TileProps {
  game: IndexedGame;
  system?: SystemSummary;
  favorite: boolean;
  showSystem: boolean;
  aspect: number;
  onOpen(id: string): void;
}

const GameTile = memo(function GameTile({ game, system, favorite, showSystem, aspect, onOpen }: TileProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const [failed, setFailed] = useState(false);
  const shortName = system?.shortName ?? game.system;
  return (
    <button type="button" data-nav className="tile group block w-full text-left" onClick={() => onOpen(game.id)}>
      <div className="tile-cover" style={{ aspectRatio: aspect }} data-fit={game.coverAspect ? 'exact' : undefined}>
        {game.cover && !failed ? (
          <img src={game.cover} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />
        ) : (
          <CartLabel name={game.name} system={shortName} />
        )}
        {favorite && (
          <span className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-glass text-warn backdrop-blur-md">
            <Star size={13} fill="currentColor" aria-hidden />
            <span className="sr-only">{t('grid.favorite')}</span>
          </span>
        )}
      </div>
      <span className="mt-2 line-clamp-2 text-[0.8125rem] font-medium leading-snug">{game.name}</span>
      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        {game.year && <span className="tabular-nums">{game.year}</span>}
        {showSystem && <span className="type-wide rounded border border-line px-1 text-[0.625rem] leading-4">{shortName}</span>}
        {game.extraCount ? (
          <span className="rounded bg-accent-soft px-1 text-[0.625rem] font-semibold leading-4 tabular-nums text-accent-text" title={i18n.plural('extras.badge', game.extraCount)}>
            +{i18n.number(game.extraCount)}
            <span className="sr-only">, {i18n.plural('extras.badge', game.extraCount)}</span>
          </span>
        ) : null}
        {system?.mode === 'download' && <span className="sr-only">{t('system.downloadOnly')}</span>}
      </span>
    </button>
  );
});

export function CartLabel({ name, system }: { name: string; system: string }) {
  return (
    <div className="cart-label" style={{ ['--hue' as string]: hueFor(name) }} aria-hidden>
      <span className="cart-label-name">{name}</span>
      <span className="cart-label-system type-wide">{system}</span>
    </div>
  );
}

export function GridSkeleton() {
  return (
    <div className="flex flex-wrap gap-5" aria-hidden>
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i} className="w-40">
          <div className="aspect-[3/4] animate-pulse rounded-md bg-raised" />
          <div className="mt-2 h-3 w-3/4 animate-pulse rounded bg-raised" />
        </div>
      ))}
    </div>
  );
}
