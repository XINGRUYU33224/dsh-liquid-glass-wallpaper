/**
 * Standalone harness for the host half: spins a bare node HTTP server that
 * registers the plugin's route family, so the routes can be exercised without
 * booting the whole DSH GUI. Verifies inventory, token resolution, preview
 * delivery and Range streaming.
 */
import { createServer } from 'node:http'
import { join } from 'node:path'
import { buildInventory } from '../lib/we-library.js'
import { makeRoutes } from '../lib/routes.js'

let routes
const server = createServer((req, res) => {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname
  for (const route of routes) {
    if (route.kind === 'exact' && pathname === route.path) return route.handler(req, res)
    if (route.kind === 'prefix' && pathname.startsWith(route.path + '/')) return route.handler(req, res)
  }
  res.writeHead(404).end('no route')
})

await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

// Bind the route family to the authority this harness is actually served on, so
// the same-origin fence can be exercised both ways.
routes = makeRoutes({
  buildInventory: () => buildInventory({}),
  getConfig: () => ({ manualDirs: [] }),
  allowedHosts: [`127.0.0.1:${server.address().port}`],
})

const get = async (path, headers = {}) => {
  const res = await fetch(base + path, { headers })
  return res
}

let pass = 0
let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) {
    pass++
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    fail++
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('== inventory ==')
const invRes = await get('/api/liquid-glass/inventory')
const inv = await invRes.json()
check('inventory 200', invRes.status === 200)
check('inventory ok flag', inv.ok === true)
check('found wallpapers', inv.total > 20, `total=${inv.total}`)
check('installDir located', typeof inv.installDir === 'string' && inv.installDir.length > 0, inv.installDir)
check('playable > 0', inv.playable > 0, `playable=${inv.playable}`)

// Scene wallpapers are deliberately not offered: their only usable still is a
// 1:1 preview that a 16:9 window upscales as much as 11x. They must be absent
// from the inventory entirely, and nothing may arrive with an unknown type.
const scenes = inv.wallpapers.filter((w) => w.type === 'scene')
check('no scene wallpapers offered', scenes.length === 0, `${scenes.length} present`)
const unknown = inv.wallpapers.filter((w) => !['video', 'image', 'web'].includes(w.type))
check('every entry has a supported type', unknown.length === 0, JSON.stringify(unknown.slice(0, 3).map((w) => w.type)))
check(
  'no entry exposes a scene URL',
  inv.wallpapers.every((w) => !('sceneUrl' in w) || w.sceneUrl === null),
)

const video = inv.wallpapers.find((w) => w.type === 'video' && w.mediaUrl)
const withPreview = inv.wallpapers.find((w) => w.previewUrl)
check('a video wallpaper exists', Boolean(video), video?.title)
check('previews exist', Boolean(withPreview))

console.log('\n== token media ==')
const vres = await get(video.mediaUrl, { Range: 'bytes=0-1023' })
check('video range 206', vres.status === 206, `status=${vres.status}`)
check('content-range set', Boolean(vres.headers.get('content-range')), vres.headers.get('content-range') ?? '')
check('content-type video', (vres.headers.get('content-type') ?? '').startsWith('video/'), vres.headers.get('content-type') ?? '')
const body = Buffer.from(await vres.arrayBuffer())
check('range bytes delivered', body.length === 1024, `got ${body.length}`)

const full = await get(video.mediaUrl)
check('video full 200', full.status === 200)
check('accept-ranges advertised', full.headers.get('accept-ranges') === 'bytes')
await full.body?.cancel()

console.log('\n== preview ==')
const pres = await get(withPreview.previewUrl)
check('preview 200', pres.status === 200)
check('preview image mime', (pres.headers.get('content-type') ?? '').startsWith('image/'), pres.headers.get('content-type') ?? '')
const pbuf = Buffer.from(await pres.arrayBuffer())
check('preview has bytes', pbuf.length > 500, `${pbuf.length} bytes`)
const head = pbuf.toString('ascii', 0, 4)
check('preview is a real image', pbuf[0] === 0xff || pbuf[0] === 0x89 || head === 'RIFF' || head === 'GIF8', `magic=${head}`)

console.log('\n== security ==')
const bad = await get('/api/liquid-glass/media/' + Buffer.from('C:\\Windows\\win.ini').toString('base64url'))
check('unknown token 404', bad.status === 404, `status=${bad.status}`)
const xsite = await fetch(`${base}/api/liquid-glass/inventory`, { headers: { 'sec-fetch-site': 'cross-site' } })
check('cross-site blocked', xsite.status === 403, `status=${xsite.status}`)
const post = await fetch(`${base}/api/liquid-glass/inventory`, { method: 'POST' })
check('POST rejected', post.status === 405, `status=${post.status}`)

// Tokens must be opaque: decoding one must not reveal a local path. Web
// wallpapers run same-origin scripts and can read /inventory themselves, so a
// reversible token would disclose the user's directory layout. The decisive
// check is that the token is a random draw, not a base64 of an absolute path.
const tok = (inv.wallpapers.find((w) => w.mediaUrl)?.mediaUrl ?? '').split('/').pop()
let decoded = ''
try {
  decoded = Buffer.from(tok, 'base64url').toString('utf8')
} catch {
  /* not even decodable — ideal */
}
const looksLikePath =
  /^[A-Za-z]:[\\/]/.test(decoded) || // Windows drive path
  decoded.startsWith('/') || // POSIX absolute path
  /^\\\\/.test(decoded) // UNC path
check(
  'token is not a reversible path encoding',
  !looksLikePath,
  `decoded=${JSON.stringify(decoded.slice(0, 32))}`,
)
// A reversible base64 of a Windows path round-trips exactly; a random token
// does not. Re-encoding the decoded text must not reproduce the token.
check(
  'token does not round-trip through base64',
  Buffer.from(decoded, 'utf8').toString('base64url') !== tok,
)
check('token has enough entropy', tok.length >= 20, `${tok.length} chars`)

// An Origin claiming a host we never bound must be refused even when the
// request's own Host header matches it (the DNS-rebinding case).
const rebound = await fetch(`${base}/api/liquid-glass/inventory`, {
  headers: { Origin: 'http://evil.test', Host: 'evil.test', 'sec-fetch-site': 'same-origin' },
})
check('rebound Origin rejected', rebound.status === 403, `status=${rebound.status}`)

// A genuine loopback Origin on the bound port is accepted.
const goodOrigin = await fetch(`${base}/api/liquid-glass/inventory`, {
  headers: { Origin: base, 'sec-fetch-site': 'same-origin' },
})
check('same-origin Origin accepted', goodOrigin.status === 200, `status=${goodOrigin.status}`)

console.log('\n== web wallpaper ==')
const web = inv.wallpapers.find((w) => w.type === 'web' && w.webUrl)
if (web) {
  const wres = await get(web.webUrl)
  check('web 200', wres.status === 200, `status=${wres.status}`)
  await wres.body?.cancel()
} else {
  console.log('  SKIP  no web wallpaper in library')
}

server.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
