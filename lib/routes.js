/**
 * HTTP route family for the liquid-glass wallpaper plugin.
 *
 * All routes live under `/api/liquid-glass/` and are same-origin fenced.
 * Media is addressed by opaque tokens issued from the inventory response, so a
 * client-supplied path can never reach the filesystem. Video is Range-streamed
 * (206) because the backdrop <video> seeks and loops.
 *
 * @module dsh-liquid-glass-wallpaper/routes
 */
import { randomBytes } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname } from 'node:path'

/** All routes are namespaced under this prefix. */
export const API_PREFIX = '/api/liquid-glass'

const MIME = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.m4v': 'video/x-m4v',
  '.mkv': 'video/x-matroska',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
}

function mimeFor(path) {
  return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

function writeJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  })
  res.end(payload)
}

/**
 * Same-origin fence.
 *
 * This is a CSRF boundary for a loopback service, so the decision is made from
 * signals a browser sets and a page cannot forge:
 *
 *   - `Sec-Fetch-Site` must be `same-origin` or `none` when present (browsers
 *     always send it; a cross-site page cannot suppress it);
 *   - an `Origin`, when present, must match the identity the server was actually
 *     addressed as — never the request's own `Host`, which is attacker-supplied
 *     (that would pass trivially with `Origin: http://evil.test` + `Host:
 *     evil.test`, e.g. under DNS rebinding).
 *
 * Requests carrying neither header are non-browser clients (curl, native apps)
 * and are allowed through: they are outside the browser threat model this fence
 * exists for, and they cannot be driven by a malicious web page.
 *
 * @param allowed - the authorities this server is reachable as.
 */
function sameOrigin(req, allowed) {
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return false

  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== '') {
    if (allowed.size === 0) return false
    let host
    try {
      host = new URL(origin).host
    } catch {
      return false
    }
    return allowed.has(host)
  }
  return true
}

/** Stream a file with Range support so <video> can seek and loop. */
function serveFile(absPath, req, res) {
  let stat
  try {
    stat = statSync(absPath)
  } catch {
    writeJson(res, 404, { ok: false, error: 'not-found' })
    return
  }
  if (!stat.isFile()) {
    writeJson(res, 404, { ok: false, error: 'not-found' })
    return
  }
  const size = stat.size
  res.setHeader('Content-Type', mimeFor(absPath))
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Cache-Control', 'private, max-age=3600')

  const range = req.headers.range
  if (typeof range === 'string' && range !== '') {
    // Anchored: a multi-range request (`bytes=0-99, 200-299`) or any other
    // variant must not be silently truncated to its first range, which would
    // look like a valid 206 while dropping data.
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    if (match === null || (match[1] === '' && match[2] === '')) {
      // Unsupported range form: ignore the header and send the whole body,
      // which RFC 9110 permits and which every client can handle.
      res.setHeader('Content-Length', String(size))
      createReadStream(absPath).pipe(res)
      return
    }

    let start
    let end
    if (match[1] === '') {
      // Suffix range `bytes=-N`: the LAST N bytes.
      const suffix = parseInt(match[2], 10)
      if (!Number.isFinite(suffix) || suffix <= 0) {
        res.statusCode = 416
        res.setHeader('Content-Range', `bytes */${size}`)
        res.end()
        return
      }
      start = Math.max(0, size - suffix)
      end = size - 1
    } else {
      start = parseInt(match[1], 10)
      end = match[2] === '' ? size - 1 : parseInt(match[2], 10)
      if (!Number.isFinite(start)) start = 0
      if (!Number.isFinite(end) || end >= size) end = size - 1
    }

    if (start > end || start >= size || end < 0) {
      res.statusCode = 416
      res.setHeader('Content-Range', `bytes */${size}`)
      res.end()
      return
    }
    res.statusCode = 206
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
    res.setHeader('Content-Length', String(end - start + 1))
    createReadStream(absPath, { start, end }).pipe(res)
    return
  }

  res.setHeader('Content-Length', String(size))
  createReadStream(absPath).pipe(res)
}

/**
 * Build the route family.
 *
 * Media is addressed by **opaque random tokens** minted per inventory response,
 * never by an encoding of the path:
 *
 *   - a token must not be decodable back to a local path, because web wallpapers
 *     run same-origin scripts and can read `/inventory` themselves;
 *   - the map is kept **in memory only** and capped, so it neither leaks the
 *     local directory layout to disk nor grows without bound.
 *
 * @param deps.buildInventory - () => inventory
 * @param deps.getConfig      - () => { manualDirs?: string[] }
 * @param deps.maxTokens      - cap on live tokens (oldest evicted first)
 * @param deps.allowedHosts   - authorities an `Origin` may claim (e.g.
 *                              "127.0.0.1:3080"); empty means no browser origin
 *                              is accepted
 */
export function makeRoutes(deps) {
  const maxTokens = deps.maxTokens ?? 4096
  /**
   * Authorities an `Origin` may claim. Read per request, because the host's
   * real binding may not be known until after these routes are registered.
   */
  const currentAllowed = () => new Set(deps.allowedHosts ?? [])
  /** token -> abs path, insertion-ordered so the oldest key is evictable. */
  const tokens = new Map()

  const tokenFor = (abs) => {
    const token = randomBytes(18).toString('base64url')
    tokens.set(token, abs)
    // Evict oldest beyond the cap (Map preserves insertion order).
    while (tokens.size > maxTokens) {
      const oldest = tokens.keys().next()
      if (oldest.done) break
      tokens.delete(oldest.value)
    }
    return token
  }
  /** Resolve a token, or answer 404. Never trusts a client path. */
  const resolve = (req, res, prefix) => {
    let token = ''
    try {
      const pathname = new URL(req.url || '/', 'http://localhost').pathname
      token = decodeURIComponent(pathname.slice(prefix.length).split('/')[0] ?? '')
    } catch {
      /* fall through to 404 */
    }
    const abs = tokens.get(token)
    if (!abs) {
      writeJson(res, 404, { ok: false, error: 'unknown-token' })
      return null
    }
    return abs
  }

  let cache = null
  let cacheAt = 0
  const CACHE_MS = 5000
  const inventory = (force = false) => {
    const now = Date.now()
    if (!force && cache && now - cacheAt < CACHE_MS) return cache
    cache = deps.buildInventory()
    cacheAt = now
    return cache
  }

  const entryToJson = (entry) => {
    const playable = existsSync(entry.fileAbs)
    const isVideo = entry.type === 'video'
    const isWeb = entry.type === 'web'
    const isImage = entry.type === 'image'
    return {
      id: entry.id,
      title: entry.title,
      type: entry.type,
      source: entry.source,
      tags: entry.tags,
      size: entry.size,
      previewUrl: entry.previewAbs && existsSync(entry.previewAbs) ? `${API_PREFIX}/preview/${tokenFor(entry.previewAbs)}` : null,
      // Videos and images stream straight into the backdrop media layer.
      mediaUrl: playable && (isVideo || isImage) ? `${API_PREFIX}/media/${tokenFor(entry.fileAbs)}` : null,
      // Web wallpapers open in a sandboxed same-origin iframe.
      webUrl: playable && isWeb ? `${API_PREFIX}/web/${tokenFor(entry.fileAbs)}/` : null,
      playable: playable && (isVideo || isImage || isWeb),
    }
  }

  const routes = []

  routes.push({
    kind: 'exact',
    path: `${API_PREFIX}/inventory`,
    handler: (req, res) => {
      if (req.method !== 'GET') return writeJson(res, 405, { ok: false, error: 'method-not-allowed' })
      if (!sameOrigin(req, currentAllowed())) return writeJson(res, 403, { ok: false, error: 'cross-origin' })
      try {
        const force = /[?&]refresh=1/.test(req.url ?? '')
        const inv = inventory(force)
        const wallpapers = inv.wallpapers.map(entryToJson)
        writeJson(res, 200, {
          ok: true,
          installDir: inv.installDir,
          roots: inv.roots,
          total: wallpapers.length,
          playable: wallpapers.filter((w) => w.playable).length,
          manualDirs: deps.getConfig().manualDirs ?? [],
          wallpapers,
        })
      } catch (error) {
        writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  })

  // Media / preview / web tokens. `.tex` is not decoded here; those wallpapers
  // simply fall back to their preview image.
  for (const seg of ['media', 'preview', 'web']) {
    const prefix = `${API_PREFIX}/${seg}/`
    routes.push({
      kind: 'prefix',
      path: `${API_PREFIX}/${seg}`,
      handler: (req, res) => {
        if (req.method !== 'GET') return writeJson(res, 405, { ok: false, error: 'method-not-allowed' })
        if (!sameOrigin(req, currentAllowed())) return writeJson(res, 403, { ok: false, error: 'cross-origin' })
        const abs = resolve(req, res, prefix)
        if (!abs) return
        serveFile(abs, req, res)
      },
    })
  }

  return routes
}
