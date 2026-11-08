import { useEffect, useRef } from 'react';

/**
 * Couch-friendly navigation for the library with any standard-mapped controller:
 * D-pad / left stick moves focus spatially, A activates (on a select it opens a picker),
 * B goes back or closes an open popover, LB/RB switch shelves, Start plays the open game,
 * Y focuses search.
 */

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface GamepadNavHandlers {
  onBack(): void;
  onShelfStep(step: -1 | 1): void;
  onStart(): void;
  onSearch(): void;
  /** A on a native <select>: a controller can neither open nor drive the browser's own picker. */
  onPick(select: HTMLSelectElement): void;
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function isVisible(element: HTMLElement): boolean {
  if ((element as HTMLButtonElement).disabled) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0;
}

function isOpenPopover(element: HTMLElement): boolean {
  try {
    return element.matches(':popover-open');
  } catch {
    return false; // no Popover API
  }
}

/**
 * Topmost open scope (dialogs and popovers mark themselves with data-nav-scope), else the document.
 * A closed popover keeps its markup in the DOM, so only scopes that are actually rendered count.
 */
function activeScope(): ParentNode {
  const scopes = Array.from(document.querySelectorAll<HTMLElement>('[data-nav-scope]')).filter((scope) => scope.getClientRects().length > 0);
  return scopes.length ? scopes[scopes.length - 1]! : document;
}

/**
 * Closest candidate in a direction: distance along it, plus a penalty for drifting across it.
 * Strictly, a candidate's centre must lie beyond the current element's edge; comparing centres
 * only, a wide search field would see the games below it as being to its left, and the first game
 * of a row would see a narrower one in the next row as being to its left too.
 */
function nearest(from: DOMRect, candidates: HTMLElement[], direction: Direction, strict: boolean): HTMLElement | undefined {
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  let best: HTMLElement | undefined;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const element of candidates) {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const dx = x - cx;
    const dy = y - cy;
    const primary = direction === 'up' ? -dy : direction === 'down' ? dy : direction === 'left' ? -dx : dx;
    const cross = direction === 'up' || direction === 'down' ? Math.abs(dx) : Math.abs(dy);
    const beyond = direction === 'up' ? y < from.top : direction === 'down' ? y > from.bottom : direction === 'left' ? x < from.left : x > from.right;
    if (strict ? !beyond : primary <= 4) continue;
    const score = primary + cross * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = element;
    }
  }
  return best;
}

/**
 * Moves focus to the closest control in a direction. Inside a navigation group (the game grid,
 * data-nav-group) left/right never leave the group, and up/down leave it only on a fresh press:
 * holding a direction stops at the group's edge instead of overshooting into the toolbar or the
 * sidebar, whose sticky positions don't follow the page. Outside the grid, when nothing lies
 * strictly in that direction (say, a row scrolled partly under the sticky toolbar), centres decide.
 */
export function moveFocus(direction: Direction, repeat = false): void {
  const scope = activeScope();
  const candidates = Array.from(scope.querySelectorAll<HTMLElement>('[data-nav]')).filter(isVisible);
  const current = document.activeElement as HTMLElement | null;
  const focus = (element: HTMLElement) => {
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  };

  if (!current || !current.matches('[data-nav]') || !(scope as Node).contains(current)) {
    // Start in the content: the first game, else an empty state's action, else anything.
    const first = candidates.find((el) => el.classList.contains('tile')) ?? candidates.find((el) => el.closest('#games')) ?? candidates[0];
    if (first) focus(first);
    return;
  }

  const from = current.getBoundingClientRect();
  const others = candidates.filter((el) => el !== current);
  const group = current.closest<HTMLElement>('[data-nav-group]');
  const outside = group ? others.filter((el) => !group.contains(el)) : others;
  let best = group ? nearest(from, others.filter((el) => group.contains(el)), direction, true) : undefined;
  if (!best && (!group || (!repeat && (direction === 'up' || direction === 'down')))) {
    best = nearest(from, outside, direction, true) ?? nearest(from, outside, direction, false);
  }
  if (best) focus(best);
}

const REPEAT_DELAY = 320;
const REPEAT_RATE = 90;
const AXIS = 0.55;

export function useGamepadNav(enabled: boolean, handlers: GamepadNavHandlers): void {
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const held = new Map<string, number>();
    let frame = 0;

    const fire = (control: string, repeat: boolean) => {
      root.dataset.input = 'gamepad';
      switch (control) {
        case 'up':
        case 'down':
        case 'left':
        case 'right':
          moveFocus(control, repeat);
          break;
        case 'a': {
          const active = document.activeElement as HTMLElement | null;
          if (active instanceof HTMLSelectElement) latest.current.onPick(active);
          else if (active && active !== document.body) active.click();
          else moveFocus('down');
          break;
        }
        case 'b': {
          // An open popover (genre filter, select picker) closes first; the browser then returns
          // focus to whatever opened it.
          const popover = Array.from(document.querySelectorAll<HTMLElement>('[popover]')).filter(isOpenPopover).pop();
          if (popover) popover.hidePopover();
          else latest.current.onBack();
          break;
        }
        case 'lb':
          latest.current.onShelfStep(-1);
          break;
        case 'rb':
          latest.current.onShelfStep(1);
          break;
        case 'start':
          latest.current.onStart();
          break;
        case 'y':
          latest.current.onSearch();
          break;
      }
    };

    const loop = (time: number) => {
      frame = requestAnimationFrame(loop);
      if (!document.hasFocus()) return;
      const pressed = new Set<string>();
      for (const pad of navigator.getGamepads()) {
        if (!pad) continue;
        const button = (index: number) => Boolean(pad.buttons[index]?.pressed);
        const x = pad.axes[0] ?? 0;
        const y = pad.axes[1] ?? 0;
        if (button(12) || y < -AXIS) pressed.add('up');
        if (button(13) || y > AXIS) pressed.add('down');
        if (button(14) || x < -AXIS) pressed.add('left');
        if (button(15) || x > AXIS) pressed.add('right');
        if (button(0)) pressed.add('a');
        if (button(1)) pressed.add('b');
        if (button(3)) pressed.add('y');
        if (button(4)) pressed.add('lb');
        if (button(5)) pressed.add('rb');
        if (button(9)) pressed.add('start');
      }
      for (const control of [...held.keys()]) if (!pressed.has(control)) held.delete(control);
      for (const control of pressed) {
        const next = held.get(control);
        const repeats = control === 'up' || control === 'down' || control === 'left' || control === 'right';
        if (next === undefined) {
          held.set(control, time + REPEAT_DELAY);
          fire(control, false);
        } else if (repeats && time >= next) {
          held.set(control, time + REPEAT_RATE);
          fire(control, true);
        }
      }
    };

    const onPointer = () => {
      delete root.dataset.input;
    };
    frame = requestAnimationFrame(loop);
    window.addEventListener('pointerdown', onPointer, { passive: true });
    window.addEventListener('pointermove', onPointer, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('pointermove', onPointer);
      delete root.dataset.input;
    };
  }, [enabled]);
}
