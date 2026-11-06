import { useEffect } from 'react';
import type { ThemePref } from '../lib/store';

const COLORS = { dark: '#1a1630', light: '#efecf7' } as const;

export function useTheme(pref: ThemePref): void {
  useEffect(() => {
    const root = document.documentElement;
    if (pref === 'system') delete root.dataset.theme;
    else root.dataset.theme = pref;

    // Keep the browser chrome (mobile address bar, installed app title bar) in step.
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
      const original = meta.dataset.media ?? meta.media;
      meta.dataset.media = original;
      if (pref === 'system') {
        meta.media = original;
        meta.content = original.includes('light') ? COLORS.light : COLORS.dark;
      } else {
        meta.media = '';
        meta.content = COLORS[pref];
      }
    });
  }, [pref]);
}
