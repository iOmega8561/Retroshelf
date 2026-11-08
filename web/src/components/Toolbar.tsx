import { Grid2x2, Grid3x3, Menu, Search } from 'lucide-react';
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useI18n } from '../i18n/react';
import type { Facets } from '../lib/filter';
import type { Density, SortKey } from '../lib/store';
import { GenreFilter } from './GenreFilter';
import { Picker } from './Picker';

interface ToolbarProps {
  searchRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQuery(value: string): void;
  sort: SortKey;
  sortLocked: boolean;
  onSort(value: SortKey): void;
  facets: Facets;
  genres: string[];
  onGenres(value: string[]): void;
  decade: number | null;
  onDecade(value: number | null): void;
  density: Density;
  onDensity(value: Density): void;
  onMenu(): void;
}

const SORT_KEYS: SortKey[] = ['name', 'name-desc', 'newest', 'oldest', 'rating', 'recent'];

export function Toolbar(props: ToolbarProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const bar = useRef<HTMLDivElement>(null);

  // Publish the toolbar's height, so focus scrolling keeps rows clear of it (see app.css).
  useLayoutEffect(() => {
    const node = bar.current;
    if (!node) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty('--toolbar-height', `${node.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node, { box: 'border-box' });
    return () => {
      observer.disconnect();
      root.style.removeProperty('--toolbar-height');
    };
  }, []);

  return (
    <div ref={bar} className="sticky top-0 z-30 border-b border-line bg-glass pt-[env(safe-area-inset-top)] backdrop-blur-xl backdrop-saturate-150">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-6 lg:px-8">
        <button type="button" data-nav className="btn-icon lg:hidden" onClick={props.onMenu} aria-label={t('toolbar.showSystems')}>
          <Menu size={20} aria-hidden />
        </button>

        <label className="field flex min-w-0 flex-1 basis-48 items-center gap-2 px-3">
          <Search size={18} aria-hidden className="shrink-0 text-muted" />
          <input
            ref={props.searchRef}
            type="search"
            data-nav
            value={props.query}
            onChange={(event) => props.onQuery(event.target.value)}
            placeholder={t('toolbar.searchPlaceholder')}
            aria-label={t('toolbar.searchLabel')}
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent py-2 outline-none placeholder:text-muted"
          />
          <kbd className="hidden rounded border border-line px-1.5 text-xs text-muted md:inline" aria-hidden>
            /
          </kbd>
        </label>

        <div className="-mx-1 flex w-full items-center gap-2 overflow-x-auto px-1 md:mx-0 md:w-auto md:overflow-visible md:px-0">
          <Picker
            label={t('toolbar.sortLabel')}
            options={SORT_KEYS.map((key) => ({ value: key, label: t(`sort.${key}`) }))}
            value={props.sort}
            onChange={(value) => props.onSort(value as SortKey)}
            disabled={props.sortLocked}
            title={props.sortLocked ? t('toolbar.sortLocked') : undefined}
          />

          <GenreFilter options={props.facets.genres} selected={props.genres} onChange={props.onGenres} />

          <Picker
            label={t('toolbar.decadeLabel')}
            options={[
              { value: '', label: t('toolbar.anyYear') },
              ...props.facets.decades.map(({ decade, count }) => ({
                value: String(decade),
                label: t('decade', { decade: String(decade) }),
                detail: i18n.number(count),
              })),
            ]}
            value={props.decade === null ? '' : String(props.decade)}
            onChange={(value) => props.onDecade(value ? Number(value) : null)}
            disabled={!props.facets.decades.length}
          />

          <button
            type="button"
            data-nav
            className="btn-icon"
            aria-pressed={props.density === 'compact'}
            aria-label={t('toolbar.compact')}
            title={t('toolbar.compact')}
            onClick={() => props.onDensity(props.density === 'compact' ? 'comfortable' : 'compact')}
          >
            {props.density === 'compact' ? <Grid3x3 size={19} aria-hidden /> : <Grid2x2 size={19} aria-hidden />}
          </button>
        </div>
      </div>
    </div>
  );
}
