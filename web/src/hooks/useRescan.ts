import { useCallback, useState } from 'react';
import { useI18n } from '../i18n/react';
import { ApiError, fetchHealth, requestScan } from '../lib/api';

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export function useRescan(reload: () => Promise<boolean>, toast: (message: string, tone?: 'info' | 'error') => void) {
  const [scanning, setScanning] = useState(false);
  const i18n = useI18n();

  const rescan = useCallback(async () => {
    if (scanning) return;
    setScanning(true);
    try {
      const result = await requestScan();
      if (result.status === 'cooldown') {
        toast(i18n.plural('rescan.cooldown', result.retryAfterSeconds ?? 10));
        return;
      }
      // Poll until the server reports the scan finished (large NAS libraries can take a while).
      const deadline = Date.now() + 15 * 60_000;
      await sleep(400);
      while (Date.now() < deadline) {
        const health = await fetchHealth();
        if (!health.scanning) {
          await reload();
          toast(
            i18n.t('rescan.done', {
              games: i18n.plural('count.games', health.games),
              systems: i18n.plural('count.systems', health.systems),
            }),
          );
          return;
        }
        await sleep(1000);
      }
      toast(i18n.t('rescan.stillRunning'));
    } catch (error) {
      const restricted = error instanceof ApiError && (error.status === 401 || error.status === 403);
      toast(i18n.t(restricted ? 'rescan.restricted' : 'rescan.failed'), 'error');
    } finally {
      setScanning(false);
    }
  }, [scanning, reload, toast, i18n]);

  return { scanning, rescan };
}
