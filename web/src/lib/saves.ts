/**
 * Client-side save storage (IndexedDB), independent of EmulatorJS' own databases.
 *
 *  - `states`: save-state slots per game, with a screenshot.
 *  - `battery`: a mirror of the game's battery save (SRAM). EmulatorJS already persists SRAM
 *    in its IDBFS mount; this copy survives clearing EmulatorJS' cache and powers export/import.
 */

export const SLOT_COUNT = 9;

export interface SaveState {
  key: string;
  gameId: string;
  slot: number;
  createdAt: number;
  size: number;
  data: Uint8Array;
  screenshot?: Blob;
}

export interface BatterySave {
  gameId: string;
  fileName: string;
  updatedAt: number;
  size: number;
  data: Uint8Array;
}

const DB_NAME = 'retroshelf';
const DB_VERSION = 1;
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('states')) {
        db.createObjectStore('states', { keyPath: 'key' }).createIndex('gameId', 'gameId', { unique: false });
      }
      if (!db.objectStoreNames.contains('battery')) db.createObjectStore('battery', { keyPath: 'gameId' });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
    request.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
  });
  // A failed open (private mode, quota) shouldn't poison later attempts.
  opening.catch(() => {
    dbPromise = null;
  });
  dbPromise = opening;
  return opening;
}

async function run<T>(store: 'states' | 'battery', mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error ?? request.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

const stateKey = (gameId: string, slot: number) => `${gameId}#${slot}`;

let persistenceRequested = false;
/** Ask the browser not to evict our data under storage pressure (granted silently or ignored). */
function requestPersistence(): void {
  if (persistenceRequested) return;
  persistenceRequested = true;
  void navigator.storage?.persist?.().catch(() => undefined);
}

export const saves = {
  async listStates(gameId: string): Promise<SaveState[]> {
    const states = await run<SaveState[]>('states', 'readonly', (s) => s.index('gameId').getAll(IDBKeyRange.only(gameId)));
    return states.sort((a, b) => a.slot - b.slot);
  },

  getState(gameId: string, slot: number): Promise<SaveState | undefined> {
    return run<SaveState | undefined>('states', 'readonly', (s) => s.get(stateKey(gameId, slot)) as IDBRequest<SaveState | undefined>);
  },

  async putState(gameId: string, slot: number, data: Uint8Array, screenshot?: Blob): Promise<SaveState> {
    requestPersistence();
    const state: SaveState = { key: stateKey(gameId, slot), gameId, slot, createdAt: Date.now(), size: data.byteLength, data, screenshot };
    await run('states', 'readwrite', (s) => s.put(state));
    return state;
  },

  async deleteState(gameId: string, slot: number): Promise<void> {
    await run('states', 'readwrite', (s) => s.delete(stateKey(gameId, slot)));
  },

  getBattery(gameId: string): Promise<BatterySave | undefined> {
    return run<BatterySave | undefined>('battery', 'readonly', (s) => s.get(gameId) as IDBRequest<BatterySave | undefined>);
  },

  async putBattery(gameId: string, fileName: string, data: Uint8Array): Promise<void> {
    requestPersistence();
    const save: BatterySave = { gameId, fileName, updatedAt: Date.now(), size: data.byteLength, data };
    await run('battery', 'readwrite', (s) => s.put(save));
  },

  async deleteBattery(gameId: string): Promise<void> {
    await run('battery', 'readwrite', (s) => s.delete(gameId));
  },
};

/** Copy out of a WASM heap view so the stored bytes are stable. */
export function copyBytes(view: Uint8Array): Uint8Array {
  return new Uint8Array(view);
}

export function sameBytes(a: Uint8Array | null | undefined, b: Uint8Array | null | undefined): boolean {
  if (!a || !b || a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) if (a[i] !== b[i]) return false;
  return true;
}
