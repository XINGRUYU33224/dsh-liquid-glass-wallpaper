/**
 * Wallpaper Engine library discovery.
 *
 * Locates the WE install (Steam app 431960) and enumerates its Workshop
 * content, myprojects and defaultprojects directories. Every returned entry is
 * plain data; the HTTP layer turns `fileAbs` / `previewAbs` into opaque tokens
 * so a client-supplied path can never reach the filesystem.
 *
 * Discovery order, most authoritative first:
 *   1. explicit user-configured folders (settings),
 *   2. the Workshop content dir of every Steam library that owns app 431960
 *      (libraryfolders.vdf + the durable appmanifest_431960.acf),
 *   3. projects/ inside the located WE install.
 *
 * @module dsh-liquid-glass-wallpaper/we-library
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Steam appid of Wallpaper Engine. */
export const WE_APPID = '431960'

/** Common Steam install locations probed when the registry/vdf miss. */
const STEAM_PROBE_DIRS = [
  'C:\\Program Files (x86)\\Steam',
  'C:\\Program Files\\Steam',
  'D:\\Steam',
  'D:\\SteamLibrary',
  'E:\\Steam',
  'E:\\SteamLibrary',
  'F:\\Steam',
  'F:\\SteamLibrary',
]

/** Expand a leading `~` (manual folders are typed by humans). */
export function expandUser(path) {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/** Windows registry Steam root, or null. Process-memoized by the caller. */
export function steamPathFromRegistry(run) {
  if (process.platform !== 'win32') return null
  const runner =
    run ??
    (() =>
      execFileSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe'), [
        'query',
        'HKCU\\Software\\Valve\\Steam',
        '/v',
        'SteamPath',
      ], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }))
  try {
    const match = /SteamPath\s+REG_SZ\s+(.+)/i.exec(runner())
    return match ? match[1].trim() : null
  } catch {
    return null
  }
}

let registryCache
/** One registry probe per process — it is a synchronous child process. */
export function defaultRegistryProbe() {
  if (registryCache === undefined) registryCache = steamPathFromRegistry()
  return registryCache
}

/** Every library root listed in libraryfolders.vdf (its apps block may be stale). */
export function allLibrariesFromVdf(vdfText) {
  const out = []
  for (const line of vdfText.split(/\r?\n/)) {
    const match = /^\s*"path"\s+"([^"]+)"\s*$/.exec(line)
    if (match === null) continue
    const root = match[1].replace(/\\\\/g, '\\')
    if (!out.includes(root)) out.push(root)
  }
  return out
}

/** Durable ownership fact used when the vdf apps block has not refreshed. */
export function libraryOwnsApp(library, appid, exists = existsSync) {
  return exists(join(library, 'steamapps', `appmanifest_${appid}.acf`))
}

/** Locate the WE install directory (the one holding wallpaper32.exe). */
export function locateWallpaperEngine(opts = {}) {
  const exists = opts.exists ?? existsSync
  if (process.platform !== 'win32' && !opts.force) return null
  const registry = opts.registry ?? defaultRegistryProbe
  const probes = [...new Set([registry(), ...STEAM_PROBE_DIRS].filter(Boolean))]
  const libraries = []
  for (const probe of probes) {
    const vdf = join(probe, 'steamapps', 'libraryfolders.vdf')
    if (!exists(vdf)) continue
    try {
      libraries.push(...allLibrariesFromVdf(readFileSync(vdf, 'utf8')))
    } catch {
      /* unreadable vdf is not fatal */
    }
  }
  const candidates = []
  for (const root of [...probes, ...libraries]) {
    candidates.push(join(root, 'steamapps', 'common', 'wallpaper_engine'))
  }
  candidates.push('C:\\Program Files (x86)\\Wallpaper Engine')
  for (const dir of candidates) if (exists(join(dir, 'wallpaper32.exe'))) return dir
  return null
}

/** Steam library roots that own app 431960 (for the Workshop content dir). */
export function owningLibraries(opts = {}) {
  const exists = opts.exists ?? existsSync
  if (process.platform !== 'win32' && !opts.force) return []
  const registry = opts.registry ?? defaultRegistryProbe
  const probes = [...new Set([registry(), ...STEAM_PROBE_DIRS].filter(Boolean))]
  const libraries = new Set()
  for (const probe of probes) {
    const vdf = join(probe, 'steamapps', 'libraryfolders.vdf')
    if (!exists(vdf)) continue
    let text
    try {
      text = readFileSync(vdf, 'utf8')
    } catch {
      continue
    }
    for (const root of allLibrariesFromVdf(text)) {
      if (libraryOwnsApp(root, opts.appid ?? WE_APPID, exists)) libraries.add(root)
    }
  }
  return [...libraries]
}

/** Infer the wallpaper type from the main file extension. */
export function inferType(file) {
  if (/\.(mp4|webm|mkv|avi|mov|m4v)$/i.test(file)) return 'video'
  if (/\.(html?|js)$/i.test(file)) return 'web'
  if (/\.(jpe?g|png|webp|gif|bmp)$/i.test(file)) return 'image'
  return 'scene'
}

/** Read a WE project.json (tolerates BOM and a UTF-8/UTF-16 mix). */
function readProjectJson(file) {
  try {
    const raw = readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/** Pick the preview image for a project directory. */
function findPreview(dir, project, exists = existsSync) {
  const declared = typeof project?.preview === 'string' ? project.preview : null
  if (declared) {
    const abs = join(dir, declared)
    if (exists(abs)) return abs
  }
  for (const name of ['preview.jpg', 'preview.png', 'preview.jpeg', 'preview.webp', 'preview.gif']) {
    const abs = join(dir, name)
    if (exists(abs)) return abs
  }
  return null
}

/** A human title: project.json title, else the folder name. */
function titleFor(project, fallback) {
  const title = typeof project?.title === 'string' ? project.title.trim() : ''
  return title !== '' ? title : fallback
}

/**
 * Enumerate one WE project directory (the folder holding project.json).
 * Returns null when it holds no usable main file.
 */
export function readProject(dir, opts = {}) {
  const exists = opts.exists ?? existsSync
  const projectFile = join(dir, 'project.json')
  const project = exists(projectFile) ? readProjectJson(projectFile) : null
  const main = typeof project?.file === 'string' && project.file.trim() !== '' ? project.file.trim() : null
  let fileAbs = main ? join(dir, main) : null
  let type = main ? inferType(main) : 'scene'

  // A scene project may declare scene.pkg instead of a loose file.
  if (!fileAbs || !exists(fileAbs)) {
    const pkg = join(dir, 'scene.pkg')
    if (exists(pkg)) {
      fileAbs = pkg
      type = 'scene'
    } else {
      const fallback = findLooseMedia(dir, exists, opts.stat ?? statSync)
      if (fallback) {
        fileAbs = fallback
        type = inferType(fallback)
      } else {
        return null
      }
    }
  }

  const previewAbs = findPreview(dir, project, exists)
  let size = 0
  let mtimeMs = 0
  try {
    const st = (opts.stat ?? statSync)(fileAbs)
    // Must be a real file: a *directory* whose name merely looks like media
    // would otherwise be listed as playable and then 404 in the backdrop.
    if (typeof st.isFile === 'function' && !st.isFile()) return null
    size = st.size
    mtimeMs = st.mtimeMs
  } catch {
    return null
  }

  return {
    id: opts.id ?? dir,
    dir,
    title: titleFor(project, opts.fallbackTitle ?? dir.split(/[\\/]/).pop() ?? 'Wallpaper'),
    type,
    fileAbs,
    previewAbs,
    size,
    mtimeMs,
    source: opts.source ?? 'workshop',
    tags: Array.isArray(project?.tags) ? project.tags.filter((t) => typeof t === 'string') : [],
  }
}

/** First playable loose media *file* in a directory (used when project.json is absent). */
function findLooseMedia(dir, exists, stat = statSync) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  const rank = (n) =>
    /\.(mp4|webm|m4v)$/i.test(n) ? 0 : /\.(html?)$/i.test(n) ? 1 : /\.(jpe?g|png|webp)$/i.test(n) ? 2 : 3
  const candidates = entries
    // Directories are never media, even when their name ends in ".mp4".
    .filter((e) => e.isFile() && rank(e.name) < 3)
    .sort((a, b) => rank(a.name) - rank(b.name))
  for (const entry of candidates) {
    const abs = join(dir, entry.name)
    if (!exists(abs)) continue
    try {
      if (!stat(abs).isFile()) continue
    } catch {
      continue
    }
    return abs
  }
  return null
}

/** Scan one root whose immediate children may be project directories. */
function scanProjectsRoot(root, source, exists, out, seen) {
  if (!exists(root)) return
  let children
  try {
    children = readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const child of children) {
    if (!child.isDirectory()) continue
    const dir = join(root, child.name)
    if (seen.has(dir)) continue
    seen.add(dir)
    const entry = readProject(dir, {
      exists,
      // Keyed on the source *and* the resolved directory: two roots can hold a
      // folder with the same name (two Steam libraries, a manual folder), and
      // ids are used as React keys and as the persisted selection.
      id: `${source}:${dir}`,
      source,
      fallbackTitle: child.name,
    })
    if (entry) out.push(entry)
  }
}

/** Candidate Workshop content roots across every owning Steam library. */
export function workshopRoots(opts = {}) {
  const exists = opts.exists ?? existsSync
  const roots = []
  for (const library of owningLibraries(opts)) {
    roots.push(join(library, 'steamapps', 'workshop', 'content', WE_APPID))
  }
  return roots.filter((r) => exists(r))
}

/**
 * Build the whole wallpaper inventory.
 *
 * @param opts.roots      extra project-collection folders (user settings)
 * @param opts.autoDetect skip automatic Steam discovery when false
 * @returns {{installDir: string|null, roots: string[], wallpapers: object[]}}
 */
export function buildInventory(opts = {}) {
  const exists = opts.exists ?? existsSync
  const installDir = opts.installDir !== undefined
    ? opts.installDir
    : opts.autoDetect === false
      ? null
      : locateWallpaperEngine({ exists })

  const roots = []
  if (opts.autoDetect !== false) {
    roots.push(...workshopRoots({ exists }))
    if (installDir) {
      roots.push(join(installDir, 'projects', 'myprojects'))
      roots.push(join(installDir, 'projects', 'defaultprojects'))
    }
  }

  const out = []
  const seen = new Set()

  for (const root of roots) {
    const source = root.includes('workshop') ? 'workshop' : 'local'
    scanProjectsRoot(root, source, exists, out, seen)
  }

  // A user folder may be: one project, a collection of projects, a WE install
  // root, or a Steam library root. Handle each shape.
  for (const raw of opts.manualDirs ?? []) {
    if (typeof raw !== 'string' || raw.trim() === '') continue
    const dir = expandUser(raw.trim())
    if (!exists(dir)) continue
    if (exists(join(dir, 'project.json'))) {
      const entry = readProject(dir, { exists, id: `manual:${dir}`, source: 'manual' })
      if (entry && !seen.has(dir)) {
        seen.add(dir)
        out.push(entry)
      }
      continue
    }
    const nested = []
    scanProjectsRoot(dir, 'manual', exists, nested, seen)
    if (nested.length === 0) {
      // Not a projects collection — try the well-known sub-roots.
      for (const sub of [
        join(dir, 'steamapps', 'workshop', 'content', WE_APPID),
        join(dir, 'projects', 'myprojects'),
        join(dir, 'projects', 'defaultprojects'),
        join(dir, 'projects'),
      ]) {
        scanProjectsRoot(sub, 'manual', exists, out, seen)
      }
    } else {
      out.push(...nested)
    }
  }

  out.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'))
  return { installDir, roots, wallpapers: out }
}
