import type { GameDetail, HealthPayload, LibraryPayload, ScanResponse } from '../types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new ApiError(response.status, `${url} answered ${response.status}`);
  return (await response.json()) as T;
}

export const fetchLibrary = (signal?: AbortSignal) => getJson<LibraryPayload>('/api/library', signal);
export const fetchGame = (id: string, signal?: AbortSignal) => getJson<GameDetail>(`/api/games/${encodeURIComponent(id)}`, signal);
export const fetchHealth = (signal?: AbortSignal) => getJson<HealthPayload>('/api/health', signal);

export async function requestScan(): Promise<ScanResponse> {
  const response = await fetch('/api/scan', { method: 'POST', headers: { Accept: 'application/json' } });
  if (response.status === 401 || response.status === 403) throw new ApiError(response.status, 'Rescanning is restricted on this server.');
  if (!response.ok && response.status !== 429) throw new ApiError(response.status, `Rescan failed with ${response.status}`);
  return (await response.json()) as ScanResponse;
}

export const playHref = (id: string) => `/play?id=${encodeURIComponent(id)}`;
export const libraryHref = (id: string) => `/?game=${encodeURIComponent(id)}`;
export const downloadHref = (url: string) => `${url}${url.includes('?') ? '&' : '?'}download=1`;
