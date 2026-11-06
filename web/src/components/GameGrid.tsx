import { Star } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/react';
import type { IndexedGame } from '../lib/filter';
import { hueFor } from '../lib/format';
import type { Density } from '../lib/store';
import type { SystemSummary } from '../types';

const PAGE = 120;

interface GameGridProps {
  games: IndexedGame[];
  systems: Map<string, SystemSummary>;
  favorites: Set<string>;
  density: Density;
  showSystem: boolean;
  /** Tile aspect for a single-system shelf; mixed shelves use 3:4. */
  aspect: number;
  onOpen(id: string): void;
}

/**
 * Progressive rendering: tiles are added in pages as the sentinel nears the viewport, and
 * off-screen tiles use content-visibility, so even very large libraries stay responsive.
 */
export function GameGrid({ games, systems, favorites, density, showSystem, aspect, onOpen }: GameGridProps) {
  const { t } = useI18n();
  const [limit, setLimit] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => setLimit(PAGE), [games]);

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

  return (
    <>
      <ul className="shelf-grid" data-density={density} aria-label={t('grid.label')}>
        {games.slice(0, limit).map((game) => (
          <li key={game.id}>
            <GameTile
              game={game}
              system={systems.get(game.system)}
              favorite={favorites.has(game.id)}
              showSystem={showSystem}
              aspect={aspect}
              onOpen={onOpen}
            />
          </li>
        ))}
      </ul>
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
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  const shortName = system?.shortName ?? game.system;
  return (
    <button type="button" data-nav className="tile group block w-full text-left" onClick={() => onOpen(game.id)}>
      <div className="tile-cover" style={{ aspectRatio: aspect }}>
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
      <span className="mt-0.5 flex items-center gap-2 text-xs text-muted">
        {game.year && <span className="tabular-nums">{game.year}</span>}
        {showSystem && <span className="type-wide rounded border border-line px-1 text-[0.625rem] leading-4">{shortName}</span>}
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
    <ul className="shelf-grid" aria-hidden>
      {Array.from({ length: 18 }, (_, i) => (
        <li key={i}>
          <div className="aspect-[3/4] animate-pulse rounded-md bg-raised" />
          <div className="mt-2 h-3 w-3/4 animate-pulse rounded bg-raised" />
        </li>
      ))}
    </ul>
  );
}
