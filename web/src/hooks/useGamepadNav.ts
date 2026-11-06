import { useEffect, useRef } from 'react';

/**
 * Couch-friendly navigation for the library with any standard-mapped controller:
 * D-pad / left stick moves focus spatially, A activates, B goes back,
 * LB/RB switch shelves, Start plays the open game, Y focuses search.
 */

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface GamepadNavHandlers {
  onBack(): void;
  onShelfStep(step: -1 | 1): void;
  onStart(): void;
  onSearch(): void;
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function isVisible(element: HTMLElement): boolean {
  if ((element as HTMLButtonElement).disabled) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0;
}

/** Topmost open scope (a dialog marks itself with data-nav-scope), else the document. */
function activeScope(): ParentNode {
  const scopes = document.querySelectorAll<HTMLElement>('[data-nav-scope]');
  return scopes.length ? scopes[scopes.length - 1]! : document;
}

export function moveFocus(direction: Direction): void {
  const scope = activeScope();
  const candidates = Array.from(scope.querySelectorAll<HTMLElement>('[data-nav]')).filter(isVisible);
  const current = document.activeElement as HTMLElement | null;
  const focus = (element: HTMLElement) => {
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  };

  if (!current || !current.matches('[data-nav]') || !(scope as Node).contains(current)) {
    const first = candidates.find((el) => el.classList.contains('tile')) ?? candidates[0];
    if (first) focus(first);
    return;
  }

  const from = current.getBoundingClientRect();
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  let best: HTMLElement | undefined;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const element of candidates) {
    if (element === current) continue;
    const rect = element.getBoundingClientRect();
    const dx = rect.left + rect.width / 2 - cx;
    const dy = rect.top + rect.height / 2 - cy;
    const primary = direction === 'up' ? -dy : direction === 'down' ? dy : direction === 'left' ? -dx : dx;
    const cross = direction === 'up' || direction === 'down' ? Math.abs(dx) : Math.abs(dy);
    if (primary <= 4) continue;
    const score = primary + cross * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = element;
    }
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

    const fire = (control: string) => {
      root.dataset.input = 'gamepad';
      switch (control) {
        case 'up':
        case 'down':
        case 'left':
        case 'right':
          moveFocus(control);
          break;
        case 'a': {
          const active = document.activeElement as HTMLElement | null;
          if (active && active !== document.body) active.click();
          else moveFocus('down');
          break;
        }
        case 'b':
          latest.current.onBack();
          break;
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
          fire(control);
        } else if (repeats && time >= next) {
          held.set(control, time + REPEAT_RATE);
          fire(control);
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
