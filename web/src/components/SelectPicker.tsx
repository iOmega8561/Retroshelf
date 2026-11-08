import { Check } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';

interface SelectPickerProps {
  select: HTMLSelectElement;
  onClose(): void;
}

/**
 * Controller-friendly stand-in for a native <select>, whose own picker a gamepad can neither open
 * nor drive. Lists the select's options in a popover next to it; picking one sets the select's
 * value and fires its change event, so whatever owns the select updates exactly as on a click.
 * Mouse, touch and keyboard keep using the native control.
 */
export function SelectPicker({ select, onClose }: SelectPickerProps) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [options] = useState(() => Array.from(select.options, ({ value, text, disabled, lang }) => ({ value, text, disabled, lang })));
  const current = select.value;
  const label = select.getAttribute('aria-label') ?? undefined;

  useLayoutEffect(() => {
    const node = panel.current;
    if (!node) return;
    // Below the select, or above it when that leaves more room (the language picker sits at the bottom).
    const rect = select.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 224), window.innerWidth - 16);
    node.style.width = `${width}px`;
    node.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
    const below = window.innerHeight - rect.bottom - 16;
    const above = rect.top - 16;
    if (below >= 240 || below >= above) {
      node.style.top = `${rect.bottom + 8}px`;
      node.style.maxHeight = `${Math.max(160, below)}px`;
    } else {
      node.style.bottom = `${window.innerHeight - rect.top + 8}px`;
      node.style.maxHeight = `${Math.max(160, above)}px`;
    }

    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState === 'closed' && !node.matches(':popover-open')) close.current();
    };
    node.addEventListener('toggle', onToggle);
    node.showPopover();
    const target = node.querySelector<HTMLElement>('[aria-selected="true"]:not(:disabled)') ?? node.querySelector<HTMLElement>('[data-nav]:not(:disabled)');
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'nearest' });
    return () => {
      node.removeEventListener('toggle', onToggle);
      if (node.matches(':popover-open')) node.hidePopover();
    };
  }, [select]);

  const choose = (value: string) => {
    if (select.value !== value) {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    panel.current?.hidePopover(); // focus returns to the select
  };

  return (
    <div ref={panel} popover="auto" data-nav-scope className="m-0 overflow-y-auto rounded-xl border border-line bg-surface p-1.5 text-fg shadow-2xl [inset:auto]">
      {label && <p className="px-2.5 pb-1 pt-1.5 text-sm font-semibold">{label}</p>}
      <div role="listbox" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            data-nav
            role="option"
            aria-selected={option.value === current}
            disabled={option.disabled}
            lang={option.lang || undefined}
            onClick={() => choose(option.value)}
            className="flex min-h-10 w-full items-center gap-3 rounded-lg px-2.5 text-left text-sm hover:bg-raised disabled:opacity-50"
          >
            <span className="min-w-0 flex-1 truncate">{option.text}</span>
            {option.value === current && <Check size={15} strokeWidth={3} aria-hidden className="shrink-0 text-accent-text" />}
          </button>
        ))}
      </div>
    </div>
  );
}
