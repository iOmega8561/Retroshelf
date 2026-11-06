import { Download, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n/react';
import { safeFileName, saveBlob } from '../lib/format';
import { saves, type BatterySave, type SaveState } from '../lib/saves';

interface SavesSectionProps {
  gameId: string;
  gameName: string;
  toast(message: string, tone?: 'info' | 'error'): void;
}

function Thumbnail({ blob }: { blob?: Blob }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) return;
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);
  return url ? (
    <img src={url} alt="" className="h-12 w-16 shrink-0 rounded bg-black object-contain" />
  ) : (
    <span className="h-12 w-16 shrink-0 rounded bg-raised" aria-hidden />
  );
}

/** Save states and battery saves stored in this browser, with export and delete. */
export function SavesSection({ gameId, gameName, toast }: SavesSectionProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const [states, setStates] = useState<SaveState[]>([]);
  const [battery, setBattery] = useState<BatterySave>();
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, sram] = await Promise.all([saves.listStates(gameId), saves.getBattery(gameId)]);
      setStates(list);
      setBattery(sram);
      setError(false);
    } catch {
      setError(true);
    }
  }, [gameId]);

  useEffect(() => {
    void load();
    // Saves change while playing in another tab.
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  const base = safeFileName(gameName);
  const removeState = async (slot: number) => {
    if (!window.confirm(t('saves.confirmDelete', { slot }))) return;
    await saves.deleteState(gameId, slot);
    toast(t('saves.deleted', { slot }));
    void load();
  };
  const removeBattery = async () => {
    if (!window.confirm(t('saves.confirmDeleteBattery'))) return;
    await saves.deleteBattery(gameId);
    toast(t('saves.batteryDeleted'));
    void load();
  };

  return (
    <section aria-labelledby={`saves-${gameId}`}>
      <h3 id={`saves-${gameId}`} className="text-sm font-semibold">
        {t('saves.title')}
      </h3>
      {error ? (
        <p className="mt-2 text-sm text-muted">{t('saves.blocked')}</p>
      ) : states.length === 0 && !battery ? (
        <p className="mt-2 text-sm leading-relaxed text-muted">{t('saves.empty')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line">
          {states.map((state) => (
            <li key={state.key} className="flex items-center gap-3 px-3 py-2.5">
              <Thumbnail blob={state.screenshot} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t('saves.slot', { slot: state.slot })}</p>
                <p className="text-xs text-muted">{t('saves.meta', { time: i18n.relative(state.createdAt), size: i18n.bytes(state.size) })}</p>
              </div>
              <button
                type="button"
                data-nav
                className="btn-icon"
                aria-label={t('saves.exportSlot', { slot: state.slot })}
                title={t('saves.export')}
                onClick={() => saveBlob(new Blob([state.data as BlobPart]), `${base} (slot ${state.slot}).state`)}
              >
                <Download size={18} aria-hidden />
              </button>
              <button
                type="button"
                data-nav
                className="btn-icon hover:!text-danger"
                aria-label={t('saves.deleteSlot', { slot: state.slot })}
                title={t('saves.delete')}
                onClick={() => void removeState(state.slot)}
              >
                <Trash2 size={18} aria-hidden />
              </button>
            </li>
          ))}
          {battery && (
            <li className="flex items-center gap-3 px-3 py-2.5">
              <span className="grid h-12 w-16 shrink-0 place-items-center rounded bg-raised text-[0.625rem] font-semibold text-muted">SRAM</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t('saves.battery')}</p>
                <p className="text-xs text-muted">{t('saves.batteryMeta', { time: i18n.relative(battery.updatedAt), size: i18n.bytes(battery.size) })}</p>
              </div>
              <button
                type="button"
                data-nav
                className="btn-icon"
                aria-label={t('saves.exportBattery')}
                title={t('saves.export')}
                onClick={() => saveBlob(new Blob([battery.data as BlobPart]), battery.fileName || `${base}.srm`)}
              >
                <Download size={18} aria-hidden />
              </button>
              <button
                type="button"
                data-nav
                className="btn-icon hover:!text-danger"
                aria-label={t('saves.deleteBattery')}
                title={t('saves.delete')}
                onClick={() => void removeBattery()}
              >
                <Trash2 size={18} aria-hidden />
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
