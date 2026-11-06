import { X } from 'lucide-react';
import type { Shelf } from '../lib/filter';
import { formatCount, plural } from '../lib/format';
import type { SystemSummary } from '../types';

interface ShelfHeaderProps {
  shelf: Shelf;
  system?: SystemSummary;
  systemCount: number;
  total: number;
  visible: number;
  genres: string[];
  decade: number | null;
  query: string;
  onRemoveGenre(genre: string): void;
  onClearDecade(): void;
  onClearAll(): void;
}

export function shelfTitle(shelf: Shelf, system?: SystemSummary): string {
  if (shelf.kind === 'favorites') return 'Favorites';
  if (shelf.kind === 'recent') return 'Recently played';
  if (shelf.kind === 'system') return system?.name ?? 'System';
  return 'All games';
}

function Chip({ label, onRemove }: { label: string; onRemove(): void }) {
  return (
    <button
      type="button"
      data-nav
      onClick={onRemove}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line bg-raised pl-3 pr-2 text-sm hover:border-accent"
      aria-label={`Remove filter ${label}`}
    >
      {label}
      <X size={14} aria-hidden className="text-muted" />
    </button>
  );
}

export function ShelfHeader(props: ShelfHeaderProps) {
  const { shelf, system } = props;
  const filtered = props.genres.length > 0 || props.decade !== null || props.query.trim() !== '';
  const subtitle =
    shelf.kind === 'system' && system
      ? [system.manufacturer, system.year].filter(Boolean).join(', ')
      : shelf.kind === 'favorites'
        ? 'Games you starred on this device.'
        : shelf.kind === 'recent'
          ? 'Most recently played first, on this device.'
          : plural(props.systemCount, 'system', 'systems');
  const needsIsolation = system?.requiresIsolation && !window.crossOriginIsolated;

  return (
    <header className="px-4 pb-6 pt-8 sm:px-6 lg:px-8 lg:pt-10">
      <h1 className="type-display text-balance text-[clamp(2rem,1.3rem+2.8vw,3.1rem)]">{shelfTitle(shelf, system)}</h1>
      <p className="mt-2.5 text-[0.9375rem] text-muted">{subtitle}</p>

      {system?.mode === 'download' && (
        <p className="notice notice-info mt-5 max-w-2xl">
          {system.name} games can&rsquo;t run in a browser. Open a game to download it, with setup steps for a desktop emulator.
        </p>
      )}
      {needsIsolation && (
        <p className="notice notice-warn mt-5 max-w-2xl">
          {system?.name} games need a secure connection to run here. Open Retroshelf through your HTTPS reverse proxy, or on this machine at
          localhost.
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2" aria-live="polite">
        <span className="mr-1 text-sm tabular-nums text-muted">
          {filtered ? `${formatCount(props.visible)} of ${plural(props.total, 'game', 'games')}` : plural(props.total, 'game', 'games')}
        </span>
        {props.genres.map((genre) => (
          <Chip key={genre} label={genre} onRemove={() => props.onRemoveGenre(genre)} />
        ))}
        {props.decade !== null && <Chip label={`${props.decade}s`} onRemove={props.onClearDecade} />}
        {filtered && (
          <button type="button" data-nav className="btn-quiet min-h-8 rounded-full text-sm" onClick={props.onClearAll}>
            Clear filters
          </button>
        )}
      </div>
    </header>
  );
}
