import { RefreshCw } from 'lucide-react';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from './components/EmptyState';
import { GameDrawer } from './components/GameDrawer';
import { GameGrid, GridSkeleton } from './components/GameGrid';
import { ShelfHeader, shelfTitle } from './components/ShelfHeader';
import { Sidebar } from './components/Sidebar';
import { useToast } from './components/Toasts';
import { Toolbar } from './components/Toolbar';
import { useControllers } from './hooks/useControllers';
import { moveFocus, useGamepadNav, type Direction } from './hooks/useGamepadNav';
import { useLibrary } from './hooks/useLibrary';
import { useRescan } from './hooks/useRescan';
import { useStore } from './hooks/useStore';
import { useTheme } from './hooks/useTheme';
import { useUrlState } from './hooks/useUrlState';
import { useI18n } from './i18n/react';

import { applyFilters, computeFacets, indexGames, shelfGames, type Shelf } from './lib/filter';
import { favoritesStore, prefsStore, recentStore, toggleFavorite, type SortKey } from './lib/store';

const ARROWS: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

export default function App() {
  const library = useLibrary();
  const prefs = useStore(prefsStore);
  const favoriteIds = useStore(favoritesStore);
  const recent = useStore(recentStore);
  const [url, setUrl] = useUrlState();
  const controllers = useControllers();
  const toast = useToast();
  const i18n = useI18n();
  const { t } = i18n;
  const { scanning, rescan } = useRescan(library.reload, toast);
  const [menuOpen, setMenuOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const openedByPush = useRef(false);
  useTheme(prefs.theme);

  const data = library.data;
  const favorites = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const systems = useMemo(() => data?.systems ?? [], [data]);
  const systemsById = useMemo(() => new Map(systems.map((s) => [s.id, s])), [systems]);
  const allGames = useMemo(() => indexGames(data?.games ?? []), [data]);
  const gamesById = useMemo(() => new Map(allGames.map((g) => [g.id, g])), [allGames]);

  const shelf: Shelf = useMemo(() => {
    if (url.view === 'favorites') return { kind: 'favorites' };
    if (url.view === 'recent') return { kind: 'recent' };
    if (url.system && systemsById.has(url.system)) return { kind: 'system', id: url.system };
    return { kind: 'all' };
  }, [url.view, url.system, systemsById]);
  const currentSystem = shelf.kind === 'system' ? systemsById.get(shelf.id) : undefined;

  const onShelf = useMemo(() => shelfGames(allGames, shelf, favorites, recent), [allGames, shelf, favorites, recent]);
  const facets = useMemo(() => computeFacets(onShelf), [onShelf]);
  const query = useDeferredValue(url.q);
  const sort: SortKey = shelf.kind === 'recent' ? 'recent' : prefs.sort;
  const visible = useMemo(
    () => applyFilters(onShelf, { query, genres: url.genres, decade: url.decade, sort }, recent),
    [onShelf, query, url.genres, url.decade, sort, recent],
  );
  const selected = url.game ? gamesById.get(url.game) : undefined;

  useEffect(() => {
    document.title = t('app.title', { shelf: shelfTitle(t, shelf, currentSystem) });
  }, [t, shelf, currentSystem]);

  /* ---------- navigation ---------- */

  const openGame = useCallback(
    (id: string) => {
      openedByPush.current = true;
      setUrl({ game: id }, 'push');
    },
    [setUrl],
  );

  const closeGame = useCallback(() => {
    if (openedByPush.current) {
      openedByPush.current = false;
      window.history.back();
    } else {
      setUrl({ game: null });
    }
  }, [setUrl]);

  const selectShelf = useCallback(
    (next: Shelf) => {
      setMenuOpen(false);
      setUrl(
        {
          system: next.kind === 'system' ? next.id : null,
          view: next.kind === 'favorites' || next.kind === 'recent' ? next.kind : null,
          genres: [],
          decade: null,
          game: null,
        },
        'push',
      );
      window.scrollTo({ top: 0 });
    },
    [setUrl],
  );

  const shelfOrder = useMemo<Shelf[]>(
    () => [{ kind: 'all' }, { kind: 'favorites' }, { kind: 'recent' }, ...systems.map((s): Shelf => ({ kind: 'system', id: s.id }))],
    [systems],
  );

  useGamepadNav(controllers.length > 0, {
    onBack: () => {
      if (selected) closeGame();
      else if (menuOpen) setMenuOpen(false);
      else if ((document.activeElement as HTMLElement | null)?.matches('input')) (document.activeElement as HTMLElement).blur();
    },
    onShelfStep: (step) => {
      if (selected) return;
      const index = shelfOrder.findIndex((s) => s.kind === shelf.kind && (s.kind !== 'system' || (shelf.kind === 'system' && s.id === shelf.id)));
      const next = shelfOrder[(index + step + shelfOrder.length) % shelfOrder.length];
      if (next) selectShelf(next);
    },
    onStart: () => {
      if (selected) document.querySelector<HTMLAnchorElement>('[data-play]:not([aria-disabled="true"])')?.click();
    },
    onSearch: () => searchRef.current?.focus(),
  });

  // "/" focuses search; arrow keys move between tiles like a controller would.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = target.matches('input, textarea, select, [contenteditable="true"]');
      if (event.key === '/' && !typing && !selected) {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (ARROWS[event.key] && target.classList.contains('tile') && !event.altKey && !event.metaKey) {
        event.preventDefault();
        moveFocus(ARROWS[event.key]!);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  /* ---------- view ---------- */

  const sidebar = (
    <Sidebar
      systems={systems}
      totalGames={allGames.length}
      favoritesCount={allGames.reduce((n, g) => n + (favorites.has(g.id) ? 1 : 0), 0)}
      recentCount={allGames.reduce((n, g) => n + (recent[g.id] !== undefined ? 1 : 0), 0)}
      shelf={shelf}
      onSelect={selectShelf}
      theme={prefs.theme}
      onTheme={(theme) => prefsStore.set((p) => ({ ...p, theme }))}
      locale={prefs.locale}
      onLocale={(locale) => prefsStore.set((p) => ({ ...p, locale }))}
      scanning={scanning}
      scannedAt={data?.scannedAt}
      onRescan={() => void rescan()}
      controllers={controllers}
    />
  );

  const clearFilters = () => setUrl({ q: '', genres: [], decade: null });
  const filtered = url.q.trim() !== '' || url.genres.length > 0 || url.decade !== null;

  let content;
  if (!data && (library.status === 'loading' || library.status === 'scanning')) {
    content =
      library.status === 'scanning' ? (
        <EmptyState title={t('empty.scanning.title')}>{t('empty.scanning.body')}</EmptyState>
      ) : (
        <GridSkeleton />
      );
  } else if (!data) {
    content = (
      <EmptyState
        title={t('empty.offline.title')}
        action={
          <button type="button" data-nav className="btn btn-primary" onClick={() => void library.reload()}>
            {t('empty.offline.retry')}
          </button>
        }
      >
        {t('empty.offline.body')}
      </EmptyState>
    );
  } else if (allGames.length === 0) {
    content = (
      <EmptyState
        title={t('empty.library.title')}
        action={
          <button type="button" data-nav className="btn btn-primary" onClick={() => void rescan()} disabled={scanning}>
            <RefreshCw size={16} aria-hidden className={scanning ? 'animate-spin-slow' : ''} /> {t('rescan.button')}
          </button>
        }
      >
        {t('empty.library.body')}
      </EmptyState>
    );
  } else if (onShelf.length === 0 && shelf.kind === 'favorites') {
    content = <EmptyState title={t('empty.favorites.title')}>{t('empty.favorites.body')}</EmptyState>;
  } else if (onShelf.length === 0 && shelf.kind === 'recent') {
    content = <EmptyState title={t('empty.recent.title')}>{t('empty.recent.body')}</EmptyState>;
  } else if (visible.length === 0) {
    content = (
      <EmptyState
        title={t('empty.filtered.title')}
        action={
          filtered ? (
            <button type="button" data-nav className="btn btn-secondary" onClick={clearFilters}>
              {t('filters.clear')}
            </button>
          ) : undefined
        }
      >
        {t('empty.filtered.body')}
      </EmptyState>
    );
  } else {
    content = (
      <GameGrid
        games={visible}
        systems={systemsById}
        favorites={favorites}
        density={prefs.density}
        showSystem={shelf.kind !== 'system'}
        onOpen={openGame}
      />
    );
  }

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <a href="#games" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[80] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2">
        {t('app.skip')}
      </a>

      <aside className="sticky top-0 hidden h-dvh border-r border-line bg-surface/50 lg:block">{sidebar}</aside>

      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={t('app.systemsDialog')}>
          <div className="scrim-in absolute inset-0 bg-scrim backdrop-blur-[6px]" onClick={() => setMenuOpen(false)} aria-hidden />
          <div className="panel-in-left absolute inset-y-0 left-0 w-[min(20rem,86vw)] bg-surface shadow-2xl" data-nav-scope>
            {sidebar}
          </div>
        </div>
      )}

      <main className="min-w-0">
        <Toolbar
          searchRef={searchRef}
          query={url.q}
          onQuery={(q) => setUrl({ q })}
          sort={sort}
          sortLocked={shelf.kind === 'recent'}
          onSort={(value) => prefsStore.set((p) => ({ ...p, sort: value }))}
          facets={facets}
          genres={url.genres}
          onGenres={(genres) => setUrl({ genres })}
          decade={url.decade}
          onDecade={(decade) => setUrl({ decade })}
          density={prefs.density}
          onDensity={(density) => prefsStore.set((p) => ({ ...p, density }))}
          onMenu={() => setMenuOpen(true)}
        />
        <ShelfHeader
          shelf={shelf}
          system={currentSystem}
          systemCount={systems.length}
          total={onShelf.length}
          visible={visible.length}
          genres={url.genres}
          decade={url.decade}
          query={url.q}
          onRemoveGenre={(genre) => setUrl({ genres: url.genres.filter((g) => g !== genre) })}
          onClearDecade={() => setUrl({ decade: null })}
          onClearAll={clearFilters}
        />
        <div id="games" className="px-4 pb-24 sm:px-6 lg:px-8">
          {content}
        </div>
      </main>

      {selected && (
        <GameDrawer
          key={selected.id}
          game={selected}
          system={systemsById.get(selected.system)}
          favorite={favorites.has(selected.id)}
          onToggleFavorite={() => toggleFavorite(selected.id)}
          onClose={closeGame}
          toast={toast}
        />
      )}
    </div>
  );
}


