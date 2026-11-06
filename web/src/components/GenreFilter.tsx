import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';

interface GenreFilterProps {
  options: Array<{ name: string; count: number }>;
  selected: string[];
  onChange(next: string[]): void;
}

/**
 * Multi-select genre filter. Uses the native Popover API so the panel sits in the top layer
 * (never clipped by the scrolling toolbar) and gets light-dismiss and Escape for free.
 */
export function GenreFilter({ options, selected, onChange }: GenreFilterProps) {
  const id = useId();
  const panelId = `genres-${id.replace(/:/g, '')}`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const selectedKeys = new Set(selected.map((s) => s.toLowerCase()));

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const place = (event: Event) => {
      if ((event as ToggleEvent).newState !== 'open' || !buttonRef.current) return;
      const rect = buttonRef.current.getBoundingClientRect();
      const width = Math.min(288, window.innerWidth - 16);
      panel.style.width = `${width}px`;
      panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
      panel.style.top = `${rect.bottom + 8}px`;
      panel.style.maxHeight = `${Math.max(200, window.innerHeight - rect.bottom - 24)}px`;
    };
    panel.addEventListener('beforetoggle', place);
    return () => panel.removeEventListener('beforetoggle', place);
  }, []);

  const toggle = (name: string) => {
    const key = name.toLowerCase();
    onChange(selectedKeys.has(key) ? selected.filter((s) => s.toLowerCase() !== key) : [...selected, name]);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-nav
        popoverTarget={panelId}
        disabled={!options.length}
        className="field inline-flex shrink-0 items-center gap-2 px-3.5 disabled:opacity-50"
      >
        Genre
        {selected.length > 0 && (
          <span className="rounded-full bg-accent-strong px-1.5 text-xs font-semibold tabular-nums text-white">{selected.length}</span>
        )}
        <ChevronDown size={16} aria-hidden className="text-muted" />
      </button>
      <div
        ref={panelRef}
        id={panelId}
        popover="auto"
        data-nav-scope
        className="m-0 overflow-y-auto rounded-xl border border-line bg-surface p-1.5 text-fg shadow-2xl [inset:auto]"
      >
        <div className="flex items-center justify-between px-2.5 pb-1 pt-1.5">
          <span className="text-sm font-semibold">Genres</span>
          {selected.length > 0 && (
            <button type="button" data-nav className="text-sm text-accent-text hover:underline" onClick={() => onChange([])}>
              Clear
            </button>
          )}
        </div>
        <ul role="group" aria-label="Genres">
          {options.map((option) => {
            const checked = selectedKeys.has(option.name.toLowerCase());
            return (
              <li key={option.name}>
                <button
                  type="button"
                  data-nav
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() => toggle(option.name)}
                  className="flex min-h-10 w-full items-center gap-3 rounded-lg px-2.5 text-left text-sm hover:bg-raised"
                >
                  <span
                    className={`grid size-[18px] shrink-0 place-items-center rounded border ${checked ? 'border-accent-strong bg-accent-strong text-white' : 'border-line'}`}
                  >
                    {checked && <Check size={13} strokeWidth={3} aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{option.name}</span>
                  <span className="text-xs tabular-nums text-muted">{option.count}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
