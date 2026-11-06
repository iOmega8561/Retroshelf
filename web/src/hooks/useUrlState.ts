import { useCallback, useEffect, useRef, useState } from 'react';

/** Library view state lives in the URL so it survives reloads, can be shared, and works with Back. */
export interface UrlState {
  system: string | null;
  view: 'favorites' | 'recent' | null;
  q: string;
  genres: string[];
  decade: number | null;
  game: string | null;
}

function parse(search: string): UrlState {
  const params = new URLSearchParams(search);
  const view = params.get('view');
  const decade = Number(params.get('decade'));
  return {
    system: params.get('system'),
    view: view === 'favorites' || view === 'recent' ? view : null,
    q: params.get('q') ?? '',
    genres: params.getAll('genre').filter(Boolean),
    decade: Number.isInteger(decade) && decade >= 1950 && decade <= 2100 ? decade : null,
    game: params.get('game'),
  };
}

function serialize(state: UrlState): string {
  const params = new URLSearchParams();
  if (state.system) params.set('system', state.system);
  if (state.view) params.set('view', state.view);
  if (state.q) params.set('q', state.q);
  for (const genre of state.genres) params.append('genre', genre);
  if (state.decade) params.set('decade', String(state.decade));
  if (state.game) params.set('game', state.game);
  return params.toString();
}

export type UpdateUrl = (patch: Partial<UrlState>, mode?: 'push' | 'replace') => void;

export function useUrlState(): [UrlState, UpdateUrl] {
  const [state, setState] = useState(() => parse(window.location.search));
  const current = useRef(state);

  useEffect(() => {
    const onPop = () => {
      current.current = parse(window.location.search);
      setState(current.current);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const update = useCallback<UpdateUrl>((patch, mode = 'replace') => {
    const next = { ...current.current, ...patch };
    const search = serialize(next);
    const url = search ? `/?${search}` : '/';
    if (url !== window.location.pathname + window.location.search) {
      if (mode === 'push') window.history.pushState(null, '', url);
      else window.history.replaceState(null, '', url);
    }
    current.current = next;
    setState(next);
  }, []);

  return [state, update];
}
