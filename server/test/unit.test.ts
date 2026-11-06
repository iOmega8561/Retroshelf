import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buffer } from 'node:stream/consumers';
import { describe, it } from 'node:test';
import { parseRange } from '../src/http/send.js';
import { parseGamelist, parseReleaseDate, sortKey, splitGenres } from '../src/library/gamelist.js';
import { isSafeSegment, normalizeReferencedPath, resolveInside, safeRelativeFromSegments } from '../src/util/paths.js';
import { buildZipLayout, crc32ForEntries, streamZipRange, zipSize } from '../src/util/zip.js';

describe('path safety', () => {
  it('rejects traversal and hidden segments', () => {
    for (const bad of ['..', '.', '', '.git', 'a/b', 'a\\b', 'x\u0000y', 'tab\there']) assert.equal(isSafeSegment(bad), false, bad);
    assert.equal(isSafeSegment('Pokémon (USA).gba'), true);
    assert.equal(safeRelativeFromSegments(['covers', '..', 'x']), null);
    assert.equal(safeRelativeFromSegments(['sub', 'game.gba']), 'sub/game.gba');
  });

  it('keeps resolved paths inside the root', () => {
    assert.equal(resolveInside('/library/roms/gba', '../../etc/passwd'), null);
    assert.equal(resolveInside('/library/roms/gba', '/etc/passwd'), null);
    assert.equal(resolveInside('/library/roms/gba', 'a/../../gba-evil'), null);
    assert.equal(resolveInside('/library/roms/gba', 'a/b.gba'), '/library/roms/gba/a/b.gba');
  });

  it('normalises gamelist and cue references', () => {
    assert.equal(normalizeReferencedPath('./covers/a.png'), 'covers/a.png');
    assert.equal(normalizeReferencedPath('Track 01.bin', 'discs'), 'discs/Track 01.bin');
    assert.equal(normalizeReferencedPath('..\\..\\secret.bin', 'discs'), null);
    assert.equal(normalizeReferencedPath('/etc/passwd'), null);
    assert.equal(normalizeReferencedPath('C:\\roms\\a.bin'), null);
    assert.equal(normalizeReferencedPath('~/.emulationstation/x.png'), null);
  });
});

describe('range parsing', () => {
  it('handles the standard forms', () => {
    assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
    assert.deepEqual(parseRange('bytes=900-', 1000), { start: 900, end: 999 });
    assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
    assert.deepEqual(parseRange('bytes=-5000', 1000), { start: 0, end: 999 });
    assert.deepEqual(parseRange('bytes=990-5000', 1000), { start: 990, end: 999 });
  });

  it('reports unsatisfiable and ignores malformed or multi-range headers', () => {
    assert.equal(parseRange('bytes=1000-', 1000), 'unsatisfiable');
    assert.equal(parseRange('bytes=-0', 1000), 'unsatisfiable');
    assert.equal(parseRange('bytes=0-1', 0), 'unsatisfiable');
    assert.equal(parseRange('bytes=5-1', 1000), 'ignore');
    assert.equal(parseRange('items=0-1', 1000), 'ignore');
    assert.equal(parseRange('bytes=0-1,5-6', 1000), 'ignore');
    assert.equal(parseRange('bytes=abc', 1000), 'ignore');
  });
});

describe('gamelist parsing', () => {
  const xml = `<?xml version="1.0"?>
  <gameList>
    <alternativeEmulator><label>x</label></alternativeEmulator>
    <game id="1" source="ScreenScraper.fr">
      <path>./Advance Wars (USA).gba</path>
      <name>Advance Wars</name>
      <desc>Command &amp; conquer &#8212; on the go.</desc>
      <rating>0.9</rating>
      <releasedate>20010910T000000</releasedate>
      <developer>Intelligent Systems</developer>
      <genre>Strategy / Turn-based, Tactics</genre>
      <players>1-4</players>
      <image>./covers/aw.png</image>
    </game>
    <game><path>./hidden.gba</path><hidden>true</hidden></game>
  </gameList>`;

  it('extracts and normalises fields', () => {
    const [first, second] = parseGamelist(xml).games;
    assert.equal(first?.name, 'Advance Wars');
    assert.equal(first?.description, 'Command & conquer \u2014 on the go.');
    assert.equal(first?.rating, 0.9);
    assert.equal(first?.year, 2001);
    assert.equal(first?.releaseDate, '2001-09-10');
    assert.equal(first?.image, './covers/aw.png');
    assert.equal(second?.hidden, true);
  });

  it('handles a single game and partial dates', () => {
    assert.equal(parseGamelist('<gameList><game><path>./a.nes</path></game></gameList>').games.length, 1);
    const folders = parseGamelist('<gameList><folder><path>./Zelda</path><name>Zelda</name></folder></gameList>').folders;
    assert.deepEqual(folders.map((f) => [f.path, f.name]), [['./Zelda', 'Zelda']]);
    assert.deepEqual(parseReleaseDate('19960000T000000'), { year: 1996, date: '1996' });
    assert.deepEqual(parseReleaseDate('garbage'), {});
  });

  it('splits genres and builds sort keys', () => {
    assert.deepEqual(splitGenres('Strategy / Turn-based, Tactics, strategy'), ['Strategy', 'Turn-based', 'Tactics']);
    assert.equal(sortKey('The Légend of Zelda: Minish Cap'), 'legend of zelda minish cap');
  });
});

describe('virtual zip', () => {
  it('produces an archive that standard tools accept, and serves exact ranges', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-zip-'));
    const a = path.join(dir, 'Game.cue');
    const b = path.join(dir, 'Game (Track 1).bin');
    fs.writeFileSync(a, 'FILE "Game (Track 1).bin" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n');
    fs.writeFileSync(b, Buffer.alloc(300_000, 7));
    const entries = [a, b].map((abs) => {
      const st = fs.statSync(abs);
      return { name: path.basename(abs), absPath: abs, size: st.size, mtimeMs: st.mtimeMs };
    });
    const layout = buildZipLayout(entries, await crc32ForEntries(entries));
    assert.equal(layout.size, zipSize(entries));

    const whole = await buffer(streamZipRange(layout, 0, layout.size - 1));
    assert.equal(whole.length, layout.size);
    const zipPath = path.join(dir, 'out.zip');
    fs.writeFileSync(zipPath, whole);
    const check = execFileSync('python3', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip()); print(len(z.namelist()))', zipPath]).toString();
    assert.equal(check.trim(), 'None\n2');

    const slice = await buffer(streamZipRange(layout, 1000, 250_123));
    assert.deepEqual(slice, whole.subarray(1000, 250_124));
  });
});
