import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { GameDetail, LibraryPayload } from '../../shared/api.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/http/app.js';
import { Catalog } from '../src/library/catalog.js';
import { createLogger } from '../src/logger.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-lib-'));
const lib = path.join(root, 'library');

function write(rel: string, data: string | Buffer): void {
  const abs = path.join(lib, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, data);
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a00000000049454e44ae426082', 'hex');

function buildFixture(): void {
  write('secret.txt', 'top secret');
  write('roms/gba/Advance Wars (USA).gba', Buffer.alloc(4096, 1));
  write('roms/gba/Homebrew_Demo.gba', Buffer.alloc(2048, 2));
  write('roms/gba/notes.txt', 'not a game');
  write('roms/gba/readme.md', '# not a game either');
  write('roms/megadrive/Blast Processing.md', Buffer.alloc(512, 24));
  write('roms/gba/covers/Advance Wars (USA).png', PNG);
  write(
    'roms/gba/gamelist.xml',
    `<?xml version="1.0"?><gameList><game><path>./Advance Wars (USA).gba</path><name>Advance Wars</name>
     <releasedate>20010910T000000</releasedate><genre>Strategy</genre><desc>Tactics.</desc></game></gameList>`,
  );
  fs.symlinkSync(path.join(lib, 'secret.txt'), path.join(lib, 'roms/gba/link.gba'));

  write('roms/psx/Disc Game.cue', 'FILE "Disc Game (Track 1).bin" BINARY\nFILE "disc game (track 2).BIN" BINARY\n');
  write('roms/psx/Disc Game (Track 1).bin', Buffer.alloc(10_000, 3));
  write('roms/psx/Disc Game (Track 2).bin', Buffer.alloc(5_000, 4));
  write('roms/psx/Multi.m3u', '# playlist\nMulti (Disc 1).cue\nMulti (Disc 2).cue\n');
  write('roms/psx/Multi (Disc 1).cue', 'FILE "Multi (Disc 1).bin" BINARY\n');
  write('roms/psx/Multi (Disc 1).bin', Buffer.alloc(3000, 5));
  write('roms/psx/Multi (Disc 2).cue', 'FILE "Multi (Disc 2).bin" BINARY\n');
  write('roms/psx/Multi (Disc 2).bin', Buffer.alloc(3000, 6));
  write('roms/psx/Solo.chd', Buffer.alloc(1000, 7));
  write('roms/psx/Escape.cue', 'FILE "../../secret.txt" BINARY\n');

  write('roms/n3ds/Some Game.3ds', Buffer.alloc(500, 8));
  write('roms/n3ds/Other Title.3ds', Buffer.alloc(400, 8));
  // The reported layout: game folder with the main CIA plus UPDATE / DLC subfolders.
  write('roms/n3ds/Zelda/Zelda (Europe) (En,Fr,De) [0004000000033500].cia', Buffer.alloc(3000, 13));
  write('roms/n3ds/Zelda/UPDATE/Zelda (Update v1.2) [0004000E00033500].cia', Buffer.alloc(1500, 14));
  write('roms/n3ds/Zelda/DLC/Zelda Bonus Pack [0004008C00033500].cia', Buffer.alloc(700, 15));
  // Same layout without any metadata: the folder name becomes the title.
  write('roms/n3ds/Tidal Garden/Tidal Garden (USA) (En) [00040000000AAA00].cia', Buffer.alloc(900, 22));
  write('roms/n3ds/Tidal Garden/Update/Tidal Garden (Update v1.0.2) [0004000E000AAA00].cia', Buffer.alloc(200, 23));
  // Root-level UPDATE folder: several candidates, matched by name.
  write('roms/n3ds/UPDATE/Some Game (Update v1.1).cia', Buffer.alloc(300, 16));
  write(
    'roms/n3ds/gamelist.xml',
    `<?xml version="1.0"?><gameList>
       <game><path>./Zelda/UPDATE/Zelda (Update v1.2) [0004000E00033500].cia</path><name>Zelda Update</name></game>
       <folder><path>./Zelda</path><name>The Legend of Zelda</name><desc>From the folder entry.</desc></folder>
     </gameList>`,
  );
  // ES-DE "directories interpreted as files".
  write('roms/ps3/Demon Quest.ps3/PS3_DISC.SFB', Buffer.alloc(64, 17));
  write('roms/ps3/Demon Quest.ps3/PS3_GAME/PARAM.SFO', Buffer.alloc(128, 18));
  write('roms/ps3/Demon Quest.ps3/PS3_GAME/USRDIR/EBOOT.BIN', Buffer.alloc(2048, 19));
  write('roms/psx/Saga.m3u/Saga.m3u', 'Saga (Disc 1).chd\nSaga (Disc 2).chd\n');
  write('roms/psx/Saga.m3u/Saga (Disc 1).chd', Buffer.alloc(2000, 20));
  write('roms/psx/Saga.m3u/Saga (Disc 2).chd', Buffer.alloc(2100, 21));
  // > 4 GiB download (sparse, takes no disk space) to exercise ZIP64.
  write('roms/switch/Big Game/UPDATE/Big Game Update.nsp', Buffer.from('update-bytes'));
  fs.writeFileSync(path.join(lib, 'roms/switch/Big Game/Big Game.nsp'), '');
  fs.truncateSync(path.join(lib, 'roms/switch/Big Game/Big Game.nsp'), 4_400_000_000);
  write('roms/mystery/thing.bin', Buffer.alloc(100, 9));

  write('bios/gba/gba_bios.bin', Buffer.alloc(16_384, 10));
  write('bios/psx/scph5501.bin', Buffer.alloc(1024, 11));
  write('bios/psx/scph1001.bin', Buffer.alloc(1024, 12));
  write('bios/psx/readme.txt', 'ignored for the core, still downloadable');
}

let server: http.Server;
let base: string;
let port: number;

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

/** Raw request: unlike fetch(), sends the path exactly as written (no dot-segment normalisation). */
function raw(method: string, rawPath: string, headers: Record<string, string> = {}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: rawPath, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function json<T>(urlPath: string): Promise<T> {
  const res = await fetch(base + urlPath);
  assert.equal(res.status, 200, urlPath);
  return (await res.json()) as T;
}

let library: LibraryPayload;
const gameByName = (name: string) => {
  const game = library.games.find((g) => g.name === name);
  assert.ok(game, `missing game ${name}`);
  return game;
};

before(async () => {
  buildFixture();
  process.env.LIBRARY_DIR = lib;
  process.env.WEB_DIR = path.join(root, 'no-web');
  process.env.LOG_LEVEL = 'error';
  process.env.SCAN_COOLDOWN_SECONDS = '0';
  const config = loadConfig();
  const log = createLogger(config.logLevel);
  const catalog = new Catalog(config, log);
  const app = await createApp(config, catalog, log);
  await catalog.scan('test');
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  library = await json<LibraryPayload>('/api/library');
});

after(() => {
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('catalog', () => {
  it('orders systems by manufacturer and keeps unknown folders as download-only', () => {
    assert.deepEqual(
      library.systems.map((s) => [s.id, s.mode]),
      [['nes', 'play'], ['gba', 'play'], ['n3ds', 'download'], ['switch', 'download'], ['psx', 'play'], ['ps3', 'download'], ['megadrive', 'play'], ['mystery', 'download']],
    );
  });

  it('merges gamelist metadata with unlisted files and ignores junk and symlinks', () => {
    const gba = library.games.filter((g) => g.system === 'gba').map((g) => g.name).sort();
    assert.deepEqual(gba, ['Advance Wars', 'Homebrew Demo']);
    const aw = gameByName('Advance Wars');
    assert.equal(aw.year, 2001);
    assert.match(aw.cover ?? '', /^\/media\/gba\/covers\/Advance%20Wars%20\(USA\)\.png$/);
    assert.equal(aw.coverAspect, 1); // the fixture cover is a 1×1 PNG
  });

  it('accepts note extensions only where a system uses them (.md Mega Drive ROMs)', () => {
    assert.deepEqual(library.games.filter((g) => g.system === 'megadrive').map((g) => g.name), ['Blast Processing']);
  });

  it('groups disc sets and hides their members', () => {
    const psx = library.games.filter((g) => g.system === 'psx').map((g) => [g.name, Boolean(g.multiFile)]).sort();
    assert.deepEqual(psx, [['Disc Game', true], ['Escape', false], ['Multi', true], ['Saga', true], ['Solo', false]]);
    assert.equal(gameByName('Multi').size, 6000 + 2 * 'FILE "Multi (Disc 1).bin" BINARY\n'.length + '# playlist\nMulti (Disc 1).cue\nMulti (Disc 2).cue\n'.length);
  });

  it('builds play configs with BIOS delivery', async () => {
    const aw = await json<GameDetail>(`/api/games/${gameByName('Advance Wars').id}`);
    assert.equal(aw.play?.core, 'gba');
    assert.equal(aw.play?.biosUrl, '/files/bios/gba/gba_bios.bin');
    assert.equal(aw.description, 'Tactics.');

    const disc = await json<GameDetail>(`/api/games/${gameByName('Disc Game').id}`);
    assert.match(disc.play?.gameUrl ?? '', /^\/files\/bundles\/[\w-]+\/Disc%20Game\.zip$/);
    assert.equal(disc.play?.biosUrl, '/files/bios-bundle/psx/psx-bios.zip');
    assert.equal(disc.bios.files.length, 3);

    const ds = await json<GameDetail>(`/api/games/${gameByName('Some Game').id}`);
    assert.equal(ds.play, undefined);
    assert.equal(ds.setup?.emulator, 'Azahar');
    assert.equal(ds.setup?.guide, 'azahar');
    assert.equal(ds.unplayableReason, 'no-browser-core');
    assert.ok(ds.download);
  });
});

describe('game folders', () => {
  it('attaches UPDATE and DLC folders to their game instead of listing them', () => {
    const n3ds = library.games.filter((g) => g.system === 'n3ds').map((g) => [g.name, g.extraCount ?? 0]).sort();
    assert.deepEqual(n3ds, [['Other Title', 0], ['Some Game', 1], ['The Legend of Zelda', 2], ['Tidal Garden', 1]]);
  });

  it('uses <folder> metadata and streams the whole game folder as one zip', async () => {
    const zelda = await json<GameDetail>(`/api/games/${gameByName('The Legend of Zelda').id}`);
    assert.equal(zelda.description, 'From the folder entry.');
    assert.deepEqual(zelda.extras.map((e) => e.kind), ['dlc', 'update']);
    assert.match(zelda.downloadAll?.url ?? '', /^\/files\/full\/[\w-]+\/Zelda\.zip$/);
    assert.equal((await raw('GET', zelda.extras[1]!.url)).status, 200);

    // A resumed download first (CRCs not cached yet), then the full one.
    const url = zelda.downloadAll!.url;
    const head = await raw('HEAD', url);
    const tail = await raw('GET', url, { Range: 'bytes=1000-' });
    const full = await raw('GET', url);
    assert.equal(String(full.body.length), head.headers['content-length']);
    assert.deepEqual(tail.body, full.body.subarray(1000));
    const zipPath = path.join(root, 'zelda.zip');
    fs.writeFileSync(zipPath, full.body);
    const names = execFileSync('python3', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print("|".join(z.namelist()))', zipPath]).toString().trim();
    assert.equal(
      names,
      'Zelda/Zelda (Europe) (En,Fr,De) [0004000000033500].cia|Zelda/DLC/Zelda Bonus Pack [0004008C00033500].cia|Zelda/UPDATE/Zelda (Update v1.2) [0004000E00033500].cia',
    );
  });

  it('treats ES-DE "directories interpreted as files" as single games', async () => {
    const demon = gameByName('Demon Quest');
    assert.equal(demon.directory, true);
    const detail = await json<GameDetail>(`/api/games/${demon.id}`);
    assert.equal(detail.download?.url, detail.downloadAll?.url);
    const zip = await raw('GET', detail.download!.url);
    const zipPath = path.join(root, 'demon.zip');
    fs.writeFileSync(zipPath, zip.body);
    const names = execFileSync('python3', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print("|".join(z.namelist()))', zipPath]).toString().trim();
    assert.equal(names, 'Demon Quest.ps3/PS3_DISC.SFB|Demon Quest.ps3/PS3_GAME/PARAM.SFO|Demon Quest.ps3/PS3_GAME/USRDIR/EBOOT.BIN');

    const saga = await json<GameDetail>(`/api/games/${gameByName('Saga').id}`);
    assert.equal(saga.files.length, 3);
    assert.match(saga.play?.gameUrl ?? '', /^\/files\/bundles\/[\w-]+\/Saga\.zip$/);
  });

  it('streams archives over 4 GiB as valid ZIP64, readable through byte ranges', async () => {
    const big = await json<GameDetail>(`/api/games/${gameByName('Big Game').id}`);
    const url = `${base}${big.downloadAll!.url}`;
    const script = `
import io, sys, urllib.request, zipfile
class HttpFile(io.RawIOBase):
    def __init__(self, url):
        self.url, self.pos = url, 0
        self.size = int(urllib.request.urlopen(urllib.request.Request(url, method='HEAD')).headers['Content-Length'])
    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos
    def readinto(self, b):
        if self.pos >= self.size or len(b) == 0: return 0
        end = min(self.size, self.pos + len(b)) - 1
        data = urllib.request.urlopen(urllib.request.Request(self.url, headers={'Range': f'bytes={self.pos}-{end}'})).read()
        b[:len(data)] = data
        self.pos += len(data)
        return len(data)
z = zipfile.ZipFile(io.BufferedReader(HttpFile(sys.argv[1]), 65536))
print('|'.join(f'{i.filename}:{i.file_size}' for i in z.infolist()))
print(z.read('Big Game/UPDATE/Big Game Update.nsp').decode())
with z.open('Big Game/Big Game.nsp') as f: print(f.read(4).hex())
`;
    // Async on purpose: the server runs in this process and must keep answering Python's range requests.
    const { stdout } = await promisify(execFile)('python3', ['-c', script, url], { timeout: 120_000 });
    const out = stdout.trim().split('\n');
    assert.deepEqual(out, ['Big Game/Big Game.nsp:4400000000|Big Game/UPDATE/Big Game Update.nsp:12', 'update-bytes', '00000000']);
  });
});

describe('byte ranges', () => {
  const romPath = '/files/roms/gba/Advance%20Wars%20(USA).gba';

  it('serves full, partial, suffix and HEAD requests', async () => {
    const full = await raw('GET', romPath);
    assert.equal(full.status, 200);
    assert.equal(full.headers['accept-ranges'], 'bytes');
    assert.equal(full.body.length, 4096);

    const part = await raw('GET', romPath, { Range: 'bytes=100-199' });
    assert.equal(part.status, 206);
    assert.equal(part.headers['content-range'], 'bytes 100-199/4096');
    assert.equal(part.body.length, 100);

    const suffix = await raw('GET', romPath, { Range: 'bytes=-10' });
    assert.equal(suffix.headers['content-range'], 'bytes 4086-4095/4096');

    const head = await raw('HEAD', romPath);
    assert.equal(head.status, 200);
    assert.equal(head.headers['content-length'], '4096');
    assert.equal(head.body.length, 0);
  });

  it('answers 416, honours If-Range and conditional requests', async () => {
    const bad = await raw('GET', romPath, { Range: 'bytes=5000-' });
    assert.equal(bad.status, 416);
    assert.equal(bad.headers['content-range'], 'bytes */4096');

    const first = await raw('HEAD', romPath);
    const etag = String(first.headers.etag);
    assert.equal((await raw('GET', romPath, { Range: 'bytes=0-9', 'If-Range': '"stale"' })).status, 200);
    assert.equal((await raw('GET', romPath, { Range: 'bytes=0-9', 'If-Range': etag })).status, 206);
    assert.equal((await raw('GET', romPath, { 'If-None-Match': etag })).status, 304);
  });

  it('streams disc sets and BIOS folders as valid, range-addressable zips', async () => {
    const disc = await json<GameDetail>(`/api/games/${gameByName('Multi').id}`);
    const url = disc.play!.gameUrl;
    const head = await raw('HEAD', url);
    const full = await raw('GET', url);
    assert.equal(full.status, 200);
    assert.equal(String(full.body.length), head.headers['content-length']);
    const zipPath = path.join(root, 'multi.zip');
    fs.writeFileSync(zipPath, full.body);
    const names = execFileSync('python3', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print("|".join(z.namelist()))', zipPath]).toString().trim();
    assert.equal(names, 'Multi.m3u|Multi (Disc 1).cue|Multi (Disc 1).bin|Multi (Disc 2).cue|Multi (Disc 2).bin');

    const part = await raw('GET', url, { Range: 'bytes=50-1500' });
    assert.equal(part.status, 206);
    assert.deepEqual(part.body, full.body.subarray(50, 1501));

    const bios = await raw('GET', '/files/bios-bundle/psx/psx-bios.zip');
    assert.equal(bios.status, 200);
    assert.equal(bios.headers['content-type'], 'application/zip');
  });
});

describe('path safety over HTTP', () => {
  const attempts = [
    '/files/roms/gba/../../secret.txt',
    '/files/roms/gba/..%2f..%2fsecret.txt',
    '/files/roms/gba/%2e%2e/%2e%2e/secret.txt',
    '/files/roms/gba/link.gba',
    '/files/roms/gba/notes.txt',
    '/files/roms/..%2f/secret.txt',
    '/files/roms/psx/..%5c..%5csecret.txt',
    '/files/bios/../secret.txt',
    '/files/bios/..%2fsecret.txt',
    '/files/bios/psx/%00scph5501.bin',
    '/media/gba/../../secret.txt',
    '/media/gba/covers/..%2f..%2f..%2fsecret.txt',
    '/media/gba/Advance%20Wars%20(USA).gba',
    '/files/bundles/xxxxxxxxxxxx/secret.zip',
    '/files/full/xxxxxxxxxxxx/secret.zip',
    '/files/full/..%2f..%2fsecret.txt/x.zip',
  ];

  for (const attempt of attempts) {
    it(`refuses ${attempt}`, async () => {
      const res = await raw('GET', attempt);
      assert.notEqual(res.status, 200);
      assert.ok(!res.body.toString().includes('top secret'));
    });
  }

  it('does not follow cue references outside the system folder', async () => {
    const escape = await json<GameDetail>(`/api/games/${gameByName('Escape').id}`);
    assert.equal(escape.files.length, 1);
  });
});

describe('bundled EmulatorJS', () => {
  it('serves a local EmulatorJS copy and points the player at it', async () => {
    const ejsDir = path.join(root, 'ejs', 'data');
    fs.mkdirSync(ejsDir, { recursive: true });
    fs.writeFileSync(path.join(ejsDir, 'loader.js'), '// loader');
    process.env.EJS_LOCAL_DIR = ejsDir;
    const config = loadConfig();
    delete process.env.EJS_LOCAL_DIR;
    const log = createLogger('error');
    const local = new Catalog(config, log);
    const app = await createApp(config, local, log);
    await local.scan('test');
    const instance = app.listen(0, '127.0.0.1');
    await new Promise((r) => instance.once('listening', r));
    const at = `http://127.0.0.1:${(instance.address() as AddressInfo).port}`;
    try {
      assert.equal(await (await fetch(`${at}/emulatorjs/data/loader.js`)).text(), '// loader');
      assert.equal(((await (await fetch(`${at}/api/health`)).json()) as { emulatorjs: string }).emulatorjs, 'bundled');
      const detail = (await (await fetch(`${at}/api/games/${gameByName('Advance Wars').id}`)).json()) as GameDetail;
      assert.equal(detail.play?.dataPath, '/emulatorjs/data/');
      assert.equal((await fetch(`${at}/emulatorjs/data/../../secret.txt`)).status, 404);
    } finally {
      instance.close();
    }
  });
});

describe('api surface', () => {
  it('sends isolation and hardening headers', async () => {
    const res = await raw('GET', '/api/health');
    assert.equal(res.headers['cross-origin-opener-policy'], 'same-origin');
    assert.equal(res.headers['cross-origin-embedder-policy'], 'require-corp');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  });

  it('serves the library compressed with an ETag', async () => {
    const res = await raw('GET', '/api/library', { 'Accept-Encoding': 'gzip, br' });
    assert.equal(res.headers['content-encoding'], 'br');
    const again = await raw('GET', '/api/library', { 'If-None-Match': String(res.headers.etag) });
    assert.equal(again.status, 304);
  });

  it('guards rescans', async () => {
    assert.equal((await raw('POST', '/api/scan', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.ok([202, 429].includes((await raw('POST', '/api/scan')).status));
  });

  it('localises the manifest from Accept-Language', async () => {
    const italian = JSON.parse((await raw('GET', '/manifest.json', { 'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8' })).body.toString()) as { lang: string };
    const fallback = JSON.parse((await raw('GET', '/manifest.json', { 'Accept-Language': 'de-DE,fr;q=0.8' })).body.toString()) as { lang: string };
    assert.equal(italian.lang, 'it');
    assert.equal(fallback.lang, 'en');
  });

  it('generates a manifest with system shortcuts', async () => {
    const res = await raw('GET', '/manifest.json');
    assert.match(String(res.headers['content-type']), /application\/manifest\+json/);
    const manifest = JSON.parse(res.body.toString()) as { shortcuts: Array<{ url: string }> };
    assert.ok(manifest.shortcuts.some((s) => s.url === '/?system=psx'));
  });
});
