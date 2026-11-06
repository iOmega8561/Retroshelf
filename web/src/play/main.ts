import { createTranslator, EJS_LANGUAGE, resolveLocale, type MessageKey } from '../i18n';
import { fetchGame, libraryHref } from '../lib/api';
import { controllerName } from '../lib/controllers';
import { safeFileName, saveBlob } from '../lib/format';
import { copyBytes, sameBytes, saves, SLOT_COUNT, type SaveState } from '../lib/saves';
import { markPlayed, prefsStore } from '../lib/store';
import { registerServiceWorker } from '../lib/sw-register';
import '../styles/player.css';
import type { GameDetail, PlayConfig } from '../types';
import { icon, type IconName } from './icons';

/* ---------------- language ---------------- */

const locale = resolveLocale(prefsStore.get().locale);
const i18n = createTranslator(locale);
const { t } = i18n;
document.documentElement.lang = locale;

// Static markup first, icons second (icons are prepended to the translated labels).
for (const element of document.querySelectorAll<HTMLElement>('[data-i18n]')) element.textContent = t(element.dataset.i18n as MessageKey);
for (const element of document.querySelectorAll<HTMLElement>('[data-i18n-label]')) {
  const label = t(element.dataset.i18nLabel as MessageKey);
  element.setAttribute('aria-label', label);
  element.title = label;
}
for (const element of document.querySelectorAll<HTMLElement>('[data-icon]')) {
  element.insertAdjacentHTML('afterbegin', icon(element.dataset.icon as IconName, 18));
}

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

const gameId = new URLSearchParams(window.location.search).get('id') ?? '';
let game: GameDetail | null = null;
let emulator: EjsEmulator | undefined;
let started = false;

/* ---------------- feedback ---------------- */

let toastTimer = 0;
function toast(message: string, durationMs = 4000): void {
  window.clearTimeout(toastTimer);
  toastRegion.innerHTML = '';
  const element = document.createElement('div');
  element.className = 'pointer-events-auto max-w-md rounded-xl border border-line bg-raised/95 px-4 py-3 text-sm text-fg shadow-2xl backdrop-blur-xl';
  element.textContent = message;
  toastRegion.append(element);
  toastTimer = window.setTimeout(() => element.remove(), durationMs);
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
  link.textContent = primary?.label ?? t('player.backToLibrary');
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
  else void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => toast(t('player.fullscreenUnavailable')));
});
document.addEventListener('fullscreenchange', () => {
  const on = Boolean(document.fullscreenElement);
  const label = t(on ? 'player.exitFullscreen' : 'player.fullscreen');
  fullscreenButton.innerHTML = icon(on ? 'minimize' : 'maximize', 18);
  fullscreenButton.setAttribute('aria-label', label);
  fullscreenButton.title = label;
});

/* ---------------- controllers ---------------- */

function connectedPads(): Gamepad[] {
  return typeof navigator.getGamepads === 'function' ? Array.from(navigator.getGamepads()).filter((pad): pad is Gamepad => Boolean(pad)) : [];
}

function updatePads(): void {
  padIndicator.hidden = connectedPads().length === 0;
}

/**
 * EmulatorJS 4.2.x polls controllers from the moment it loads, but only assigns a newly seen
 * controller to a player once its settings menu exists, which happens after the game starts.
 * A controller that was already in use when the page opened (for example after picking the game
 * with it in the library), or one pressed while the game downloads, is therefore never assigned,
 * and EmulatorJS ignores all of its input. Assign such controllers to the first free player
 * exactly as EmulatorJS' own handler would. Returns false until EmulatorJS is ready for it.
 */
function assignConnectedPads(): boolean {
  const ejs = emulator;
  const selection = ejs?.gamepadSelection;
  if (!ejs?.gamepad || !Array.isArray(selection) || !ejs.gamepadLabels?.length) return false;
  let changed = false;
  for (const pad of ejs.gamepad.gamepads) {
    const key = `${pad.id}_${pad.index}`;
    if (selection.includes(key)) continue;
    const free = selection.indexOf('');
    if (free === -1) break;
    selection[free] = key;
    changed = true;
  }
  if (changed) ejs.updateGamepadLabels?.();
  return true;
}

function assignPadsWhenReady(attempt = 0): void {
  if (!assignConnectedPads() && attempt < 40) window.setTimeout(() => assignPadsWhenReady(attempt + 1), 250);
}

window.addEventListener('gamepadconnected', (event) => {
  updatePads();
  // EmulatorJS notices the pad on its next 10 ms poll; make sure it ends up with a player.
  window.setTimeout(assignConnectedPads, 60);
  announce(t('player.padConnected', { name: controllerName(event.gamepad.id) ?? t('controller.generic') }));
});
window.addEventListener('gamepaddisconnected', () => {
  updatePads();
  announce(t('player.padDisconnected'));
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
    announce(t('player.cantSave'));
    return;
  }
  try {
    const screenshot = savesPanel.hidden ? await captureScreenshot() : panelScreenshot;
    await saves.putState(gameId, slot, data, screenshot);
    announce(t('player.saved', { slot }));
  } catch {
    announce(t('player.saveBlocked'));
  }
  if (!savesPanel.hidden) void renderSlots();
}

async function loadFromSlot(slot: number): Promise<void> {
  const manager = emulator?.gameManager;
  if (!manager) return;
  const state = await saves.getState(gameId, slot).catch(() => undefined);
  if (!state) {
    announce(t('player.slotEmpty', { slot }));
    return;
  }
  try {
    manager.loadState(state.data);
    announce(t('player.loaded', { slot }));
  } catch {
    announce(t('player.loadFailed', { slot }));
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
    announce(t('player.batteryRestored'));
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
    } else if (state) {
      thumb.textContent = t('player.noPreview');
    }

    const meta = document.createElement('div');
    meta.className = 'flex min-h-8 items-center gap-1';
    const label = document.createElement('p');
    label.className = 'min-w-0 flex-1 text-xs leading-tight';
    const name = document.createElement('span');
    name.className = 'font-semibold';
    name.textContent = t('saves.slot', { slot });
    const when = document.createElement('span');
    when.className = 'text-muted';
    when.textContent = state ? i18n.relative(state.createdAt) : t('player.empty');
    label.append(name, document.createElement('br'), when);
    meta.append(label);
    if (state) {
      const iconButton = 'btn-icon size-7 rounded-md';
      meta.append(
        button('', 'download', iconButton, () => saveBlob(new Blob([state.data as BlobPart]), `${safeFileName(game?.name ?? 'game')} (slot ${slot}).state`), t('saves.exportSlot', { slot })),
        button(
          '',
          'trash',
          `${iconButton} hover:!text-danger`,
          () => {
            if (!window.confirm(t('player.confirmDeleteSlot', { slot }))) return;
            void saves.deleteState(gameId, slot).then(renderSlots);
          },
          t('saves.deleteSlot', { slot }),
        ),
      );
    }

    const actions = document.createElement('div');
    actions.className = 'grid grid-cols-2 gap-1';
    const small = 'btn btn-secondary min-h-8 px-2 text-xs';
    actions.append(button(t('player.save'), null, small, () => void saveToSlot(slot), t('player.saveToSlot', { slot })));
    const load = button(t('player.load'), null, small, () => void loadFromSlot(slot).then(closeSaves), t('player.loadSlot', { slot }));
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

for (let slot = 1; slot <= SLOT_COUNT; slot += 1) importSlot.add(new Option(t('player.slotOption', { slot }), String(slot)));

$<HTMLInputElement>('import-state').addEventListener('change', async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const slot = Number(importSlot.value) || 1;
  const data = new Uint8Array(await file.arrayBuffer());
  await saves.putState(gameId, slot, data);
  toast(t('player.imported', { file: file.name, slot }));
  void renderSlots();
});

$('export-battery').addEventListener('click', () => {
  try {
    const data = emulator?.gameManager?.getSaveFile(true);
    if (!data?.byteLength) {
      toast(t('player.noBattery'));
      return;
    }
    saveBlob(new Blob([copyBytes(data) as BlobPart]), saveFileName());
  } catch {
    toast(t('player.noBatteryCore'));
  }
});

$<HTMLInputElement>('import-battery').addEventListener('change', async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (!window.confirm(t('player.confirmReplaceBattery'))) return;
  const data = new Uint8Array(await file.arrayBuffer());
  if (writeBattery(data)) {
    await mirrorBattery(data);
    toast(t('player.batteryImported'));
  } else {
    toast(t('player.noBatteryCore'));
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
  // EmulatorJS' own menus follow the same language as the rest of Retroshelf.
  window.EJS_language = EJS_LANGUAGE[locale];
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
    assignPadsWhenReady();
    window.setTimeout(() => void restoreBatteryIfMissing(), 600);
    if (!window.isSecureContext) toast(t('player.padInsecure'), 9000);
    revealChrome();
  };
}

function loadEmulatorJs(dataPath: string): void {
  const script = document.createElement('script');
  script.src = `${dataPath}loader.js`;
  script.async = true;
  if (/^https?:/.test(dataPath)) script.crossOrigin = 'anonymous';
  script.addEventListener('error', () =>
    showNotice(t('player.emulatorFailed.title'), t('player.emulatorFailed.body', { host: new URL(dataPath, window.location.href).host }), {
      label: t('player.reload'),
      href: window.location.href,
    }),
  );
  document.body.append(script);
}

async function boot(): Promise<void> {
  registerServiceWorker();
  if (!gameId) {
    showNotice(t('player.noGame.title'), t('player.noGame.body'));
    return;
  }
  backLink.href = libraryHref(gameId);

  try {
    game = await fetchGame(gameId);
  } catch {
    showNotice(t('player.notFound.title'), t('player.notFound.body'), { label: t('player.backToLibrary'), href: '/' });
    return;
  }

  document.title = t('player.title', { name: game.name });
  $('title').textContent = game.name;
  $('subtitle').textContent = game.systemName;

  const play = game.play;
  if (!play) {
    const reason = game.unplayableReason
      ? t(`unplayable.${game.unplayableReason}`, { system: game.systemName, emulator: game.setup?.emulator ?? t('setup.someEmulator') })
      : '';
    showNotice(t('player.cantRun.title', { system: game.systemName }), reason, { label: t('player.downloadOptions'), href: libraryHref(gameId) });
    return;
  }
  if (play.threads && !window.crossOriginIsolated) {
    showNotice(t('player.insecure.title'), t('player.insecure.body', { system: game.systemName }));
    return;
  }
  if (play.core === 'psp' && !supportsWebGl2()) {
    showNotice(t('player.webgl.title'), t('player.webgl.body'));
    return;
  }

  updatePads();
  configure(play, game);
  loadEmulatorJs(play.dataPath);
}

void boot();
