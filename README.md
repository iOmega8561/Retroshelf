# Retroshelf

A self-hosted library for your retro games. Browse an ES-DE collection by system, search and filter it, and play compatible systems in the browser with [EmulatorJS](https://emulatorjs.org). Systems a browser can't run get a download button and setup steps for a desktop emulator instead.

One rootless container, no database, no third-party APIs. The catalog comes from your folders and `gamelist.xml` files; favorites, play history and saves live in each player's browser.

## Contents

- [Quick start](#quick-start)
- [Library layout](#library-layout)
- [Systems](#systems)
- [HTTPS, controllers and PSP](#https-controllers-and-psp)
- [Languages](#languages)
- [Running with Quadlet](#running-with-quadlet)
- [Configuration](#configuration)
- [Saves and client data](#saves-and-client-data)
- [Security model](#security-model)
- [Development](#development)
- [Known limits](#known-limits)

## Quick start

```sh
podman build -t localhost/retroshelf:latest .

podman run -d --name retroshelf \
  -p 127.0.0.1:8080:8080 \
  -v ~/games/library:/library:ro,z \
  --userns keep-id:uid=1000,gid=1000 \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  localhost/retroshelf:latest
```

Open <http://localhost:8080>. Over plain HTTP from another device on your LAN, games still run, but browsers disable controllers and the PSP and DOS cores. Put Retroshelf behind HTTPS for those (see below).

## Library layout

Mount one folder at `/library`, read-only:

```
/library
├── bios/
│   ├── psx/            scph5501.bin, …
│   └── segacd/         bios_CD_U.bin, …
└── roms/
    ├── gba/
    │   ├── gamelist.xml
    │   ├── Advance Wars (USA).gba
    │   └── covers/Advance Wars (USA).png
    ├── psx/
    │   ├── Final Fantasy VII.m3u
    │   ├── Final Fantasy VII (Disc 1).cue
    │   └── Final Fantasy VII (Disc 1).bin
    └── …
```

**Systems** are the folder names under `roms/`, using ES-DE's names (`gba`, `megadrive`, `psx`, …). Unknown folders still appear, as download-only.

**Metadata** comes from each folder's `gamelist.xml`: name, description, developer, publisher, genre, release date, players, rating and the `hidden` flag. Files that aren't in the gamelist are listed too, named after the file.

**Artwork** is matched by file name in `covers/`, `screenshots/`, `titlescreens/`, `marquees/`, `fanart/`, `videos/` and `miximages/` (also under `media/` or `downloaded_media/`), so `covers/Advance Wars (USA).png` belongs to `Advance Wars (USA).gba`. Image paths written in the gamelist (`<image>`, `<thumbnail>`, `<marquee>`, …) are used when no matching file exists. Covers are taken from `covers/` first, then `<thumbnail>`, `<image>` and mix images.

**Disc sets** need no conversion: `.cue` sheets, `.m3u` playlists, `.gdi` and `.ccd` images are grouped with the files they reference, which disappear from the list. Retroshelf streams the whole set to the emulator as one uncompressed ZIP built on the fly, never buffered in memory. CHD or PBP files remain the fastest option for large disc games.

**BIOS files** go in `bios/<folder>/`, where `<folder>` is the system's ROM folder name or any of its aliases. Files placed flat in `bios/` (ES-DE style) are picked up when their names match the expected BIOS. A single file is handed to the emulator as-is; several are zipped together on the fly and EmulatorJS extracts them.

After adding files, choose **Rescan library** in the sidebar.

## Systems

Playable in the browser (EmulatorJS 4.2.3 cores, loaded from `cdn.emulatorjs.org/stable`):

| System | Folders | Core | BIOS |
|---|---|---|---|
| Nintendo Entertainment System | `nes`, `famicom` | `nes` | none |
| Famicom Disk System | `fds` | `nes` | required: `disksys.rom` |
| Super Nintendo | `snes`, `sfc`, `snesna`, `superfamicom` | `snes` | none |
| Virtual Boy | `virtualboy`, `vb` | `vb` | none |
| Nintendo 64 | `n64` | `n64` | none |
| Game Boy | `gb` | `gb` | none |
| Game Boy Color | `gbc` | `gb` | none |
| Game Boy Advance | `gba` | `gba` | optional: `gba_bios.bin` |
| Nintendo DS | `nds` | `nds` | optional: `bios7.bin`, `bios9.bin`, `firmware.bin` |
| PlayStation | `psx`, `ps1`, `playstation` | `psx` | optional: `scph5501.bin`, `scph5500.bin`, `scph5502.bin`, `scph1001.bin`, `scph7001.bin`, `scph101.bin` |
| PlayStation Portable | `psp` | `psp` (HTTPS) | none |
| Master System | `mastersystem`, `sms`, `markiii` | `segaMS` | none |
| Mega Drive / Genesis | `megadrive`, `genesis`, `md`, `megadrivejp` | `segaMD` | none |
| Game Gear | `gamegear`, `gg` | `segaGG` | none |
| Sega CD / Mega-CD | `segacd`, `megacd`, `megacdjp` | `segaCD` | required: `bios_CD_U.bin`, `bios_CD_E.bin`, `bios_CD_J.bin` |
| Sega 32X | `sega32x`, `32x` | `sega32x` | none |
| Sega Saturn | `saturn`, `saturnjp` | `segaSaturn` | optional: `saturn_bios.bin` |
| Atari 2600 | `atari2600` | `atari2600` | none |
| Atari 5200 | `atari5200` | `atari5200` | required: `5200.rom` |
| Atari 7800 | `atari7800` | `atari7800` | optional: `7800 BIOS (U).rom`, `7800 BIOS (E).rom` |
| Atari Lynx | `atarilynx`, `lynx` | `lynx` | required: `lynxboot.img` |
| Atari Jaguar | `atarijaguar`, `jaguar` | `jaguar` | none |
| PC Engine / TurboGrafx-16 | `pcengine`, `tg16`, `turbografx16`, `pce` | `pce` | none |
| PC Engine CD | `pcenginecd`, `tg-cd`, `turbografxcd` | `pce` | required: `syscard3.pce` |
| PC-FX | `pcfx` | `pcfx` | required: `pcfx.rom` |
| Neo Geo Pocket | `ngp` | `ngp` | none |
| Neo Geo Pocket Color | `ngpc` | `ngp` | none |
| Neo Geo | `neogeo` | `arcade` | required: `neogeo.zip` |
| WonderSwan | `wonderswan` | `ws` | none |
| WonderSwan Color | `wonderswancolor` | `ws` | none |
| Arcade (FinalBurn Neo) | `arcade`, `fbneo`, `fba`, `cps1`, `cps2`, `cps3` | `arcade` | none |
| Arcade (MAME 2003-Plus) | `mame`, `mame2003`, `mame2003plus`, `mame-libretro` | `mame` | none |
| ColecoVision | `colecovision`, `coleco` | `coleco` | required: `colecovision.rom`, `coleco.rom` |
| 3DO Interactive Multiplayer | `3do` | `3do` | required: `panafz10.bin`, `panafz10-norsa.bin`, `panafz1.bin`, `goldstar.bin` |
| Commodore Amiga | `amiga`, `amiga500`, `amiga1200`, `amiga600` | `amiga` | optional: `kick34005.A500`, `kick40068.A1200`, `kick40063.A600` |
| Commodore 64 | `c64` | `c64` | none |
| MS-DOS | `dos`, `pc` | `dos` (HTTPS) | none |

"(HTTPS)" marks cores that need cross-origin isolation, explained in the next section. Download-only systems, where the game page offers the ROM, BIOS and setup steps:

| System | Folders | Recommended emulator |
|---|---|---|
| Nintendo 3DS | `n3ds`, `3ds` | [Azahar](https://azahar-emu.org/) |
| GameCube | `gc`, `gamecube` | [Dolphin](https://dolphin-emu.org/) |
| Wii | `wii` | [Dolphin](https://dolphin-emu.org/) |
| Wii U | `wiiu` | [Cemu](https://cemu.info/) |
| Nintendo Switch | `switch` | any Switch emulator (keys and firmware from your own console) |
| PlayStation 2 | `ps2` | [PCSX2](https://pcsx2.net/) |
| PlayStation 3 | `ps3` | [RPCS3](https://rpcs3.net/) |
| PlayStation Vita | `psvita` | [Vita3K](https://vita3k.org/) |
| Dreamcast | `dreamcast`, `dc` | [Flycast](https://github.com/flyinghead/flycast) |
| Xbox | `xbox` | [xemu](https://xemu.app/) |
| Xbox 360 | `xbox360` | [Xenia](https://xenia.jp/) |


**Nintendo 3DS is download-only.** EmulatorJS has no 3DS core, so 3DS games come with a download button and setup steps for Azahar.

## HTTPS, controllers and PSP

**Controllers need HTTPS.** Chromium and Firefox only expose the Gamepad API on secure pages: HTTPS, or `http://localhost` on the machine itself. On plain HTTP the browser never reports a controller, so neither Retroshelf nor EmulatorJS can see it. The player shows a notice when it runs on an insecure page.

Gamepads that follow the standard mapping (Xbox, PlayStation, Switch Pro and most generic USB/Bluetooth pads) work out of the box. Browsers only report a controller after its first button press. EmulatorJS 4.2.x has a bug where a controller that is already active when the game page opens, or that is pressed while the game downloads, is never assigned to a player. Retroshelf works around it by assigning such controllers to the first free player as soon as the emulator is ready.

**PSP and DOS need cross-origin isolation.** The PPSSPP and DOSBox Pure cores are only built with threads, which need `SharedArrayBuffer`. Browsers expose it only on cross-origin isolated pages, and only in a secure context.

Retroshelf already sends the headers on every response:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

The EmulatorJS CDN answers with `Cross-Origin-Resource-Policy: cross-origin` and `Access-Control-Allow-Origin: *`, so the strict `require-corp` mode works with it.

What you need to provide is the secure context: HTTPS through your reverse proxy, or `http://localhost` on the machine itself. Retroshelf does not terminate TLS. Ready-made configurations are in `deploy/`:

- `deploy/Caddyfile`: automatic HTTPS, nothing else to configure.
- `deploy/nginx.conf`: streams ROMs without spooling them to disk. Don't add a second set of `Cross-Origin-*` headers; duplicates make browsers drop isolation.
- `deploy/traefik-labels.txt`: router labels for the Docker/Podman provider.

When isolation is missing, PSP and DOS games show a clear notice instead of a broken canvas. Every other system keeps working.

## Languages

The interface is available in English and Italian, including the player, the setup guides for desktop emulators, messages and notices.

- **Automatic choice.** Retroshelf picks the first supported language in the browser's preference list (`navigator.languages`, which follows the system language by default), and falls back to English.
- **Manual override.** Each device can choose a language in the sidebar; the choice is kept in that browser.
- **Locale-aware formatting.** Numbers, file sizes, dates and relative times follow the active language.
- **EmulatorJS menus** follow the same language (`EJS_language`). Some EmulatorJS menu entries aren't in its Italian file yet and stay in English.
- **Installed app.** The PWA manifest description follows the browser's `Accept-Language`.

The server never sends interface text. The API returns codes, such as a guide id, a BIOS note id or an unplayable reason, and the client translates them.

To add a language:

1. Copy `web/src/i18n/en.ts` to a new file and translate it. The `Messages` type makes the build fail if any key is missing or has the wrong shape.
2. Register the language in `web/src/i18n/index.ts` (`Locale`, `LOCALES`, `LOCALE_NAMES`, `EJS_LANGUAGE`, `isLocale`) and in the inline script in `web/index.html`.
3. Add its manifest description and language code in `server/src/http/routes/manifest.ts`.

## Running with Quadlet

`deploy/retroshelf.container` is a rootless systemd unit with a read-only root filesystem, all capabilities dropped, `no-new-privileges`, a health check and a memory cap.

```sh
podman build -t localhost/retroshelf:latest .
mkdir -p ~/.config/containers/systemd
cp deploy/retroshelf.container ~/.config/containers/systemd/
# edit the Volume= line to point at your library
systemctl --user daemon-reload
systemctl --user start retroshelf
loginctl enable-linger "$USER"
```

`UserNS=keep-id:uid=1000,gid=1000` maps your host user onto the container's UID 1000, so files you own are readable without changing permissions. On SELinux hosts the volume uses `:z`; if your library is shared with other services, use `SecurityLabelDisable=true` instead of relabelling it.

## Configuration

All settings are environment variables. Invalid values stop the server at startup with a message naming the variable.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Listening port. |
| `HOST` | `0.0.0.0` | Listening address. |
| `APP_NAME` | `Retroshelf` | Name in the installed app (PWA manifest). |
| `LIBRARY_DIR` | `/library` | Library root. |
| `ROMS_DIR` | `$LIBRARY_DIR/roms` | Override the ROM root. |
| `BIOS_DIR` | `$LIBRARY_DIR/bios` | Override the BIOS root. |
| `EJS_DATA_PATH` | `https://cdn.emulatorjs.org/stable/data/` | EmulatorJS data folder. Point it at a self-hosted copy (a URL, or a path like `/emulatorjs/data/`) to pin a version. The player page's CSP follows this origin. |
| `EJS_CACHE_LIMIT_MB` | `1024` | Largest ROM EmulatorJS caches in the browser. |
| `COEP` | `require-corp` | `require-corp`, `credentialless` or `off`. `off` disables PSP and DOS. |
| `RESCAN_INTERVAL_MINUTES` | `0` | Rescan periodically; `0` disables it. |
| `SCAN_COOLDOWN_SECONDS` | `10` | Minimum gap between rescans triggered from the UI. |
| `SCAN_TOKEN` | unset | When set, `POST /api/scan` requires `Authorization: Bearer <token>`; the UI rescan button then reports that rescanning is restricted. |
| `MAX_SCAN_DEPTH` | `4` | Folder depth scanned inside each system. |
| `MAX_GAMELIST_MB` | `64` | Larger gamelists are skipped with a warning. |
| `SHOW_HIDDEN` | `false` | Show games marked `<hidden>true</hidden>`. |
| `FOLLOW_SYMLINKS` | `false` | Follow symlinks, including ones pointing outside the library. |
| `TRUST_PROXY` | `loopback` | Express `trust proxy` setting. |
| `LOG_LEVEL` | `info` | `debug` logs every request, including byte ranges. |

## Saves and client data

The server stores nothing. Everything personal stays in the player's browser:

- **Save states** use nine slots per game in IndexedDB, with a screenshot. EmulatorJS' own Save and Load buttons and hotkeys write to the slot picked in its settings; the **Saves** panel in the player lists every slot. States can be exported and imported as files.
- **Battery saves (SRAM)** are persisted by EmulatorJS itself, every 60 seconds and when you leave the game. Retroshelf keeps a second copy, restores it automatically if the emulator's copy is gone, and lets you export or import it.
- **ROMs and cores** are cached by EmulatorJS in IndexedDB, so a replay doesn't download them again.
- **Favorites, recently played, theme, sort and grid density** are kept in localStorage.

Retroshelf asks the browser for persistent storage the first time you save, so the browser is less likely to evict saves under storage pressure. Export anything you can't afford to lose.

## Security model

- **Whitelisted files.** Only files the scanner indexed can be served: ROM files that belong to a game, media referenced by a game, and files under `bios/`. A URL can't name any other file.
- **Path checks.** Every URL segment is validated (no `..`, no dotfiles, no separators, no control characters), and the resolved path must stay inside its root. Without `FOLLOW_SYMLINKS`, the real path must too.
- **Untrusted references.** Paths found inside gamelists, cue sheets and playlists get the same checks, so a crafted `.cue` can't pull in files from elsewhere. User-supplied SVG is never served.
- **Content Security Policy.** The library page allows same-origin content only. The player page also allows the EmulatorJS origin, `blob:` scripts and WebAssembly, which the emulator needs.
- **Response headers.** Responses also carry `nosniff`, `X-Frame-Options`, `Referrer-Policy` and a Permissions-Policy that allows gamepads and fullscreen for this site only.
- **Rescans.** Rescans are single-flight and rate-limited, refuse cross-site requests, and can require a token.
- **Container.** The container runs as UID/GID 1000 with a read-only root filesystem. The library mount can be (and should be) read-only too.

## Development

Requirements: Node.js 22.2 or later.

```sh
# Terminal 1: API on :8080 against a local library
cd server && npm install
LIBRARY_DIR=/path/to/library npm run dev

# Terminal 2: UI with hot reload on :5173, proxying /api, /files and /media
cd web && npm install && npm run dev
```

`http://localhost:5173` is cross-origin isolated too, so PSP works in development.

Tests cover path traversal attempts over raw HTTP, byte-range semantics (206, 416, `If-Range`, conditional requests), gamelist parsing, disc-set grouping and ZIP validity:

```sh
cd server && npm test
```

Project structure:

```
shared/api.d.ts      API contract shared by server and web (types only)
server/src/
  library/           scanner, gamelist parser, disc sets, BIOS, system registry, catalog
  http/              app, security headers & CSP, range sender, routes
  util/              path safety, virtual ZIP, MIME types
web/src/
  components/, hooks/, lib/   library UI (React)
  i18n/              translator, English and Italian dictionaries
  play/              player page (framework-free TypeScript + EmulatorJS)
  sw/sw.ts           service worker
deploy/              Quadlet unit, Caddy / Nginx / Traefik examples
```

## Known limits

- EmulatorJS downloads a whole ROM before starting. Byte ranges are fully supported for downloads and resumable transfers, but the emulator itself doesn't use them.
- Requests with several byte ranges at once get the full file (allowed by RFC 9110); single ranges get 206.
- On-the-fly archives use classic ZIP, so a disc set over 4 GB can't be streamed. Convert such sets to CHD or PBP.
- Controllers need HTTPS (or localhost) and appear after their first button press. In the library, the D-pad moves between games, A opens, B goes back, LB/RB switch systems and Start plays.
- Some browsers keep game audio muted until the first key press or tap on the player page.
- Folders that ES-DE treats as a single game (for example a `Game.ps3` folder) aren't supported; only files are listed as games.
