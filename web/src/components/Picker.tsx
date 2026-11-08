import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { moveFocus } from '../hooks/useGamepadNav';
import { useI18n } from '../i18n/react';

export interface PickerOption {
  value: string;
  label: string;
  /** Muted text after the label, such as a count. */
  detail?: string;
  /** Language of the label when it isn't the page's (language names). */
  lang?: string;
}

interface CommonProps {
  /** Names the list: heading of the panel and, with the current choice, the button's name. */
  label: string;
  options: PickerOption[];
  disabled?: boolean;
  title?: string;
  /** Extra classes for the button. */
  className?: string;
}

interface SingleProps extends CommonProps {
  multiple?: false;
  value: string;
  onChange(value: string): void;
}

interface MultipleProps extends CommonProps {
  multiple: true;
  value: string[];
  onChange(value: string[]): void;
  /** What the button says; it also counts the options picked. */
  buttonLabel: string;
  /** Offered in the panel while something is picked. */
  clearLabel?: string;
}

/**
 * The app's drop-down, for one choice or several: a button that opens the options in a popover.
 * The Popover API puts the panel in the top layer (never clipped by the scrolling toolbar) and
 * brings light dismiss, Escape and focus return; data-nav-scope keeps a controller's D-pad inside
 * it, and the arrow keys move through it the same way.
 */
export function Picker(props: SingleProps | MultipleProps) {
  const i18n = useI18n();
  const id = useId();
  const panelId = `picker-${id.replace(/:/g, '')}`;
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const picked = props.multiple ? props.value : [props.value];
  const current = props.multiple ? undefined : (props.options.find((o) => o.value === props.value) ?? props.options[0]);

  useEffect(() => {
    const node = panel.current;
    if (!node) return;
    // Below the button, or above it when that leaves more room (the language picker sits at the bottom).
    const place = (event: Event) => {
      if ((event as ToggleEvent).newState !== 'open' || !button.current) return;
      const rect = button.current.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 288), window.innerWidth - 16);
      const below = window.innerHeight - rect.bottom - 16;
      const above = rect.top - 16;
      const down = below >= 240 || below >= above;
      node.style.width = `${width}px`;
      node.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
      node.style.top = down ? `${rect.bottom + 8}px` : '';
      node.style.bottom = down ? '' : `${window.innerHeight - rect.top + 8}px`;
      node.style.maxHeight = `${Math.max(160, down ? below : above)}px`;
    };
    // Start on the current choice, as a native picker does.
    const focus = (event: Event) => {
      if ((event as ToggleEvent).newState !== 'open') return;
      const target = node.querySelector<HTMLElement>('[aria-selected="true"]') ?? node.querySelector<HTMLElement>('[role="option"]');
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'nearest' });
    };
    node.addEventListener('beforetoggle', place);
    node.addEventListener('toggle', focus);
    return () => {
      node.removeEventListener('beforetoggle', place);
      node.removeEventListener('toggle', focus);
    };
  }, []);

  const choose = (value: string) => {
    if (props.multiple) {
      props.onChange(props.value.includes(value) ? props.value.filter((v) => v !== value) : [...props.value, value]);
      return;
    }
    if (value !== props.value) props.onChange(value);
    panel.current?.hidePopover(); // focus returns to the button
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        data-nav
        popoverTarget={panelId}
        aria-haspopup="listbox"
        disabled={props.disabled}
        title={props.title}
        className={`field inline-flex shrink-0 items-center justify-between gap-2 px-3.5 disabled:opacity-50 ${props.className ?? ''}`}
      >
        {props.multiple ? (
          <span className="flex items-center gap-2">
            {props.buttonLabel}
            {props.value.length > 0 && (
              <span className="rounded-full bg-accent-strong px-1.5 text-xs font-semibold tabular-nums text-white">{i18n.number(props.value.length)}</span>
            )}
          </span>
        ) : (
          // As wide as the longest option, like a native select, so a new choice doesn't shift the toolbar.
          <span className="grid text-left">
            <span className="sr-only">{props.label}: </span>
            {props.options.map((option) => (
              <span key={option.value} aria-hidden className="invisible col-start-1 row-start-1 whitespace-nowrap">
                {option.label}
              </span>
            ))}
            <span lang={current?.lang} className="col-start-1 row-start-1 whitespace-nowrap">
              {current?.label}
            </span>
          </span>
        )}
        <ChevronDown size={16} aria-hidden className="shrink-0 text-muted" />
      </button>
      <div
        ref={panel}
        id={panelId}
        popover="auto"
        data-nav-scope
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          moveFocus(event.key === 'ArrowDown' ? 'down' : 'up', event.repeat);
        }}
        className="m-0 overflow-y-auto rounded-xl border border-line bg-surface p-1.5 text-fg shadow-2xl [inset:auto]"
      >
        <div className="flex items-center justify-between px-2.5 pb-1 pt-1.5">
          <span className="text-sm font-semibold">{props.label}</span>
          {props.multiple && props.clearLabel && props.value.length > 0 && (
            <button type="button" data-nav className="text-sm text-accent-text hover:underline" onClick={() => props.onChange([])}>
              {props.clearLabel}
            </button>
          )}
        </div>
        <div role="listbox" aria-label={props.label} aria-multiselectable={props.multiple || undefined}>
          {props.options.map((option) => {
            const selected = picked.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                data-nav
                role="option"
                aria-selected={selected}
                lang={option.lang}
                onClick={() => choose(option.value)}
                className="flex min-h-10 w-full items-center gap-3 rounded-lg px-2.5 text-left text-sm hover:bg-raised"
              >
                {props.multiple && (
                  <span
                    className={`grid size-[18px] shrink-0 place-items-center rounded border ${selected ? 'border-accent-strong bg-accent-strong text-white' : 'border-line'}`}
                  >
                    {selected && <Check size={13} strokeWidth={3} aria-hidden />}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.detail && <span className="text-xs tabular-nums text-muted">{option.detail}</span>}
                {!props.multiple && selected && <Check size={15} strokeWidth={3} aria-hidden className="shrink-0 text-accent-text" />}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
