import { CircleDashed, Gamepad2, History, LibraryBig, Monitor, Moon, RefreshCw, Star, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { shortControllerName } from '../hooks/useControllers';
import type { Shelf } from '../lib/filter';
import { formatCount, formatRelative } from '../lib/format';
import type { ThemePref } from '../lib/store';
import type { SystemSummary } from '../types';
import { Logo } from './Logo';

interface SidebarProps {
  systems: SystemSummary[];
  totalGames: number;
  favoritesCount: number;
  recentCount: number;
  shelf: Shelf;
  onSelect(shelf: Shelf): void;
  theme: ThemePref;
  onTheme(theme: ThemePref): void;
  scanning: boolean;
  scannedAt?: string;
  onRescan(): void;
  controllers: string[];
}

function ShelfButton({ active, onClick, children }: { active: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      data-nav
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[0.9375rem] transition-colors ${
        active ? 'bg-accent-soft font-semibold text-fg' : 'text-muted hover:bg-raised hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}

function Count({ value }: { value: number }) {
  return <span className="ml-auto pl-2 text-xs tabular-nums text-muted">{formatCount(value)}</span>;
}

const THEME_OPTIONS: Array<{ value: ThemePref; label: string; icon: typeof Sun }> = [
  { value: 'system', label: 'Match system', icon: Monitor },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun },
];

export function Sidebar(props: SidebarProps) {
  const { systems, shelf, onSelect } = props;
  const groups = new Map<string, SystemSummary[]>();
  for (const system of systems) groups.set(system.manufacturer, [...(groups.get(system.manufacturer) ?? []), system]);

  return (
    <nav aria-label="Library" className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 pb-5 pt-[max(1.5rem,env(safe-area-inset-top))]">
        <Logo className="size-8 rounded-[9px]" />
        <span className="type-display text-[1.3rem]">Retroshelf</span>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-3 pb-6">
        <div className="space-y-0.5">
          <ShelfButton active={shelf.kind === 'all'} onClick={() => onSelect({ kind: 'all' })}>
            <LibraryBig size={18} aria-hidden /> All games <Count value={props.totalGames} />
          </ShelfButton>
          <ShelfButton active={shelf.kind === 'favorites'} onClick={() => onSelect({ kind: 'favorites' })}>
            <Star size={18} aria-hidden /> Favorites <Count value={props.favoritesCount} />
          </ShelfButton>
          <ShelfButton active={shelf.kind === 'recent'} onClick={() => onSelect({ kind: 'recent' })}>
            <History size={18} aria-hidden /> Recently played <Count value={props.recentCount} />
          </ShelfButton>
        </div>

        {[...groups.entries()].map(([manufacturer, list]) => (
          <section key={manufacturer} aria-label={manufacturer}>
            <h2 className="px-3 pb-1.5 pt-6 text-xs font-semibold text-muted">{manufacturer}</h2>
            <div className="space-y-0.5">
              {list.map((system) => {
                const active = shelf.kind === 'system' && shelf.id === system.id;
                return (
                  <ShelfButton key={system.id} active={active} onClick={() => onSelect({ kind: 'system', id: system.id })}>
                    <span className={`type-wide w-14 shrink-0 truncate text-[0.8125rem] ${active ? 'text-accent-text' : ''}`}>{system.shortName}</span>
                    <span className="min-w-0 truncate" title={system.name}>
                      {system.name}
                    </span>
                    {system.mode === 'download' && (
                      <span title="Download only" className="shrink-0 text-muted">
                        <CircleDashed size={14} aria-hidden />
                        <span className="sr-only">, download only</span>
                      </span>
                    )}
                    <Count value={system.gameCount} />
                  </ShelfButton>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <footer className="space-y-4 border-t border-line px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
        {props.controllers.length > 0 && (
          <p className="flex items-center gap-2 text-sm">
            <span className="size-2 rounded-full bg-ok shadow-[0_0_8px_var(--color-ok)]" aria-hidden />
            <Gamepad2 size={16} aria-hidden className="text-muted" />
            <span className="truncate">{shortControllerName(props.controllers[0]!)} connected</span>
          </p>
        )}

        <div role="group" aria-label="Theme" className="flex rounded-lg bg-raised p-1">
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              data-nav
              aria-pressed={props.theme === value}
              title={label}
              aria-label={label}
              onClick={() => props.onTheme(value)}
              className={`flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-medium ${
                props.theme === value ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg'
              }`}
            >
              <Icon size={15} aria-hidden />
              <span aria-hidden>{value === 'system' ? 'Auto' : label}</span>
            </button>
          ))}
        </div>

        <div>
          <button type="button" data-nav className="btn btn-secondary w-full" onClick={props.onRescan} disabled={props.scanning}>
            <RefreshCw size={16} aria-hidden className={props.scanning ? 'animate-spin-slow' : ''} />
            {props.scanning ? 'Scanning\u2026' : 'Rescan library'}
          </button>
          {props.scannedAt && <p className="mt-2 text-center text-xs text-muted">Last scanned {formatRelative(Date.parse(props.scannedAt))}</p>}
        </div>
      </footer>
    </nav>
  );
}
