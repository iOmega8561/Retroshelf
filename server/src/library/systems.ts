import type { BiosNoteId, GuideId } from '../../../shared/api.js';

/**
 * Known systems, keyed by ES-DE folder names.
 *
 * `core` is the value passed as EJS_core and must exist in EmulatorJS' getCores() table
 * (checked against EmulatorJS 4.2.3). Systems without a core are download-only: the UI
 * offers the ROM/BIOS plus a setup guide for a native emulator instead of a canvas that
 * cannot run.
 */

export interface BiosSpec {
  required: boolean;
  /** Preferred file names (case-insensitive). Others in the folder are ignored when any match. */
  files?: string[];
  note?: BiosNoteId;
  /** Hand the BIOS over still zipped (e.g. neogeo.zip must stay an archive for FBNeo). */
  keepArchives?: boolean;
}

export interface SetupSpec {
  guide: GuideId;
  /** Proper name only; omitted when there is no single obvious choice. */
  emulator?: string;
  url?: string;
}

export interface SystemDef {
  key: string;
  name: string;
  shortName: string;
  manufacturer: string;
  year: number;
  folders: string[];
  core?: string;
  /** Core is only built with pthreads → needs SharedArrayBuffer / cross-origin isolation. */
  threads?: boolean;
  /** Lowercase extensions without dot. Undefined = accept any non-media file. */
  extensions?: string[];
  bios?: BiosSpec;
  setup?: SetupSpec;
  coverAspect?: number;
}

const ARCHIVES = ['zip', '7z'];

export const SYSTEMS: readonly SystemDef[] = [
  /* ---------------- Nintendo ---------------- */
  { key: 'nes', name: 'Nintendo Entertainment System', shortName: 'NES', manufacturer: 'Nintendo', year: 1983,
    folders: ['nes', 'famicom'], core: 'nes', extensions: ['nes', 'unf', 'unif', ...ARCHIVES], coverAspect: 0.72 },
  { key: 'fds', name: 'Famicom Disk System', shortName: 'FDS', manufacturer: 'Nintendo', year: 1986,
    folders: ['fds'], core: 'nes', extensions: ['fds', ...ARCHIVES], coverAspect: 0.72,
    bios: { required: true, files: ['disksys.rom'] } },
  { key: 'snes', name: 'Super Nintendo', shortName: 'SNES', manufacturer: 'Nintendo', year: 1990,
    folders: ['snes', 'sfc', 'snesna', 'superfamicom'], core: 'snes',
    extensions: ['smc', 'sfc', 'fig', 'swc', 'bs', 'st', ...ARCHIVES], coverAspect: 1.36 },
  { key: 'virtualboy', name: 'Virtual Boy', shortName: 'VB', manufacturer: 'Nintendo', year: 1995,
    folders: ['virtualboy', 'vb'], core: 'vb', extensions: ['vb', 'vboy', 'bin', ...ARCHIVES], coverAspect: 0.75 },
  { key: 'n64', name: 'Nintendo 64', shortName: 'N64', manufacturer: 'Nintendo', year: 1996,
    folders: ['n64'], core: 'n64', extensions: ['n64', 'z64', 'v64', ...ARCHIVES], coverAspect: 1.36 },
  { key: 'gb', name: 'Game Boy', shortName: 'GB', manufacturer: 'Nintendo', year: 1989,
    folders: ['gb'], core: 'gb', extensions: ['gb', ...ARCHIVES], coverAspect: 0.9 },
  { key: 'gbc', name: 'Game Boy Color', shortName: 'GBC', manufacturer: 'Nintendo', year: 1998,
    folders: ['gbc'], core: 'gb', extensions: ['gbc', 'gb', ...ARCHIVES], coverAspect: 0.9 },
  { key: 'gba', name: 'Game Boy Advance', shortName: 'GBA', manufacturer: 'Nintendo', year: 2001,
    folders: ['gba'], core: 'gba', extensions: ['gba', ...ARCHIVES], coverAspect: 1,
    bios: { required: false, files: ['gba_bios.bin'], note: 'gba-optional' } },
  { key: 'nds', name: 'Nintendo DS', shortName: 'NDS', manufacturer: 'Nintendo', year: 2004,
    folders: ['nds'], core: 'nds', extensions: ['nds', ...ARCHIVES], coverAspect: 1.12,
    bios: { required: false, files: ['bios7.bin', 'bios9.bin', 'firmware.bin'], note: 'nds-optional' } },
  { key: 'n3ds', name: 'Nintendo 3DS', shortName: '3DS', manufacturer: 'Nintendo', year: 2011,
    folders: ['n3ds', '3ds'], extensions: ['3ds', 'cci', 'cxi', 'cia', '3dsx', 'app', 'elf', 'axf', 'z3dsx', 'zcci', 'zcia', 'zcxi'], coverAspect: 1.12,
    setup: { emulator: 'Azahar', url: 'https://azahar-emu.org/', guide: 'azahar' } },
  { key: 'gc', name: 'GameCube', shortName: 'GC', manufacturer: 'Nintendo', year: 2001,
    folders: ['gc', 'gamecube', 'ngc'], extensions: ['iso', 'gcm', 'rvz', 'ciso', 'gcz', 'wia', 'dol', 'elf'], coverAspect: 0.7,
    setup: { emulator: 'Dolphin', url: 'https://dolphin-emu.org/', guide: 'dolphin-gc' } },
  { key: 'wii', name: 'Wii', shortName: 'Wii', manufacturer: 'Nintendo', year: 2006,
    folders: ['wii'], extensions: ['iso', 'wbfs', 'rvz', 'wia', 'gcz', 'ciso', 'wad', 'dol', 'elf'], coverAspect: 0.7,
    setup: { emulator: 'Dolphin', url: 'https://dolphin-emu.org/', guide: 'dolphin-wii' } },
  { key: 'wiiu', name: 'Wii U', shortName: 'Wii U', manufacturer: 'Nintendo', year: 2012,
    folders: ['wiiu'], extensions: ['wua', 'wud', 'wux', 'rpx', 'iso'], coverAspect: 0.7,
    setup: { emulator: 'Cemu', url: 'https://cemu.info/', guide: 'cemu' } },
  { key: 'switch', name: 'Nintendo Switch', shortName: 'Switch', manufacturer: 'Nintendo', year: 2017,
    folders: ['switch'], extensions: ['nsp', 'xci', 'nsz', 'xcz'], coverAspect: 0.62,
    setup: { guide: 'switch' } },

  /* ---------------- Sony ---------------- */
  { key: 'psx', name: 'PlayStation', shortName: 'PS1', manufacturer: 'Sony', year: 1994,
    folders: ['psx', 'ps1', 'playstation'], core: 'psx',
    extensions: ['chd', 'pbp', 'cue', 'm3u', 'ccd', 'iso', 'img', 'bin', ...ARCHIVES], coverAspect: 1,
    bios: { required: false, files: ['scph5501.bin', 'scph5500.bin', 'scph5502.bin', 'scph1001.bin', 'scph7001.bin', 'scph101.bin'],
      note: 'psx-hle' } },
  { key: 'psp', name: 'PlayStation Portable', shortName: 'PSP', manufacturer: 'Sony', year: 2004,
    folders: ['psp'], core: 'psp', threads: true, extensions: ['iso', 'cso', 'pbp', 'chd', 'elf', 'prx', ...ARCHIVES], coverAspect: 0.58 },
  { key: 'ps2', name: 'PlayStation 2', shortName: 'PS2', manufacturer: 'Sony', year: 2000,
    folders: ['ps2'], extensions: ['iso', 'chd', 'cso', 'zso', 'gz', 'cue', 'bin', 'elf'], coverAspect: 0.7,
    bios: { required: true, note: 'ps2-required' },
    setup: { emulator: 'PCSX2', url: 'https://pcsx2.net/', guide: 'pcsx2' } },
  { key: 'ps3', name: 'PlayStation 3', shortName: 'PS3', manufacturer: 'Sony', year: 2006,
    folders: ['ps3'], extensions: ['ps3', 'iso', 'pkg'], coverAspect: 0.86,
    setup: { emulator: 'RPCS3', url: 'https://rpcs3.net/', guide: 'rpcs3' } },
  { key: 'psvita', name: 'PlayStation Vita', shortName: 'Vita', manufacturer: 'Sony', year: 2011,
    folders: ['psvita'], extensions: ['psvita', 'vpk', 'zip'], coverAspect: 0.6,
    setup: { emulator: 'Vita3K', url: 'https://vita3k.org/', guide: 'vita3k' } },

  /* ---------------- Sega ---------------- */
  { key: 'mastersystem', name: 'Master System', shortName: 'SMS', manufacturer: 'Sega', year: 1986,
    folders: ['mastersystem', 'sms', 'markiii'], core: 'segaMS', extensions: ['sms', 'bin', ...ARCHIVES], coverAspect: 0.72 },
  { key: 'megadrive', name: 'Mega Drive / Genesis', shortName: 'MD', manufacturer: 'Sega', year: 1988,
    folders: ['megadrive', 'genesis', 'md', 'megadrivejp'], core: 'segaMD',
    extensions: ['md', 'gen', 'smd', 'bin', '68k', 'sgd', ...ARCHIVES], coverAspect: 0.7 },
  { key: 'gamegear', name: 'Game Gear', shortName: 'GG', manufacturer: 'Sega', year: 1990,
    folders: ['gamegear', 'gg'], core: 'segaGG', extensions: ['gg', ...ARCHIVES], coverAspect: 0.72 },
  { key: 'segacd', name: 'Sega CD / Mega-CD', shortName: 'SCD', manufacturer: 'Sega', year: 1991,
    folders: ['segacd', 'megacd', 'megacdjp'], core: 'segaCD', extensions: ['chd', 'cue', 'iso', 'm3u', ...ARCHIVES], coverAspect: 0.88,
    bios: { required: true, files: ['bios_CD_U.bin', 'bios_CD_E.bin', 'bios_CD_J.bin'] } },
  { key: 'sega32x', name: 'Sega 32X', shortName: '32X', manufacturer: 'Sega', year: 1994,
    folders: ['sega32x', '32x'], core: 'sega32x', extensions: ['32x', 'bin', ...ARCHIVES], coverAspect: 0.7 },
  { key: 'saturn', name: 'Sega Saturn', shortName: 'Saturn', manufacturer: 'Sega', year: 1994,
    folders: ['saturn', 'saturnjp'], core: 'segaSaturn', extensions: ['chd', 'cue', 'ccd', 'iso', 'm3u', 'mds', ...ARCHIVES], coverAspect: 0.88,
    bios: { required: false, files: ['saturn_bios.bin'], note: 'saturn-hle' } },
  { key: 'dreamcast', name: 'Dreamcast', shortName: 'DC', manufacturer: 'Sega', year: 1998,
    folders: ['dreamcast', 'dc'], extensions: ['chd', 'cdi', 'gdi', 'cue', 'm3u'], coverAspect: 1,
    bios: { required: false, files: ['dc_boot.bin', 'dc_flash.bin'], note: 'dreamcast-optional' },
    setup: { emulator: 'Flycast', url: 'https://github.com/flyinghead/flycast', guide: 'flycast' } },

  /* ---------------- Atari ---------------- */
  { key: 'atari2600', name: 'Atari 2600', shortName: '2600', manufacturer: 'Atari', year: 1977,
    folders: ['atari2600'], core: 'atari2600', extensions: ['a26', 'bin', ...ARCHIVES], coverAspect: 0.72 },
  { key: 'atari5200', name: 'Atari 5200', shortName: '5200', manufacturer: 'Atari', year: 1982,
    folders: ['atari5200'], core: 'atari5200', extensions: ['a52', 'bin', ...ARCHIVES], coverAspect: 0.72,
    bios: { required: true, files: ['5200.rom'] } },
  { key: 'atari7800', name: 'Atari 7800', shortName: '7800', manufacturer: 'Atari', year: 1986,
    folders: ['atari7800'], core: 'atari7800', extensions: ['a78', 'bin', ...ARCHIVES], coverAspect: 0.72,
    bios: { required: false, files: ['7800 BIOS (U).rom', '7800 BIOS (E).rom'] } },
  { key: 'atarilynx', name: 'Atari Lynx', shortName: 'Lynx', manufacturer: 'Atari', year: 1989,
    folders: ['atarilynx', 'lynx'], core: 'lynx', extensions: ['lnx', 'o', ...ARCHIVES], coverAspect: 0.72,
    bios: { required: true, files: ['lynxboot.img'] } },
  { key: 'atarijaguar', name: 'Atari Jaguar', shortName: 'Jaguar', manufacturer: 'Atari', year: 1993,
    folders: ['atarijaguar', 'jaguar'], core: 'jaguar', extensions: ['j64', 'jag', 'rom', 'abs', 'cof', 'bin', 'prg', ...ARCHIVES], coverAspect: 0.72 },

  /* ---------------- NEC ---------------- */
  { key: 'pcengine', name: 'PC Engine / TurboGrafx-16', shortName: 'PCE', manufacturer: 'NEC', year: 1987,
    folders: ['pcengine', 'tg16', 'turbografx16', 'pce'], core: 'pce', extensions: ['pce', 'sgx', ...ARCHIVES], coverAspect: 0.72 },
  { key: 'pcenginecd', name: 'PC Engine CD', shortName: 'PCE-CD', manufacturer: 'NEC', year: 1988,
    folders: ['pcenginecd', 'tg-cd', 'turbografxcd'], core: 'pce', extensions: ['chd', 'cue', 'ccd', 'iso', 'm3u'], coverAspect: 1,
    bios: { required: true, files: ['syscard3.pce'] } },
  { key: 'pcfx', name: 'PC-FX', shortName: 'PC-FX', manufacturer: 'NEC', year: 1994,
    folders: ['pcfx'], core: 'pcfx', extensions: ['chd', 'cue', 'ccd', 'toc', 'm3u'], coverAspect: 1,
    bios: { required: true, files: ['pcfx.rom'] } },

  /* ---------------- SNK / Bandai / arcade ---------------- */
  { key: 'ngp', name: 'Neo Geo Pocket', shortName: 'NGP', manufacturer: 'SNK', year: 1998,
    folders: ['ngp'], core: 'ngp', extensions: ['ngp', ...ARCHIVES], coverAspect: 0.9 },
  { key: 'ngpc', name: 'Neo Geo Pocket Color', shortName: 'NGPC', manufacturer: 'SNK', year: 1999,
    folders: ['ngpc'], core: 'ngp', extensions: ['ngc', 'ngp', ...ARCHIVES], coverAspect: 0.9 },
  { key: 'neogeo', name: 'Neo Geo', shortName: 'MVS', manufacturer: 'SNK', year: 1990,
    folders: ['neogeo'], core: 'arcade', extensions: ['zip', '7z'], coverAspect: 0.72,
    bios: { required: true, files: ['neogeo.zip'], keepArchives: true } },
  { key: 'wonderswan', name: 'WonderSwan', shortName: 'WS', manufacturer: 'Bandai', year: 1999,
    folders: ['wonderswan'], core: 'ws', extensions: ['ws', ...ARCHIVES], coverAspect: 0.9 },
  { key: 'wonderswancolor', name: 'WonderSwan Color', shortName: 'WSC', manufacturer: 'Bandai', year: 2000,
    folders: ['wonderswancolor'], core: 'ws', extensions: ['wsc', 'ws', ...ARCHIVES], coverAspect: 0.9 },
  { key: 'arcade', name: 'Arcade (FinalBurn Neo)', shortName: 'Arcade', manufacturer: 'Arcade', year: 1978,
    folders: ['arcade', 'fbneo', 'fba', 'cps1', 'cps2', 'cps3'], core: 'arcade', extensions: ['zip', '7z'], coverAspect: 0.75 },
  { key: 'mame', name: 'Arcade (MAME 2003-Plus)', shortName: 'MAME', manufacturer: 'Arcade', year: 1978,
    folders: ['mame', 'mame2003', 'mame2003plus', 'mame-libretro'], core: 'mame', extensions: ['zip'], coverAspect: 0.75 },

  /* ---------------- Computers & others ---------------- */
  { key: 'colecovision', name: 'ColecoVision', shortName: 'Coleco', manufacturer: 'Coleco', year: 1982,
    folders: ['colecovision', 'coleco'], core: 'coleco', extensions: ['col', 'cv', 'rom', 'bin', ...ARCHIVES], coverAspect: 0.72,
    bios: { required: true, files: ['colecovision.rom', 'coleco.rom'] } },
  { key: '3do', name: '3DO Interactive Multiplayer', shortName: '3DO', manufacturer: 'Panasonic', year: 1993,
    folders: ['3do'], core: '3do', extensions: ['iso', 'chd', 'cue', 'bin'], coverAspect: 1,
    bios: { required: true, files: ['panafz10.bin', 'panafz10-norsa.bin', 'panafz1.bin', 'goldstar.bin'] } },
  { key: 'amiga', name: 'Commodore Amiga', shortName: 'Amiga', manufacturer: 'Commodore', year: 1985,
    folders: ['amiga', 'amiga500', 'amiga1200', 'amiga600'], core: 'amiga',
    extensions: ['adf', 'adz', 'dms', 'fdi', 'ipf', 'hdf', 'hdz', 'lha', 'm3u', 'zip'], coverAspect: 0.75,
    bios: { required: false, files: ['kick34005.A500', 'kick40068.A1200', 'kick40063.A600'], note: 'amiga-aros' } },
  { key: 'c64', name: 'Commodore 64', shortName: 'C64', manufacturer: 'Commodore', year: 1982,
    folders: ['c64'], core: 'c64',
    extensions: ['d64', 'd71', 'd80', 'd81', 'd82', 'g64', 'x64', 't64', 'tap', 'prg', 'p00', 'crt', 'bin', 'm3u', ...ARCHIVES], coverAspect: 0.75 },
  { key: 'dos', name: 'MS-DOS', shortName: 'DOS', manufacturer: 'PC', year: 1981,
    folders: ['dos', 'pc'], core: 'dos', threads: true,
    extensions: ['zip', 'dosz', 'exe', 'com', 'bat', 'iso', 'cue', 'img', 'ima', 'vhd', 'm3u'], coverAspect: 0.75 },
  { key: 'xbox', name: 'Xbox', shortName: 'Xbox', manufacturer: 'Microsoft', year: 2001,
    folders: ['xbox'], extensions: ['iso', 'xiso'], coverAspect: 0.7,
    setup: { emulator: 'xemu', url: 'https://xemu.app/', guide: 'xemu' } },
  { key: 'xbox360', name: 'Xbox 360', shortName: 'X360', manufacturer: 'Microsoft', year: 2005,
    folders: ['xbox360'], extensions: ['iso', 'xex', 'zar'], coverAspect: 0.7,
    setup: { emulator: 'Xenia', url: 'https://xenia.jp/', guide: 'xenia' } },
];

const BY_FOLDER = new Map<string, SystemDef>();
for (const def of SYSTEMS) for (const folder of def.folders) BY_FOLDER.set(folder.toLowerCase(), def);

const MANUFACTURER_ORDER = ['Nintendo', 'Sony', 'Sega', 'Atari', 'NEC', 'SNK', 'Bandai', 'Arcade', 'Commodore', 'Coleco', 'Panasonic', 'PC', 'Microsoft'];

export function manufacturerRank(manufacturer: string): number {
  const index = MANUFACTURER_ORDER.indexOf(manufacturer);
  return index === -1 ? MANUFACTURER_ORDER.length : index;
}

/** Look up a folder; unknown folders become generic download-only systems. */
export function systemForFolder(folder: string): SystemDef {
  const known = BY_FOLDER.get(folder.toLowerCase());
  if (known) return known;
  return {
    key: folder.toLowerCase(),
    name: folder,
    shortName: folder.length <= 6 ? folder.toUpperCase() : folder.slice(0, 6).toUpperCase(),
    manufacturer: 'Other',
    year: 0,
    folders: [folder],
    coverAspect: 0.75,
    setup: {
      guide: 'unknown'
    },
  };
}
