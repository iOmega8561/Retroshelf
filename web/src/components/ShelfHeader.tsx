import { X } from 'lucide-react';
import type { Translator } from '../i18n';
import { useI18n } from '../i18n/react';
import type { Shelf } from '../lib/filter';
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

export function shelfTitle(t: Translator['t'], shelf: Shelf, system?: SystemSummary): string {
  if (shelf.kind === 'favorites') return t('shelf.favorites');
  if (shelf.kind === 'recent') return t('shelf.recent');
  if (shelf.kind === 'system') return system?.name ?? t('shelf.system');
  return t('shelf.all');
}

function Chip({ label, removeLabel, onRemove }: { label: string; removeLabel: string; onRemove(): void }) {
  return (
    <button
      type="button"
      data-nav
      onClick={onRemove}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line bg-raised pl-3 pr-2 text-sm hover:border-accent"
      aria-label={removeLabel}
    >
      {label}
      <X size={14} aria-hidden className="text-muted" />
    </button>
  );
}

export function ShelfHeader(props: ShelfHeaderProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const { shelf, system } = props;
  const filtered = props.genres.length > 0 || props.decade !== null || props.query.trim() !== '';
  const subtitle =
    shelf.kind === 'system' && system
      ? [system.manufacturer === 'Other' ? t('manufacturer.other') : system.manufacturer, system.year].filter(Boolean).join(', ')
      : shelf.kind === 'favorites'
        ? t('shelf.favoritesHint')
        : shelf.kind === 'recent'
          ? t('shelf.recentHint')
          : i18n.plural('count.systems', props.systemCount);
  const needsIsolation = system?.requiresIsolation && !window.crossOriginIsolated;
  const decadeLabel = props.decade !== null ? t('decade', { decade: String(props.decade) }) : '';

  return (
    <header className="px-4 pb-6 pt-8 sm:px-6 lg:px-8 lg:pt-10">
      <h1 className="type-display text-balance text-[clamp(2rem,1.3rem+2.8vw,3.1rem)]">{shelfTitle(t, shelf, system)}</h1>
      <p className="mt-2.5 text-[0.9375rem] text-muted">{subtitle}</p>

      {system?.mode === 'download' && <p className="notice notice-info mt-5 max-w-2xl">{t('shelf.downloadOnly', { system: system.name })}</p>}
      {needsIsolation && system && <p className="notice notice-warn mt-5 max-w-2xl">{t('shelf.needsIsolation', { system: system.name })}</p>}

      <div className="mt-5 flex flex-wrap items-center gap-2" aria-live="polite">
        <span className="mr-1 text-sm tabular-nums text-muted">
          {filtered ? i18n.plural('shelf.filtered', props.total, { visible: props.visible }) : i18n.plural('count.games', props.total)}
        </span>
        {props.genres.map((genre) => (
          <Chip key={genre} label={i18n.genre(genre)} removeLabel={t('filters.remove', { label: i18n.genre(genre) })} onRemove={() => props.onRemoveGenre(genre)} />
        ))}
        {props.decade !== null && <Chip label={decadeLabel} removeLabel={t('filters.remove', { label: decadeLabel })} onRemove={props.onClearDecade} />}
        {filtered && (
          <button type="button" data-nav className="btn-quiet min-h-8 rounded-full text-sm" onClick={props.onClearAll}>
            {t('filters.clear')}
          </button>
        )}
      </div>
    </header>
  );
}
