import { useCallback, useState } from 'react';
import { ApiError, fetchHealth, requestScan } from '../lib/api';
import { plural } from '../lib/format';

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export function useRescan(reload: () => Promise<boolean>, toast: (message: string, tone?: 'info' | 'error') => void) {
  const [scanning, setScanning] = useState(false);

  const rescan = useCallback(async () => {
    if (scanning) return;
    setScanning(true);
    try {
      const result = await requestScan();
      if (result.status === 'cooldown') {
        toast(`The library was just scanned. Try again in ${result.retryAfterSeconds ?? 10} seconds.`);
        return;
      }
      // Poll until the server reports the scan finished (large NAS libraries can take a while).
      const deadline = Date.now() + 15 * 60_000;
      await sleep(400);
      while (Date.now() < deadline) {
        const health = await fetchHealth();
        if (!health.scanning) {
          await reload();
          toast(`Library updated: ${plural(health.games, 'game', 'games')} in ${plural(health.systems, 'system', 'systems')}.`);
          return;
        }
        await sleep(1000);
      }
      toast('The scan is still running. The library will update when you reload.');
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Couldn\u2019t reach the server to rescan.', 'error');
    } finally {
      setScanning(false);
    }
  }, [scanning, reload, toast]);

  return { scanning, rescan };
}
