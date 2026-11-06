import { Download, ExternalLink, Play, Star, TriangleAlert, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { downloadHref, fetchGame, playHref } from '../lib/api';
import type { IndexedGame } from '../lib/filter';
import { formatBytes, formatReleaseDate, hueFor } from '../lib/format';
import type { GameDetail, SystemSummary } from '../types';
import { CartLabel } from './GameGrid';
import { SavesSection } from './SavesSection';

interface GameDrawerProps {
  game: IndexedGame;
  system?: SystemSummary;
  favorite: boolean;
  onToggleFavorite(): void;
  onClose(): void;
  toast(message: string, tone?: 'info' | 'error'): void;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')).filter(
    (el) => el.getClientRects().length > 0,
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

export function GameDrawer({ game, system, favorite, onToggleFavorite, onClose, toast }: GameDrawerProps) {
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    const controller = new AbortController();
    fetchGame(game.id, controller.signal)
      .then(setDetail)
      .catch((error: unknown) => {
        if ((error as Error).name !== 'AbortError') setLoadError(true);
      });
    return () => controller.abort();
  }, [game.id]);

  // Modal behaviour: initial focus, focus trap, Escape, scroll lock, focus restore.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus({ preventScroll: true });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'Tab' && panel.current) {
        const items = focusables(panel.current);
        if (!items.length) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus({ preventScroll: true });
    };
  }, [onClose]);

  const cover = detail?.media.cover ?? game.cover;
  const isolationMissing = Boolean(detail?.play?.threads) && !window.crossOriginIsolated;
  const canPlay = Boolean(detail?.play) && !isolationMissing;
  const biosMissing = detail ? detail.bios.required && !detail.bios.present : false;
  const released = formatReleaseDate(game.releaseDate);
  const systemName = detail?.systemName ?? system?.name ?? game.system;

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <div className="scrim-in absolute inset-0 bg-scrim backdrop-blur-[6px]" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-nav-scope
        className="drawer-in absolute inset-x-0 bottom-0 top-[max(2.5rem,env(safe-area-inset-top))] overflow-y-auto overscroll-contain rounded-t-2xl bg-surface shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:top-0 sm:w-[min(36rem,100vw)] sm:rounded-none sm:border-l sm:border-line"
      >
        <div className="relative isolate overflow-hidden">
          {cover && !coverFailed ? (
            <div className="drawer-bloom -z-10" style={{ backgroundImage: `url("${cover}")` }} aria-hidden />
          ) : (
            <div className="drawer-bloom drawer-bloom-label -z-10" style={{ ['--hue' as string]: hueFor(game.name) }} aria-hidden />
          )}

          <div className="flex justify-end p-3">
            <button ref={closeButton} type="button" data-nav className="btn-icon bg-glass backdrop-blur-md" onClick={onClose} aria-label="Close">
              <X size={20} aria-hidden />
            </button>
          </div>

          <div className="px-6 pb-6 sm:px-8">
            <div className="mx-auto w-44 sm:w-52">
              <div className="tile-cover shadow-2xl" style={{ aspectRatio: system?.coverAspect ?? 0.75 }}>
                {cover && !coverFailed ? (
                  <img src={cover} alt={`${game.name} cover`} onError={() => setCoverFailed(true)} />
                ) : (
                  <CartLabel name={game.name} system={system?.shortName ?? game.system} />
                )}
              </div>
            </div>

            <h2 id={titleId} className="type-display mt-7 text-balance text-[clamp(1.6rem,1.2rem+1.6vw,2.15rem)]">
              {game.name}
            </h2>
            <p className="mt-2 text-[0.9375rem] text-muted">
              {systemName}
              {game.year ? `, ${game.year}` : ''}
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              {detail?.play || !detail ? (
                <a
                  href={canPlay ? playHref(game.id) : undefined}
                  data-nav
                  aria-disabled={!canPlay}
                  onClick={(event) => {
                    if (!canPlay) event.preventDefault();
                  }}
                  data-play
                  className="btn btn-primary min-w-36 flex-1 sm:flex-none"
                >
                  <Play size={18} fill="currentColor" aria-hidden /> Play
                </a>
              ) : null}
              {detail?.download && (
                <a href={downloadHref(detail.download.url)} data-nav className={`btn ${detail.play ? 'btn-secondary' : 'btn-primary flex-1 sm:flex-none'}`} download>
                  <Download size={18} aria-hidden /> Download {detail.multiFile ? 'game (.zip)' : 'ROM'}
                </a>
              )}
              <button
                type="button"
                data-nav
                className="btn btn-secondary"
                aria-pressed={favorite}
                onClick={() => {
                  onToggleFavorite();
                  toast(favorite ? `Removed ${game.name} from favorites.` : `Added ${game.name} to favorites.`);
                }}
              >
                <Star size={18} aria-hidden fill={favorite ? 'currentColor' : 'none'} className={favorite ? 'text-warn' : ''} />
                {favorite ? 'Favorite' : 'Add to favorites'}
              </button>
            </div>

            <div className="mt-5 space-y-2">
              {loadError && <p className="notice notice-warn">Couldn&rsquo;t load the details for this game. Check the connection and reopen it.</p>}
              {detail?.unplayableReason && <p className="notice notice-info">{detail.unplayableReason}</p>}
              {isolationMissing && (
                <p className="notice notice-warn">
                  <TriangleAlert size={18} className="shrink-0 text-warn" aria-hidden />
                  <span>
                    This emulator needs a secure connection. Open Retroshelf through your HTTPS reverse proxy, or at localhost on the machine running
                    it.
                  </span>
                </p>
              )}
              {biosMissing && detail && (
                <p className="notice notice-warn">
                  <TriangleAlert size={18} className="shrink-0 text-warn" aria-hidden />
                  <span>
                    {systemName} needs a BIOS. Add {detail.bios.expected?.[0] ?? 'the BIOS file'} to <code>/library/bios/{game.system}</code>, then
                    rescan.
                  </span>
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-8 px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-8">
          {detail?.description ? (
            <p className="max-w-[65ch] whitespace-pre-line text-[0.9375rem] leading-relaxed">{detail.description}</p>
          ) : !detail && !loadError ? (
            <div className="space-y-2" aria-hidden>
              <div className="h-3.5 w-full animate-pulse rounded bg-raised" />
              <div className="h-3.5 w-11/12 animate-pulse rounded bg-raised" />
              <div className="h-3.5 w-2/3 animate-pulse rounded bg-raised" />
            </div>
          ) : null}

          <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-6 gap-y-2 text-sm">
            {game.developer && <Detail label="Developer">{game.developer}</Detail>}
            {game.publisher && <Detail label="Publisher">{game.publisher}</Detail>}
            {released && <Detail label="Released">{released}</Detail>}
            {game.genres && <Detail label="Genre">{game.genres.join(', ')}</Detail>}
            {game.players && <Detail label="Players">{game.players}</Detail>}
            {game.rating !== undefined && <Detail label="Rating">{`${Number((game.rating * 5).toFixed(1))} out of 5`}</Detail>}
            <Detail label="File">
              {game.fileName}
              <span className="text-muted">, {formatBytes(game.size)}</span>
            </Detail>
          </dl>

          {detail?.media.screenshot && detail.media.screenshot !== cover && (
            <img src={detail.media.screenshot} alt={`${game.name} screenshot`} loading="lazy" className="w-full rounded-xl bg-black object-contain" />
          )}

          {detail?.setup && !detail.play && (
            <section aria-label="Setup">
              <h3 className="text-sm font-semibold">Play it with {detail.setup.emulator}</h3>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-[0.9375rem] leading-relaxed marker:text-muted">
                {detail.setup.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              {detail.setup.url && (
                <a href={detail.setup.url} target="_blank" rel="noopener noreferrer" data-nav className="btn btn-quiet mt-3 -ml-3">
                  <ExternalLink size={16} aria-hidden /> Get {detail.setup.emulator}
                </a>
              )}
            </section>
          )}

          {detail && (detail.bios.files.length > 0 || detail.bios.required) && (
            <section aria-label="BIOS">
              <h3 className="text-sm font-semibold">BIOS</h3>
              {detail.bios.note && <p className="mt-1.5 text-sm text-muted">{detail.bios.note}</p>}
              {detail.bios.files.length === 0 ? (
                <p className="mt-1.5 text-sm text-muted">
                  None found in <code>/library/bios/{game.system}</code>
                  {detail.bios.expected ? `. Expected: ${detail.bios.expected.join(', ')}.` : '.'}
                </p>
              ) : (
                <ul className="mt-3 space-y-1">
                  {detail.bios.bundle && (
                    <li>
                      <a href={downloadHref(detail.bios.bundle.url)} data-nav download className="btn btn-quiet -ml-3">
                        <Download size={16} aria-hidden /> All BIOS files (.zip)
                      </a>
                    </li>
                  )}
                  {detail.bios.files.map((file) => (
                    <li key={file.url}>
                      <a href={downloadHref(file.url)} data-nav download className="btn btn-quiet -ml-3 max-w-full">
                        <Download size={16} aria-hidden className="shrink-0" />
                        <span className="truncate">{file.name}</span>
                        <span className="text-xs text-muted">{formatBytes(file.size)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {detail && detail.files.length > 1 && (
            <details className="group">
              <summary className="cursor-pointer text-sm font-semibold" data-nav>
                Files in this game ({detail.files.length})
              </summary>
              <ul className="mt-2 space-y-1">
                {detail.files.map((file) => (
                  <li key={file.url}>
                    <a href={downloadHref(file.url)} data-nav download className="btn btn-quiet -ml-3 max-w-full">
                      <Download size={16} aria-hidden className="shrink-0" />
                      <span className="truncate">{file.name}</span>
                      <span className="text-xs text-muted">{formatBytes(file.size)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {(detail?.play || game.id) && system?.mode !== 'download' && <SavesSection gameId={game.id} gameName={game.name} toast={toast} />}
        </div>
      </div>
    </div>
  );
}
