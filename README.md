# Liquid Glass Wallpaper

A DSH Web GUI plugin that reads your **local Wallpaper Engine library** and renders the
wallpaper as a full-viewport **liquid-glass** backdrop behind the harness: frosted
diffusion, a specular sheen, a color vignette and a film-grain layer, all tunable live
from a settings card.

你的壁纸是你自己的本地文件，插件只在本机读取和播放，**不会上传、不会分发**。
Workshop 内容版权归原作者所有。

---

## What it does

- **Reads the real Wallpaper Engine library.** Discovers the WE install (Steam app
  `431960`) through the registry, every `libraryfolders.vdf` entry and the durable
  `appmanifest_431960.acf`, then enumerates Workshop content, `myprojects` and
  `defaultprojects`. Extra folders can be added manually.
- **Renders as a liquid-glass backdrop.** A fixed layer behind the shell with:
  - `backdrop-filter: blur() saturate()` frost,
  - a soft-light specular sheen,
  - a radial vignette for chrome legibility,
  - an inline-SVG film grain that kills blur banding,
  - optional pointer parallax (a few px, depth without looseness).
- **Live settings card** — 设置 → 液态玻璃壁纸: enable switch, four glass sliders
  (frost / saturation / tint / vignette), grain + parallax + fit toggles, a searchable
  type-filtered grid of every wallpaper, and a "current wallpaper" strip.
- **Remembered across reloads.** Selection and glass settings persist in `localStorage`
  and are restored on boot.
- **Range streaming.** Video is served with HTTP `206` so large 4K files seek and loop
  without buffering the whole thing.

## Supported wallpaper types

| Type | Rendering | Notes |
| --- | --- | --- |
| `video` | `<video>` loop, muted, autoplay | The best liquid-glass result, and the sharpest: 4K sources decode natively. A still preview is painted underneath so the backdrop is never black while decoding. |
| `image` | `<img>` | Direct render at the source resolution. |
| `web` | sandboxed same-origin `<iframe>` (`allow-scripts`) | Web wallpapers run their own JS **same-origin**. Only install ones you trust. |

### Why scene wallpapers are not offered

They were tried and removed. A scene's real content lives in a `scene.pkg`, and this
plugin cannot replay it — the only usable still is the project's own `preview.jpg`,
which in a real library is **1:1 and at most 1080×1080**. Filling a 16:9 window with
that means a median 1.56× and a worst-case **11×** upscale, so every scene looked soft
no matter how the glass settings were tuned.

The `.pkg` itself could not be read either. The index format was recovered
(`u32 pathLen | path | u32 offset | u32 length`, contiguous, no padding) and validates
against all 45 projects, but the payload bytes do not map to their declared filenames,
so a further layer of structure remains unknown. `resourcecompiler64.exe`,
`resourceutil64.dll` and `FreeImage64.dll` were all checked for a decoder and none
provided one.

Replaying scenes properly would need a WebGL player for layered 2D/3D scenes and WE
material semantics — a project of its own. Rather than ship a type that always looks
soft, the plugin skips scene projects entirely and says so here.

## Install

**Windows, one command.** Clone and run the installer — it finds your DSH home,
detects which profile your GUI is running on, installs from GitHub with that profile's
own pnpm, registers the bundle layer, and verifies the load tree:

```powershell
git clone https://github.com/XINGRUYU33224/dsh-liquid-glass-wallpaper.git
cd dsh-liquid-glass-wallpaper
pwsh -File install.ps1
```

Then restart your GUI (for the desktop app: **fully quit and reopen**, not a page
refresh). The section appears at **设置 → 液态玻璃壁纸**.

Useful flags:

| Flag | Effect |
| --- | --- |
| `-Profile <name>` | Target a specific profile instead of the detected one. |
| `-Local` | Install from this checkout (`link:`) instead of GitHub — for development. |
| `-Ref <branch\|tag\|sha>` | Install a specific git ref. |
| `-SkipVerify` | Skip the post-install load-tree check. |

The installer is idempotent: re-running it is how you update.

### Any platform, manual

`dsh plugin` forwards to pnpm, so a git spec works directly — and because the package
declares `dsh.bundle`, dsh **adds it to the profile's bundle list automatically**:

```sh
dsh plugin --profile <your-profile> add github:XINGRUYU33224/dsh-liquid-glass-wallpaper
```

> **Which profile is mine?** It is the last path argument of the running host process.
> The `desktop` profile is refused *by name* from the CLI
> (`managed exclusively by the Electron application`), even though it is an ordinary
> cordis profile. `install.ps1` handles this by driving the app's bundled pnpm directly;
> manually, that is:
>
> ```sh
> cd "$DSH_HOME/profiles/desktop"
> "<app>/resources/runtime/bin/node/node.exe" \
>   "<app>/resources/runtime/pnpm/bin/pnpm.mjs" \
>   add github:XINGRUYU33224/dsh-liquid-glass-wallpaper
> ```
>
> then add `"dsh-liquid-glass-wallpaper"` to `dsh.profile.bundles` in that profile's
> `package.json`. Write it **without a BOM** — a BOM makes the boot loader fail with
> `Unexpected token`.

### Requirements

- **Wallpaper Engine** installed via Steam (app `431960`). Without it the section still
  loads and explains that no library was found.
- **Node 20+** — only for the installer/tests. The plugin runs on DSH's own runtime and
  has **no runtime dependencies**.
- Windows for wallpaper discovery (Steam registry + `libraryfolders.vdf`). The backdrop
  engine itself is platform-neutral; manual library folders are the fallback elsewhere.

### Verify your install

```sh
npm run verify                   # 85 checks: host, client, bundle, Range, lifecycle
python scripts/verify-final.py <gui-url> shots/    # live end-to-end in a real browser
python scripts/verify-coverage.py <gui-url> shots/ # media covers the viewport
```

The browser suites need Playwright (`pip install playwright && playwright install
chromium`); the plugin itself needs nothing beyond Node's standard library.

## Configuration

The card writes to `localStorage["liquid-glass-wallpaper/v1"]`:

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch for the whole backdrop layer. |
| `activeId` | `null` | Selected wallpaper id (`workshop:<id>` / `local:<id>` / `manual:<path>`). |
| `blur` | `28` | Frost radius, 0–60 px. |
| `saturation` | `118` | Backdrop saturation, 60–220 %. |
| `tint` | `12` | Dark tint over the glass, 0–60 %. |
| `vignette` | `34` | Corner falloff, 0–80 %. |
| `grain` | `true` | Film-grain overlay. |
| `parallax` | `true` | Pointer-driven parallax. |
| `fit` | `cover` | `cover` or `contain`. |

Manual library folders can also be passed as plugin config (`manualDirs: string[]`).

## HTTP API

All routes are under `/api/liquid-glass/`, same-origin fenced
(cross-site `Sec-Fetch-Site`/`Origin` is rejected with 403; non-GET with 405).

| Route | Purpose |
| --- | --- |
| `GET /api/liquid-glass/inventory[?refresh=1]` | Library inventory with tokenized media URLs. |
| `GET /api/liquid-glass/media/<token>` | Range-streamed video/image. |
| `GET /api/liquid-glass/preview/<token>` | Preview still. |
| `GET /api/liquid-glass/web/<token>/` | Web wallpaper document. |

**Opaque tokens, never paths.** Media is addressed by random 144-bit tokens minted per
inventory response and resolved through an in-memory, capped map (4096 entries, oldest
evicted). Two properties matter:

- a token is **not** an encoding of the path. It is not reversible, so a same-origin
  script (which a *web wallpaper* is) cannot decode `/inventory` into the user's local
  directory layout;
- the map is **never written to disk**, so nothing outside the process learns the paths,
  and it cannot grow without bound across rescans.

A client-supplied path can never reach the filesystem in any case.

### Range support

`Accept-Ranges: bytes` with correct `206`/`416` behaviour, verified across 17 cases:
open-ended (`bytes=500-`), suffix (`bytes=-500` → the **last** 500 bytes, per RFC 9110),
clamped ends, `416` with `Content-Range: bytes */N` when unsatisfiable, and multi-range or
unknown-unit requests falling back to a full `200` rather than a misleading truncated
`206`. Video seeking depends on this.

## Layout

```
lib/
  index.js        host entry: inject ["webServer"], registers the route family
  we-library.js   Steam/WE discovery + project.json enumeration (dependency-free)
  routes.js       opaque-token, same-origin-fenced, Range-capable HTTP routes
  client.js       BUILT bundle (window.__ModuleLoader__.load) — do not edit by hand
src/
  client.js       client source (plain ESM); build-client.mjs wraps it
scripts/
  build-client.mjs  wraps src/client.js into the loader bundle (+ --check)
  verify.mjs        runs every suite
  test-build.mjs    build integrity + proof the guards reject bad input
  test-imports.mjs  every module loads and exposes its contract
  test-client.mjs   bundle contract + apply() wiring + backdrop DOM
  test-lifecycle.mjs  boot safety with no <body>
  test-host.mjs     inventory + streaming + token opacity + fence, real library
  test-range.mjs    Range edge cases (suffix, clamp, 416, multi-range)
  verify-*.py       live Chromium checks (card, backdrop, glass levels, leaks)
```

### Why the client is built

The DSH client loader discovers client plugins as **single self-registering bundles**:

```js
window.__ModuleLoader__.load({ id: 'dsh-liquid-glass-wallpaper', factory: (require) => { … } })
```

`src/client.js` stays readable ESM (`export const name/inject`, `export function apply`)
and `scripts/build-client.mjs` performs the envelope transform. Edit the source, then
run `node scripts/build-client.mjs`. Editing `lib/client.js` directly will be
overwritten.

## Why the layer re-dresses the shell

The shell paints **hardcoded** `rgb(255,255,255)` / `rgb(249,250,251)` on its own
containers. Those are **siblings** of this layer, not ancestors, so no `z-index` on the
backdrop can win: at `z-index: 0` it is covered, and at a negative `z-index` it falls
behind the document background.

So instead of fighting the paint order, the layer re-dresses the shell while it is
active, in two geometry-scoped passes:

| Surface | Test | Treatment |
| --- | --- | --- |
| Backdrop roots | covers **≥70%** of the viewport | `background-color: transparent` |
| Chrome panels (sidebar rail, transcript column) | full height (≥80% of viewport), 120 px–75% wide | frosted glass: translucent surface + `backdrop-filter` |

Neither pass can touch a card, button, input or dialog: those are neither backdrop-sized
nor panel-shaped. Every element's prior inline `background-color` is recorded, and the
glass panels carry a single class, so teardown (disabling the layer or `destroy()`)
restores the exact previous state. A `MutationObserver` re-applies after shell re-renders
(opening Settings, switching sessions), coalesced to one pass per animation frame.

This matters because a stock profile has **no skin** to make the shell transparent —
which is exactly the `desktop` case. The `web` profile only appeared to work because
`maid-atelier` was active and its skin CSS did this for us.

## Media sizing

The media element covers the viewport exactly and lets `object-fit` do all aspect-ratio
handling. An earlier version *also* applied `inset: -6%` + `width: 112%` + `scale(1.06)`:
three over-scales with different origins, which drifted the media off centre and left a
bare band — most visible with a 16:9 wallpaper in a wider window. Parallax is now a pure
translate over a single uniform `scale(1.06)`, so every edge stays covered.
`verify-coverage.py` asserts this across three window shapes for both video and image
wallpapers.

## Gotchas worth knowing

- **`inject` must list every service you touch.** Reading `ctx.locale` without
  declaring it throws `cannot get property "locale" without inject` and takes the whole
  plugin down at boot.
- **A `settings.section` needs the `inject` props provider.** Registering without it
  succeeds and returns a disposer, but the row never appears in the settings nav.
- **The card's CSS carries `!important`.** An active catalog skin ships L3 patches that
  restyle generic selectors; a plain inline `display:grid` loses. All structural rules
  are scoped to `[data-lgw-card]`.
- **The desktop profile is CLI-locked by name, not by structure.** `dsh plugin --profile
  desktop …` refuses (`managed exclusively by the Electron application`), but the profile
  is an ordinary cordis profile: install with the app's own pnpm —
  `node <runtime>/pnpm/bin/pnpm.mjs install` from `$DSH_HOME/profiles/desktop`.
- **The desktop profile has no theme tokens.** `--dsw-alias-*` resolve to nothing there,
  so the card falls back to its literal colors; that is expected, not a bug.
- **`cordis.patch.yml` entries can be missing plugins.** The stock desktop patch
  references `ui-settings-account`, which ships in `@linxin666/dsh-web-all`; without that
  package the entry logs `not found` and is skipped. Harmless, pre-existing.
- **Paths with spaces break `link:` installs.** pnpm splits the argument and installs a
  truncated path, so clone into a space-free directory.

## Security model

- `/api/liquid-glass/*` is fenced for a loopback CSRF threat model:
  - `Sec-Fetch-Site` must be `same-origin` or `none` when present (a cross-site page
    cannot suppress it);
  - an `Origin`, when present, must be a **loopback authority on the serving port**,
    checked against a server-side list. It is deliberately *not* compared to the
    request's own `Host` header — that is attacker-controlled, so `Origin: http://evil.test`
    with `Host: evil.test` (the DNS-rebinding case) is rejected with 403;
  - requests with neither header are non-browser clients (curl, native apps). They are
    outside the browser threat model this fence addresses and cannot be driven by a
    malicious web page.
- No client-supplied path ever reaches the filesystem (opaque token indirection).
- Tokens are random and in-memory only — see "Opaque tokens" above.
- Media files are opened read-only and streamed; nothing is written outside the plugin's
  own cache.
- Web wallpapers are sandboxed iframes (`allow-scripts`) but **run scripts same-origin** —
  treat a web wallpaper as code you are choosing to run.
- Nothing is uploaded. There is no telemetry and no network egress.

## Test coverage

`node scripts/verify.mjs` runs 85 checks across 7 suites:

| Suite | Checks | Covers |
| --- | --- | --- |
| build client bundle | — | generates `lib/client.js` |
| build integrity + guards | 18 | UTF-8 fidelity, CJK labels survive, `--check` staleness, guards reject no-exports / stray-export / duplicate-export |
| import contract | 4 | every module loads and exposes its API |
| client bundle contract | 20 | `__ModuleLoader__` shape, `apply()` wiring, backdrop DOM, stylesheet injection |
| boot lifecycle safety | 4 | `apply()` survives a document with no `<body>` |
| host routes + library | 26 | real 119-wallpaper library, Range streaming, opaque non-reversible tokens, cross-site/rebound rejection |
| HTTP range edge cases | 17 | suffix, open-ended, clamp, 416, multi-range |

Live browser suites (`verify-card.py`, `verify-final.py`, `verify-coverage.py`,
`verify-visible.py`, `test-leaks.py`) additionally drive the real GUI: card render,
wallpaper selection, persisted restore, frost blur at 0→60 px, media coverage across
three window shapes, occlusion, and a 24-switch leak check.

## Contributing

The client half is **built**: edit `src/client.js`, then run `npm run build`. Do not edit
`lib/client.js` by hand — it is generated and `npm run check` fails when it is stale.
Before opening a PR, run `npm run verify`; all suites must pass.

Two traps worth knowing, both of which cost real debugging time here:

- The CSS and HTML strings in `src/client.js` are **backtick template literals**. A
  backtick inside a comment or a CSS value silently ends the literal and produces a
  syntax error far from the cause. The build script detects this and points at it.
- `inject` must list every client service you touch (`slots`, `locale`, …). Reading one
  that is not declared throws at boot and takes the whole plugin down.

## Privacy

No telemetry, no network egress, no analytics. The plugin reads your local Wallpaper
Engine library and serves it to your own GUI over loopback. Nothing leaves the machine.

## License

[MIT](LICENSE) — see [NOTICE](NOTICE) for the wallpaper-content boundary.

Wallpaper files are **not** part of this project and are never redistributed. Workshop
content belongs to its authors; this plugin only reads what is already on your disk.
