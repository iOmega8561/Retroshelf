import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import type {
  BiosInfo,
  ExtraLink,
  FileLink,
  GameDetail,
  GameSummary,
  LibraryPayload,
  PlayConfig,
  ScanResponse,
  SystemSummary,
} from '../../../shared/api.js';
import type { Config } from '../config.js';
import type { Logger } from '../logger.js';
import { stableId } from '../util/mime.js';
import { encodePath } from '../util/paths.js';
import { canZip, type ZipEntryInput } from '../util/zip.js';
import { directoryContents } from './scanner.js';
import { baseName, resolveBios, type BiosResolution } from './bios.js';
import { archiveNameFor } from './discsets.js';
import { listSystemFolders, scanBios, scanSystem, type BiosScan, type FileRef, type GameRecord } from './scanner.js';
import { manufacturerRank, systemForFolder, type SystemDef } from './systems.js';

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

export interface SystemRecord {
  folder: string;
  absDir: string;
  def: SystemDef;
  games: GameRecord[];
  bios: BiosResolution;
}

export interface EncodedPayload {
  etag: string;
  br: Buffer;
  gzip: Buffer;
  /** Raw JSON is rebuilt on demand for the rare client that accepts neither encoding. */
  identity: () => Buffer;
}

interface CatalogState {
  scannedAt: Date;
  durationMs: number;
  systems: SystemRecord[];
  systemsByFolder: Map<string, SystemRecord>;
  gamesById: Map<string, GameRecord>;
  /** `${folder}/${rel}` → ROM file. Only these are servable from /files/roms. */
  romIndex: Map<string, FileRef>;
  /** `${folder}/${rel}` for media referenced by games. Only these are servable from /media. */
  mediaIndex: Set<string>;
  bios: BiosScan;
  payload: EncodedPayload;
  summaries: SystemSummary[];
}

export class Catalog {
  private state: CatalogState | null = null;
  private running: Promise<void> | null = null;
  private lastScanStartedAt = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: Config,
    private readonly log: Logger,
  ) {}

  /* ---------------- lifecycle ---------------- */

  get ready(): boolean {
    return this.state !== null;
  }

  get scanning(): boolean {
    return this.running !== null;
  }

  get scannedAt(): Date | undefined {
    return this.state?.scannedAt;
  }

  get gameCount(): number {
    return this.state?.gamesById.size ?? 0;
  }

  get systemCount(): number {
    return this.state?.systems.length ?? 0;
  }

  startPeriodicRescan(): void {
    if (!this.config.rescanIntervalMs) return;
    this.timer = setInterval(() => void this.scan('interval').catch(() => undefined), this.config.rescanIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Single-flight: concurrent callers share one scan. */
  scan(reason: string): Promise<void> {
    if (this.running) return this.running;
    this.lastScanStartedAt = Date.now();
    this.running = this.runScan(reason).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Rate-limited trigger used by the HTTP API. */
  requestScan(): ScanResponse {
    if (this.running) return { status: 'running' };
    const wait = this.lastScanStartedAt + this.config.scanCooldownMs - Date.now();
    if (wait > 0) return { status: 'cooldown', retryAfterSeconds: Math.ceil(wait / 1000) };
    void this.scan('api').catch(() => undefined);
    return { status: 'started' };
  }

  private async runScan(reason: string): Promise<void> {
    const started = performance.now();
    this.log.info('scan started', { reason, roms: this.config.romsDir });
    try {
      await fs.access(this.config.romsDir);
    } catch {
      this.log.warn('roms directory is missing or unreadable; the library will be empty', { path: this.config.romsDir });
    }

    const [folders, bios] = await Promise.all([
      listSystemFolders(this.config.romsDir, this.config.followSymlinks),
      scanBios(this.config.biosDir, this.config.followSymlinks),
    ]);

    const scanOptions = {
      maxDepth: this.config.maxScanDepth,
      followSymlinks: this.config.followSymlinks,
      showHidden: this.config.showHidden,
      maxGamelistBytes: this.config.maxGamelistBytes,
      makeId: (folder: string, rel: string) => stableId(folder, rel),
      log: this.log,
    };

    // Small concurrency: plenty for local disks, gentle on NAS mounts.
    const systems: SystemRecord[] = [];
    const queue = [...folders];
    const romIndex = new Map<string, FileRef>();
    const mediaIndex = new Set<string>();
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const def = systemForFolder(next.folder);
        try {
          const result = await scanSystem(next.folder, next.abs, def, scanOptions);
          if (!result.games.length) continue;
          for (const game of result.games) {
            for (const file of game.files) romIndex.set(`${next.folder}/${file.rel}`, file);
            for (const file of game.extras) romIndex.set(`${next.folder}/${file.rel}`, file);
          }
          for (const rel of result.mediaFiles) mediaIndex.add(`${next.folder}/${rel}`);
          systems.push({ folder: next.folder, absDir: next.abs, def, games: result.games, bios: resolveBios(next.folder, def, bios) });
        } catch (error) {
          this.log.error('system scan failed', { system: next.folder, error: error as Error });
        }
      }
    });
    await Promise.all(workers);

    systems.sort(
      (a, b) =>
        manufacturerRank(a.def.manufacturer) - manufacturerRank(b.def.manufacturer) ||
        a.def.year - b.def.year ||
        a.def.name.localeCompare(b.def.name),
    );
    for (const system of systems) system.games.sort((a, b) => a.sortName.localeCompare(b.sortName));

    const gamesById = new Map<string, GameRecord>();
    for (const system of systems) for (const game of system.games) gamesById.set(game.id, game);

    const durationMs = Math.round(performance.now() - started);
    const scannedAt = new Date();
    const summaries = systems.map((s) => this.systemSummary(s));
    const payload = await this.encodePayload({
      status: 'ready',
      scannedAt: scannedAt.toISOString(),
      durationMs,
      systems: summaries,
      games: systems.flatMap((s) => s.games.map((g) => this.gameSummary(g))),
    });

    this.state = {
      scannedAt,
      durationMs,
      systems,
      systemsByFolder: new Map(systems.map((s) => [s.folder, s])),
      gamesById,
      romIndex,
      mediaIndex,
      bios,
      payload,
      summaries,
    };
    this.log.info('scan finished', {
      reason,
      systems: systems.length,
      games: gamesById.size,
      biosFiles: bios.files.size,
      ms: durationMs,
      payloadKiB: Math.round(payload.br.length / 1024),
    });
  }

  private async encodePayload(payload: LibraryPayload): Promise<EncodedPayload> {
    const json = Buffer.from(JSON.stringify(payload));
    const [br, gz] = await Promise.all([
      brotli(json, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: json.length } }),
      gzip(json, { level: 6 }),
    ]);
    const etag = `"lib-${createHash('sha1').update(json).digest('base64url').slice(0, 20)}"`;
    return { etag, br, gzip: gz, identity: () => zlib.gunzipSync(gz) };
  }

  /* ---------------- lookups (whitelists) ---------------- */

  payload(): EncodedPayload | null {
    return this.state?.payload ?? null;
  }

  systems(): SystemSummary[] {
    return this.state?.summaries ?? [];
  }

  game(id: string): GameRecord | undefined {
    return this.state?.gamesById.get(id);
  }

  system(folder: string): SystemRecord | undefined {
    return this.state?.systemsByFolder.get(folder);
  }

  romFile(folder: string, rel: string): FileRef | undefined {
    return this.state?.romIndex.get(`${folder}/${rel}`);
  }

  hasMedia(folder: string, rel: string): boolean {
    return this.state?.mediaIndex.has(`${folder}/${rel}`) ?? false;
  }

  biosFile(rel: string): FileRef | undefined {
    return this.state?.bios.files.get(rel);
  }

  /* ---------------- archive descriptions ---------------- */

  /** Disc set handed to the emulator (classic ZIP with CRCs up front, the most compatible form). */
  gameArchive(game: GameRecord): { name: string; entries: ZipEntryInput[] } | null {
    if (game.files.length < 2) return null;
    const primary = game.files[0]!;
    const entries = game.files.map((f) => ({ name: archiveNameFor(f.rel, primary.rel), absPath: f.abs, size: f.size, mtimeMs: f.mtimeMs }));
    return { name: `${baseName(primary.rel).replace(/\.[^.]+$/, '')}.zip`, entries };
  }

  /**
   * "Download everything": an ES-DE folder game as its whole directory, or a game together with
   * its update/DLC files, keeping the folder layout. Streamed with ZIP64 when needed.
   */
  downloadArchive(game: GameRecord): { name: string; entries: () => Promise<ZipEntryInput[]> } | null {
    const system = this.system(game.folder);
    if (!system) return null;
    if (game.directory) {
      const top = baseName(game.directory);
      const root = path.join(system.absDir, game.directory);
      return {
        name: `${top.replace(/\.[^.]+$/, '')}.zip`,
        entries: async () =>
          (await directoryContents(root, this.config.followSymlinks)).map((f) => ({ name: `${top}/${f.rel}`, absPath: f.abs, size: f.size, mtimeMs: f.mtimeMs })),
      };
    }
    if (!game.extras.length) return null;
    const top = game.baseDir ? baseName(game.baseDir) : '';
    const within = (rel: string) => (game.baseDir ? path.posix.relative(game.baseDir, rel) : rel);
    const all = [...game.files, ...game.extras];
    return {
      name: `${top || baseName(game.rel).replace(/\.[^.]+$/, '')}.zip`,
      entries: async () => all.map((f) => ({ name: top ? `${top}/${within(f.rel)}` : within(f.rel), absPath: f.abs, size: f.size, mtimeMs: f.mtimeMs })),
    };
  }

  biosArchive(folder: string): { name: string; entries: ZipEntryInput[] } | null {
    const system = this.system(folder);
    if (!system || system.bios.delivery !== 'bundle') return null;
    const seen = new Set<string>();
    const entries: ZipEntryInput[] = [];
    for (const file of system.bios.files) {
      const name = baseName(file.rel);
      if (seen.has(name.toLowerCase())) continue; // EmulatorJS flattens archive paths
      seen.add(name.toLowerCase());
      entries.push({ name, absPath: file.abs, size: file.size, mtimeMs: file.mtimeMs });
    }
    return { name: `${folder}-bios.zip`, entries };
  }

  /* ---------------- DTOs ---------------- */

  private systemSummary(system: SystemRecord): SystemSummary {
    const { def } = system;
    return {
      id: system.folder,
      name: def.name,
      shortName: def.shortName,
      manufacturer: def.manufacturer,
      year: def.year || undefined,
      mode: def.core ? 'play' : 'download',
      requiresIsolation: Boolean(def.core && def.threads),
      gameCount: system.games.length,
      coverAspect: def.coverAspect ?? 0.75,
    };
  }

  private mediaUrl(folder: string, rel: string | undefined): string | undefined {
    return rel ? `/media/${encodeURIComponent(folder)}/${encodePath(rel)}` : undefined;
  }

  private gameSummary(game: GameRecord): GameSummary {
    const summary: GameSummary = {
      id: game.id,
      system: game.folder,
      name: game.name,
      sortName: game.sortName,
      fileName: baseName(game.directory ?? game.rel),
      size: game.files.reduce((sum, f) => sum + f.size, 0),
    };
    if (game.year) summary.year = game.year;
    if (game.releaseDate) summary.releaseDate = game.releaseDate;
    if (game.genres) summary.genres = game.genres;
    if (game.developer) summary.developer = game.developer;
    if (game.publisher) summary.publisher = game.publisher;
    if (game.players) summary.players = game.players;
    if (game.rating) summary.rating = game.rating;
    const cover = this.mediaUrl(game.folder, game.media.cover);
    if (cover) summary.cover = cover;
    if (game.files.length > 1) summary.multiFile = true;
    if (game.extras.length) summary.extraCount = game.extras.length;
    if (game.directory) summary.directory = true;
    return summary;
  }

  private romUrl(folder: string, rel: string): string {
    return `/files/roms/${encodeURIComponent(folder)}/${encodePath(rel)}`;
  }

  private biosInfo(system: SystemRecord): BiosInfo {
    const { def, bios } = system;
    const info: BiosInfo = {
      required: Boolean(def.bios?.required),
      present: bios.files.length > 0,
      folder: bios.folder || '.',
      files: bios.available.map((f) => ({ name: f.rel, size: f.size, url: `/files/bios/${encodePath(f.rel)}` })),
    };
    if (def.bios?.files) info.expected = def.bios.files;
    if (def.bios?.note) info.note = def.bios.note;
    const archive = this.biosArchive(system.folder);
    if (archive && canZip(archive.entries)) {
      info.bundle = {
        name: archive.name,
        size: archive.entries.reduce((sum, e) => sum + e.size, 0),
        url: `/files/bios-bundle/${encodeURIComponent(system.folder)}/${encodeURIComponent(archive.name)}`,
      };
    }
    return info;
  }

  detail(game: GameRecord): GameDetail | null {
    const system = this.system(game.folder);
    if (!system) return null;
    const { def } = system;
    const summary = this.gameSummary(game);
    const files: FileLink[] = game.files.map((f) => ({ name: f.rel, size: f.size, url: this.romUrl(game.folder, f.rel) }));
    const extras: ExtraLink[] = game.extras.map((f) => ({ name: f.rel, size: f.size, url: this.romUrl(game.folder, f.rel), kind: f.kind }));

    const archive = this.gameArchive(game);
    const archiveOk = archive ? canZip(archive.entries) : false;
    const archiveUrl = archive ? `/files/bundles/${game.id}/${encodeURIComponent(archive.name)}` : undefined;
    const full = this.downloadArchive(game);
    const downloadAll: FileLink | undefined = full
      ? {
          name: full.name,
          size: game.directory ? 0 : [...game.files, ...game.extras].reduce((sum, f) => sum + f.size, 0),
          url: `/files/full/${game.id}/${encodeURIComponent(full.name)}`,
        }
      : undefined;
    const download: FileLink | undefined = game.directory
      ? downloadAll
      : archive
        ? archiveOk
          ? { name: archive.name, size: summary.size, url: archiveUrl! }
          : undefined
        : files[0];

    const media: GameDetail['media'] = {};
    for (const [kind, rel] of Object.entries(game.media)) {
      const url = this.mediaUrl(game.folder, rel);
      if (url) media[kind as keyof GameDetail['media']] = url;
    }

    const bios = this.biosInfo(system);
    const detail: GameDetail = { ...summary, systemName: def.name, media, files, extras, bios };
    if (download) detail.download = download;
    if (downloadAll) detail.downloadAll = downloadAll;
    if (game.description) detail.description = game.description;
    if (game.descriptions) detail.descriptions = game.descriptions;
    if (def.setup) detail.setup = def.setup;

    if (!def.core || !game.files.length) {
      detail.unplayableReason = 'no-browser-core';
    } else if (archive && !archiveOk) {
      detail.unplayableReason = 'archive-too-large';
    } else {
      const play: PlayConfig = {
        core: def.core,
        gameUrl: archive ? archiveUrl! : this.romUrl(game.folder, game.files[0]!.rel),
        gameName: sanitizeGameName(`${game.name} [${game.folder}]`),
        threads: Boolean(def.threads),
        dataPath: this.config.ejsDataPath,
        cacheLimit: this.config.ejsCacheLimitBytes,
      };
      const biosFile = system.bios.files[0];
      if (system.bios.delivery === 'file' && biosFile) play.biosUrl = `/files/bios/${encodePath(biosFile.rel)}`;
      else if (system.bios.delivery === 'bundle' && bios.bundle) play.biosUrl = bios.bundle.url;
      detail.play = play;
    }
    return detail;
  }

  /** Top systems, used for PWA shortcuts. */
  topSystems(limit: number): SystemSummary[] {
    return [...this.systems()].sort((a, b) => b.gameCount - a.gameCount).slice(0, limit);
  }

  systemRoot(folder: string): string | undefined {
    const system = this.system(folder);
    return system ? path.resolve(system.absDir) : undefined;
  }
}

/** EmulatorJS strips these characters itself; doing it here keeps names stable across versions. */
function sanitizeGameName(name: string): string {
  return name.replace(/[#<$+%>!`&*'|{}/\\?"=@:^\r\n]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'game';
}
