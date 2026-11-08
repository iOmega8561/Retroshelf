import { ChevronUp, CircleDashed, Gamepad2, History, Languages, LibraryBig, Monitor, Moon, RefreshCw, Settings, Star, Sun } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { controllerName } from '../lib/controllers';
import { LOCALE_NAMES, LOCALES, type LocalePref } from '../i18n';
import { useI18n } from '../i18n/react';
import type { Shelf } from '../lib/filter';
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
  locale: LocalePref;
  onLocale(locale: LocalePref): void;
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

export function Sidebar(props: SidebarProps) {
  const { systems, shelf, onSelect } = props;
  const i18n = useI18n();
  const { t } = i18n;
  // Theme, language and rescan are rarely needed: keep them folded away so the shelves get the room.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsId = useId();
  const count = (value: number) => <span className="ml-auto pl-2 text-xs tabular-nums text-muted">{i18n.number(value)}</span>;

  const groups = new Map<string, SystemSummary[]>();
  for (const system of systems) groups.set(system.manufacturer, [...(groups.get(system.manufacturer) ?? []), system]);

  const themes: Array<{ value: ThemePref; label: string; short: string; icon: typeof Sun }> = [
    { value: 'system', label: t('theme.system'), short: t('theme.auto'), icon: Monitor },
    { value: 'dark', label: t('theme.dark'), short: t('theme.dark'), icon: Moon },
    { value: 'light', label: t('theme.light'), short: t('theme.light'), icon: Sun },
  ];

  return (
    <nav aria-label={t('nav.library')} className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 pb-5 pt-[max(1.5rem,env(safe-area-inset-top))]">
        <Logo className="size-8 rounded-[9px]" />
        <span className="type-display text-[1.3rem]">Retroshelf</span>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-3 pb-6">
        <div className="space-y-0.5">
          <ShelfButton active={shelf.kind === 'all'} onClick={() => onSelect({ kind: 'all' })}>
            <LibraryBig size={18} aria-hidden /> {t('shelf.all')} {count(props.totalGames)}
          </ShelfButton>
          <ShelfButton active={shelf.kind === 'favorites'} onClick={() => onSelect({ kind: 'favorites' })}>
            <Star size={18} aria-hidden /> {t('shelf.favorites')} {count(props.favoritesCount)}
          </ShelfButton>
          <ShelfButton active={shelf.kind === 'recent'} onClick={() => onSelect({ kind: 'recent' })}>
            <History size={18} aria-hidden /> {t('shelf.recent')} {count(props.recentCount)}
          </ShelfButton>
        </div>

        {[...groups.entries()].map(([manufacturer, list]) => {
          const heading = manufacturer === 'Other' ? t('manufacturer.other') : manufacturer;
          return (
            <section key={manufacturer} aria-label={heading}>
              <h2 className="px-3 pb-1.5 pt-6 text-xs font-semibold text-muted">{heading}</h2>
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
                        <span title={t('system.downloadOnly')} className="shrink-0 text-muted">
                          <CircleDashed size={14} aria-hidden />
                          <span className="sr-only">, {t('system.downloadOnly')}</span>
                        </span>
                      )}
                      {count(system.gameCount)}
                    </ShelfButton>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <footer className="space-y-3 border-t border-line px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
        {props.controllers.length > 0 && (
          <p className="flex items-center gap-2 text-sm">
            <span className="size-2 rounded-full bg-ok shadow-[0_0_8px_var(--color-ok)]" aria-hidden />
            <Gamepad2 size={16} aria-hidden className="text-muted" />
            <span className="truncate">{t('controller.connected', { name: controllerName(props.controllers[0]!) ?? t('controller.generic') })}</span>
          </p>
        )}

        <div id={settingsId} hidden={!settingsOpen} className="space-y-3">
          <div role="group" aria-label={t('theme.label')} className="flex rounded-lg bg-raised p-1">
            {themes.map(({ value, label, short, icon: Icon }) => (
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
                <span aria-hidden>{short}</span>
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2">
            <Languages size={16} aria-hidden className="shrink-0 text-muted" />
            <span className="sr-only">{t('language.label')}</span>
            <select
              data-nav
              className="field h-9 min-h-0 w-full text-sm"
              value={props.locale}
              onChange={(event) => props.onLocale(event.target.value as LocalePref)}
            >
              <option value="auto">{t('language.auto', { name: LOCALE_NAMES[i18n.systemLocale] })}</option>
              {LOCALES.map((locale) => (
                <option key={locale} value={locale} lang={locale}>
                  {LOCALE_NAMES[locale]}
                </option>
              ))}
            </select>
          </label>

          <div>
            <button type="button" data-nav className="btn btn-secondary w-full" onClick={props.onRescan} disabled={props.scanning}>
              <RefreshCw size={16} aria-hidden className={props.scanning ? 'animate-spin-slow' : ''} />
              {props.scanning ? t('rescan.running') : t('rescan.button')}
            </button>
            {props.scannedAt && <p className="mt-2 text-center text-xs text-muted">{t('rescan.last', { time: i18n.relative(Date.parse(props.scannedAt)) })}</p>}
          </div>
        </div>

        <button
          type="button"
          data-nav
          aria-expanded={settingsOpen}
          aria-controls={settingsId}
          onClick={() => setSettingsOpen((open) => !open)}
          className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[0.9375rem] text-muted transition-colors hover:bg-raised hover:text-fg"
        >
          <Settings size={18} aria-hidden /> {t('settings.label')}
          <ChevronUp size={16} aria-hidden className={`ml-auto transition-transform ${settingsOpen ? 'rotate-180' : ''}`} />
        </button>
      </footer>
    </nav>
  );
}
