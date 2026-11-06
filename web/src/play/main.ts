import { fetchGame, libraryHref } from '../lib/api';
import { formatRelative, safeFileName, saveBlob } from '../lib/format';
import { copyBytes, sameBytes, saves, SLOT_COUNT, type SaveState } from '../lib/saves';
import { markPlayed } from '../lib/store';
import { registerServiceWorker } from '../lib/sw-register';
import '../styles/player.css';
import type { GameDetail, PlayConfig } from '../types';
import { icon, type IconName } from './icons';

/* ---------------- DOM ---------------- */

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const chrome = $<HTMLElement>('chrome');
const backLink = $<HTMLAnchorElement>('back');
const savesToggle = $<HTMLButtonElement>('saves-toggle');
const savesPanel = $<HTMLElement>('saves');
const slotList = $<HTMLOListElement>('slots');
const importSlot = $<HTMLSelectElement>('import-slot');
const fullscreenButton = $<HTMLButtonElement>('fullscreen');
const padIndicator = $<HTMLElement>('pad');
const toastRegion = $<HTMLElement>('toast');

for (const element of document.querySelectorAll<HTMLElement>('[data-icon]')) {
  element.insertAdjacentHTML('afterbegin', icon(element.dataset.icon as IconName, 18));
}

const gameId = new URLSearchParams(window.location.search).get('id') ?? '';
let game: GameDetail | null = null;
let emulator: EjsEmulator | undefined;
let started = false;

/* ---------------- feedback ---------------- */

let toastTimer = 0;
function toast(message: string): void {
  window.clearTimeout(toastTimer);
  toastRegion.innerHTML = '';
  const element = document.createElement('div');
  element.className = 'pointer-events-auto max-w-md rounded-xl border border-line bg-raised/95 px-4 py-3 text-sm text-fg shadow-2xl backdrop-blur-xl';
  element.textContent = message;
  toastRegion.append(element);
  toastTimer = window.setTimeout(() => element.remove(), 4000);
}

/**
 * Our toast sits above EmulatorJS' control bar. When EmulatorJS' own fullscreen hides the rest
 * of the page, fall back to its built-in on-screen message.
 */
function announce(message: string): void {
  const fullscreen = document.fullscreenElement;
  if (fullscreen && fullscreen !== document.documentElement && emulator?.displayMessage) emulator.displayMessage(message, 2500);
  else toast(message);
}

function showNotice(title: string, body: string, primary?: { label: string; href: string }): void {
  $('notice-title').textContent = title;
  $('notice-body').textContent = body;
  const link = $<HTMLAnchorElement>('notice-primary');
  link.textContent = primary?.label ?? 'Back to library';
  link.href = primary?.href ?? (gameId ? libraryHref(gameId) : '/');
  $('notice').hidden = false;
  chrome.dataset.hidden = 'false';
}

/* ---------------- chrome auto-hide ---------------- */

let hideTimer = 0;
function revealChrome(): void {
  chrome.dataset.hidden = 'false';
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    if (started && savesPanel.hidden) chrome.dataset.hidden = 'true';
  }, 2600);
}
window.addEventListener('pointermove', revealChrome, { passive: true });
window.addEventListener('pointerdown', revealChrome, { passive: true });

/* ---------------- leaving the page safely ---------------- */

/** Ask the core to write SRAM and wait (bounded) for EmulatorJS' IndexedDB sync. */
function flushBatterySave(): Promise<void> {
  const manager = emulator?.gameManager;
  if (!started || !manager) return Promise.resolve();
  try {
    manager.saveSaveFiles();
  } catch {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timeout = window.setTimeout(resolve, 1500);
    try {
      manager.FS.syncfs(false, () => {
        window.clearTimeout(timeout);
        resolve();
      });
    } catch {
      window.clearTimeout(timeout);
      resolve();
    }
  });
}

async function returnToLibrary(): Promise<void> {
  await flushBatterySave();
  const referrer = document.referrer ? new URL(document.referrer) : null;
  if (referrer?.origin === window.location.origin && window.history.length > 1) window.history.back();
  else window.location.replace(libraryHref(gameId));
}

backLink.addEventListener('click', (event) => {
  event.preventDefault();
  void returnToLibrary();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void flushBatterySave();
});
window.addEventListener('pagehide', () => {
  try {
    emulator?.gameManager?.saveSaveFiles();
  } catch {
    /* best effort */
  }
});

/* ---------------- fullscreen ---------------- */

if (!document.fullscreenEnabled) fullscreenButton.hidden = true;
fullscreenButton.addEventListener('click', () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => toast('Full screen isn\u2019t available here.'));
});
document.addEventListener('fullscreenchange', () => {
  const on = Boolean(document.fullscreenElement);
  fullscreenButton.innerHTML = icon(on ? 'minimize' : 'maximize', 18);
  fullscreenButton.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
  fullscreenButton.title = on ? 'Exit full screen' : 'Full screen';
});

/* ---------------- controllers ---------------- */

function updatePads(): void {
  const pads = Array.from(navigator.getGamepads?.() ?? []).filter(Boolean);
  padIndicator.hidden = pads.length === 0;
}
window.addEventListener('gamepadconnected', (event) => {
  updatePads();
  const name = event.gamepad.id.replace(/\(.*?\)/g, '').trim() || 'Controller';
  announce(`${name} connected`);
});
window.addEventListener('gamepaddisconnected', () => {
  updatePads();
  announce('Controller disconnected');
});

/* ---------------- save states ---------------- */

function currentSlot(): number {
  const value = Number(emulator?.getSettingValue?.('save-state-slot'));
  return Number.isInteger(value) && value >= 1 && value <= SLOT_COUNT ? value : 1;
}

async function captureScreenshot(): Promise<Blob | undefined> {
  if (!emulator?.takeScreenshot) return undefined;
  try {
    const result = await Promise.race([
      emulator.takeScreenshot(undefined, 'png', 1),
      new Promise<undefined>((resolve) => window.setTimeout(() => resolve(undefined), 4000)),
    ]);
    // EmulatorJS 4.2.3 resolves `{ blob }`; older builds used `{ screenshot }`.
    const blob = result?.blob ?? result?.screenshot;
    return blob instanceof Blob ? blob : undefined;
  } catch {
    return undefined;
  }
}

/** Frame grabbed when the panel opened, before pausing (a paused canvas may not redraw). */
let panelScreenshot: Blob | undefined;

async function saveToSlot(slot: number, existing?: Uint8Array): Promise<void> {
  const manager = emulator?.gameManager;
  if (!manager) return;
  let data: Uint8Array;
  try {
    data = existing ? copyBytes(existing) : manager.getState();
  } catch {
    announce('This game can\u2019t be saved right now.');
    return;
  }
  try {
    const screenshot = savesPanel.hidden ? await captureScreenshot() : panelScreenshot;
    await saves.putState(gameId, slot, data, screenshot);
    announce(`Saved to slot ${slot}`);
  } catch {
    announce('Couldn\u2019t save: this browser blocked storage for the site.');
  }
  if (!savesPanel.hidden) void renderSlots();
}

async function loadFromSlot(slot: number): Promise<void> {
  const manager = emulator?.gameManager;
  if (!manager) return;
  const state = await saves.getState(gameId, slot).catch(() => undefined);
  if (!state) {
    announce(`Slot ${slot} is empty`);
    return;
  }
  try {
    manager.loadState(state.data);
    announce(`Loaded slot ${slot}`);
  } catch {
    announce(`Slot ${slot} couldn\u2019t be loaded by this core.`);
  }
}

/* ---------------- battery save mirror ---------------- */

let lastMirrored: Uint8Array | null = null;

function saveFileName(): string {
  try {
    return emulator?.gameManager?.getSaveFilePath().split('/').pop() || `${safeFileName(game?.name ?? 'game')}.srm`;
  } catch {
    return `${safeFileName(game?.name ?? 'game')}.srm`;
  }
}

async function mirrorBattery(data: unknown): Promise<void> {
  if (!(data instanceof Uint8Array) || data.byteLength === 0 || sameBytes(data, lastMirrored)) return;
  lastMirrored = copyBytes(data);
  await saves.putBattery(gameId, saveFileName(), lastMirrored).catch(() => undefined);
}

function writeBattery(data: Uint8Array): boolean {
  const manager = emulator?.gameManager;
  if (!manager) return false;
  const path = manager.getSaveFilePath();
  if (!path) return false;
  let current = '';
  for (const part of path.split('/').slice(0, -1)) {
    if (!part) continue;
    current += `/${part}`;
    if (!manager.FS.analyzePath(current).exists) manager.FS.mkdir(current);
  }
  if (manager.FS.analyzePath(path).exists) manager.FS.unlink(path);
  manager.FS.writeFile(path, data);
  manager.loadSaveFiles();
  return true;
}

/** If EmulatorJS lost its copy (cache cleared), restore the battery save from our backup. */
async function restoreBatteryIfMissing(): Promise<void> {
  const manager = emulator?.gameManager;
  if (!manager) return;
  let path = '';
  try {
    path = manager.getSaveFilePath();
  } catch {
    return;
  }
  if (!path || manager.FS.analyzePath(path).exists) return;
  const backup = await saves.getBattery(gameId).catch(() => undefined);
  if (backup && writeBattery(backup.data)) {
    lastMirrored = backup.data;
    announce('Restored your battery save from this browser\u2019s backup');
  }
}

/* ---------------- saves panel ---------------- */

let resumeOnClose = false;
let thumbnailUrls: string[] = [];

function button(label: string, iconName: IconName | null, className: string, onClick: () => void, aria?: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.innerHTML = iconName ? icon(iconName, 16) : '';
  if (label) element.append(label);
  if (aria) {
    element.setAttribute('aria-label', aria);
    element.title = aria;
  }
  element.addEventListener('click', onClick);
  return element;
}

async function renderSlots(): Promise<void> {
  const states = await saves.listStates(gameId).catch(() => [] as SaveState[]);
  const bySlot = new Map(states.map((s) => [s.slot, s]));
  thumbnailUrls.forEach((url) => URL.revokeObjectURL(url));
  thumbnailUrls = [];
  slotList.replaceChildren();

  for (let slot = 1; slot <= SLOT_COUNT; slot += 1) {
    const state = bySlot.get(slot);
    const item = document.createElement('li');
    item.className = 'slot-card flex flex-col gap-2';
    item.dataset.empty = String(!state);

    const thumb = document.createElement('div');
    thumb.className = 'slot-thumb grid aspect-[4/3] place-items-center overflow-hidden rounded-lg border border-line bg-black text-xs text-muted';
    if (state?.screenshot) {
      const url = URL.createObjectURL(state.screenshot);
      thumbnailUrls.push(url);
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.className = 'size-full object-contain';
      thumb.append(img);
    } else {
      thumb.textContent = state ? 'No preview' : '';
    }

    const meta = document.createElement('div');
    meta.className = 'flex min-h-8 items-center gap-1';
    const label = document.createElement('p');
    label.className = 'min-w-0 flex-1 text-xs leading-tight';
    label.innerHTML = `<span class="font-semibold">Slot ${slot}</span><br><span class="text-muted">${state ? formatRelative(state.createdAt) : 'Empty'}</span>`;
    meta.append(label);
    if (state) {
      const iconButton = 'btn-icon size-7 rounded-md';
      meta.append(
        button('', 'download', iconButton, () => saveBlob(new Blob([state.data as BlobPart]), `${safeFileName(game?.name ?? 'game')} (slot ${slot}).state`), `Export slot ${slot}`),
        button('', 'trash', `${iconButton} hover:!text-danger`, () => {
          if (!window.confirm(`Delete the save in slot ${slot}?`)) return;
          void saves.deleteState(gameId, slot).then(renderSlots);
        }, `Delete slot ${slot}`),
      );
    }

    const actions = document.createElement('div');
    actions.className = 'grid grid-cols-2 gap-1';
    const small = 'btn btn-secondary min-h-8 px-2 text-xs';
    actions.append(button('Save', null, small, () => void saveToSlot(slot), `Save to slot ${slot}`));
    const load = button('Load', null, small, () => void loadFromSlot(slot).then(closeSaves), `Load slot ${slot}`);
    load.disabled = !state;
    actions.append(load);
    item.append(thumb, meta, actions);
    slotList.append(item);
  }
}

async function openSaves(): Promise<void> {
  if (!started) return;
  resumeOnClose = !emulator?.paused;
  savesPanel.hidden = false;
  savesToggle.setAttribute('aria-expanded', 'true');
  chrome.dataset.hidden = 'false';
  void renderSlots();
  $<HTMLButtonElement>('saves-close').focus();
  panelScreenshot = resumeOnClose ? await captureScreenshot() : panelScreenshot;
  if (!savesPanel.hidden) emulator?.pause?.();
}

function closeSaves(): void {
  if (savesPanel.hidden) return;
  savesPanel.hidden = true;
  savesToggle.setAttribute('aria-expanded', 'false');
  if (resumeOnClose) emulator?.play?.();
  savesToggle.focus();
  revealChrome();
}

savesToggle.addEventListener('click', () => (savesPanel.hidden ? void openSaves() : closeSaves()));
$('saves-close').addEventListener('click', closeSaves);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !savesPanel.hidden) {
    event.preventDefault();
    closeSaves();
  }
});

for (let slot = 1; slot <= SLOT_COUNT; slot += 1) importSlot.add(new Option(`slot ${slot}`, String(slot)));

$<HTMLInputElement>('import-state').addEventListener('change', async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const slot = Number(importSlot.value) || 1;
  const data = new Uint8Array(await file.arrayBuffer());
  await saves.putState(gameId, slot, data);
  toast(`Imported ${file.name} into slot ${slot}. Load it to continue from there.`);
  void renderSlots();
});

$('export-battery').addEventListener('click', () => {
  try {
    const data = emulator?.gameManager?.getSaveFile(true);
    if (!data?.byteLength) {
      toast('This game has no battery save yet.');
      return;
    }
    saveBlob(new Blob([copyBytes(data) as BlobPart]), saveFileName());
  } catch {
    toast('This core doesn\u2019t use battery saves.');
  }
});

$<HTMLInputElement>('import-battery').addEventListener('change', async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (!window.confirm('Replace the current battery save with this file?')) return;
  const data = new Uint8Array(await file.arrayBuffer());
  if (writeBattery(data)) {
    await mirrorBattery(data);
    toast('Battery save imported. Restart the game from its menu if it doesn\u2019t appear.');
  } else {
    toast('This core doesn\u2019t use battery saves.');
  }
});

/* ---------------- EmulatorJS ---------------- */

function supportsWebGl2(): boolean {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
}

function configure(play: PlayConfig, detail: GameDetail): void {
  window.EJS_player = '#game';
  window.EJS_core = play.core;
  window.EJS_gameUrl = play.gameUrl;
  if (play.biosUrl) window.EJS_biosUrl = play.biosUrl;
  window.EJS_pathtodata = play.dataPath;
  window.EJS_gameName = play.gameName;
  window.EJS_threads = play.threads;
  window.EJS_color = '#8b5cf6';
  window.EJS_backgroundColor = '#000000';
  window.EJS_startOnLoaded = true;
  window.EJS_CacheLimit = play.cacheLimit;
  // Netplay needs a third-party server, which Retroshelf deliberately doesn't use.
  window.EJS_Buttons = { netplay: false };
  window.EJS_defaultOptions = { 'save-save-interval': '60' };

  // Route EmulatorJS' own Save/Load buttons and hotkeys into slot-based IndexedDB storage.
  window.EJS_onSaveState = (event) => void saveToSlot(currentSlot(), event.state);
  window.EJS_onLoadState = () => void loadFromSlot(currentSlot());

  window.EJS_ready = () => {
    emulator = window.EJS_emulator;
  };
  window.EJS_onGameStart = () => {
    emulator = window.EJS_emulator;
    started = true;
    savesToggle.disabled = false;
    markPlayed(detail.id);
    emulator?.on('saveSaveFiles', (data) => void mirrorBattery(data));
    emulator?.on('exit', () => window.setTimeout(() => void returnToLibrary(), 1200));
    window.setTimeout(() => void restoreBatteryIfMissing(), 600);
    revealChrome();
  };
}

function loadEmulatorJs(dataPath: string): void {
  const script = document.createElement('script');
  script.src = `${dataPath}loader.js`;
  script.async = true;
  if (/^https?:/.test(dataPath)) script.crossOrigin = 'anonymous';
  script.addEventListener('error', () =>
    showNotice('The emulator didn\u2019t load', `This device couldn\u2019t download EmulatorJS from ${new URL(dataPath, window.location.href).host}. Check the connection or any content blocker, then reload.`, {
      label: 'Reload',
      href: window.location.href,
    }),
  );
  document.body.append(script);
}

async function boot(): Promise<void> {
  registerServiceWorker();
  if (!gameId) {
    showNotice('No game selected', 'Pick a game in your library and choose Play.');
    return;
  }
  backLink.href = libraryHref(gameId);

  try {
    game = await fetchGame(gameId);
  } catch {
    showNotice('Game not found', 'It may have been renamed or removed since the last scan. Rescan the library and try again.', { label: 'Back to library', href: '/' });
    return;
  }

  document.title = `${game.name} \u2013 Retroshelf`;
  $('title').textContent = game.name;
  $('subtitle').textContent = game.systemName;

  const play = game.play;
  if (!play) {
    showNotice(`${game.systemName} can\u2019t run here`, game.unplayableReason ?? 'Download the game to play it with a desktop emulator.', {
      label: 'Download options',
      href: libraryHref(gameId),
    });
    return;
  }
  if (play.threads && !window.crossOriginIsolated) {
    showNotice(
      'This game needs a secure connection',
      `The ${game.systemName} emulator uses shared memory, which browsers only allow on HTTPS pages (or on localhost). Open Retroshelf through your HTTPS reverse proxy and keep its Cross-Origin headers intact.`,
    );
    return;
  }
  if (play.core === 'psp' && !supportsWebGl2()) {
    showNotice('This browser can\u2019t run PSP games', 'The PSP emulator needs WebGL 2. Update the browser or graphics drivers, or try another browser.');
    return;
  }

  updatePads();
  configure(play, game);
  loadEmulatorJs(play.dataPath);
}

void boot();
