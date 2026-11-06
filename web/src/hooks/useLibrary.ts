import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchLibrary } from '../lib/api';
import type { LibraryPayload } from '../types';

export interface LibraryState {
  status: 'loading' | 'scanning' | 'ready' | 'error';
  data: LibraryPayload | null;
  reload: () => Promise<boolean>;
}

const POLL_MS = 2000;

export function useLibrary(): LibraryState {
  const [status, setStatus] = useState<LibraryState['status']>('loading');
  const [data, setData] = useState<LibraryPayload | null>(null);
  const hasData = useRef(false);

  const reload = useCallback(async (): Promise<boolean> => {
    try {
      const payload = await fetchLibrary();
      if (payload.status === 'scanning') {
        if (!hasData.current) setStatus('scanning');
        return false;
      }
      hasData.current = true;
      setData(payload);
      setStatus('ready');
      return true;
    } catch {
      if (!hasData.current) setStatus('error');
      return false;
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // The server answers immediately on boot and fills the catalog in the background.
  useEffect(() => {
    if (status !== 'scanning') return;
    const timer = window.setInterval(() => void reload(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [status, reload]);

  return { status, data, reload };
}
