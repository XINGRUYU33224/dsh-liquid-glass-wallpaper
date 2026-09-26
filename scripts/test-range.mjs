/**
 * Range-request edge cases against the live plugin routes.
 * Video seeking depends on these being exactly right.
 */
import { createServer } from 'node:http'
import { buildInventory } from '../lib/we-library.js'
import { makeRoutes } from '../lib/routes.js'

let routes
const server = createServer((req, res) => {
  const p = new URL(req.url || '/', 'http://localhost').pathname
  for (const r of routes) {
    if (r.kind === 'exact' && p === r.path) return r.handler(req, res)
    if (r.kind === 'prefix' && p.startsWith(r.path + '/')) return r.handler(req, res)
  }
  res.writeHead(404).end('no route')
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`
routes = makeRoutes({
  buildInventory: () => buildInventory({}),
  getConfig: () => ({ manualDirs: [] }),
  allowedHosts: [`127.0.0.1:${server.address().port}`],
})

const inv = await (await fetch(`${base}/api/liquid-glass/inventory`)).json()
const video = inv.wallpapers.find((w) => w.type === 'video' && w.mediaUrl)
const url = base + video.mediaUrl

// Learn the true size from a full HEAD-ish GET.
const probe = await fetch(url, { headers: { Range: 'bytes=0-0' } })
const size = Number(/bytes 0-0\/(\d+)/.exec(probe.headers.get('content-range'))[1])
await probe.body?.cancel()
console.log(`file size: ${size}\n`)

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

const cases = [
  // name, header, expectStatus, expectRange (null = don't care), expectLen
  ['normal range', 'bytes=0-1023', 206, `bytes 0-1023/${size}`, 1024],
  ['single byte', 'bytes=0-0', 206, `bytes 0-0/${size}`, 1],
  ['open-ended', 'bytes=' + (size - 100) + '-', 206, `bytes ${size - 100}-${size - 1}/${size}`, 100],
  ['exact-last-byte', `bytes=${size - 1}-`, 206, `bytes ${size - 1}-${size - 1}/${size}`, 1],
  ['end beyond size clamps', 'bytes=0-99999999999', 206, `bytes 0-${size - 1}/${size}`, null],
  ['start beyond size -> 416', `bytes=${size + 10}-`, 416, `bytes */${size}`, null],
  ['start == size -> 416', `bytes=${size}-`, 416, `bytes */${size}`, null],
  ['inverted range -> 416', 'bytes=500-100', 416, `bytes */${size}`, null],
  ['no range -> 200', null, 200, null, null],
]

for (const [name, header, wantStatus, wantRange, wantLen] of cases) {
  const headers = header ? { Range: header } : {}
  const res = await fetch(url, { headers })
  const gotRange = res.headers.get('content-range')
  const gotLen = res.headers.get('content-length')
  const okStatus = res.status === wantStatus
  const okRange = wantRange === null || gotRange === wantRange
  const okLen = wantLen === null || Number(gotLen) === wantLen
  // For 206 we must be able to read exactly the advertised length.
  let okBody = true
  if (res.status === 206 && gotLen) {
    const buf = Buffer.from(await res.arrayBuffer())
    okBody = buf.length === Number(gotLen)
  } else {
    await res.body?.cancel()
  }
  check(
    name,
    okStatus && okRange && okLen && okBody,
    `status=${res.status}${gotRange ? ` range=${gotRange}` : ''}${gotLen ? ` len=${gotLen}` : ''}`,
  )
}

// Suffix ranges: RFC 7233 says `bytes=-N` means the LAST N bytes. Browsers emit
// these when seeking, so they must be exact.
const suffixCases = [
  ['suffix -500', 'bytes=-500', 206, `bytes ${size - 500}-${size - 1}/${size}`, 500],
  ['suffix -1', 'bytes=-1', 206, `bytes ${size - 1}-${size - 1}/${size}`, 1],
  ['suffix larger than file -> whole body', `bytes=-${size + 1000}`, 206, `bytes 0-${size - 1}/${size}`, size],
  ['suffix 0 -> 416', 'bytes=-0', 416, `bytes */${size}`, null],
  ['empty range -> whole body', 'bytes=-', 200, null, null],
]
// A multi-range request must not be silently truncated to its first range: we
// serve the whole body (200) rather than a misleading single-range 206.
const multiRange = [
  ['multi-range -> whole body, not a truncated 206', 'bytes=0-99, 200-299', 200, null],
  ['unknown unit -> whole body', 'items=0-99', 200, null],
  ['whitespace tolerated', '  bytes=0-9  ', 206, `bytes 0-9/${size}`],
]
for (const [name, header, wantStatus, wantRange] of multiRange) {
  const res = await fetch(url, { headers: { Range: header } })
  const gotRange = res.headers.get('content-range')
  const okStatus = res.status === wantStatus
  const okRange = wantRange === null ? gotRange === null : gotRange === wantRange
  await res.body?.cancel()
  check(name, okStatus && okRange, `status=${res.status}${gotRange ? ` range=${gotRange}` : ''}`)
}
for (const [name, header, wantStatus, wantRange, wantLen] of suffixCases) {
  const res = await fetch(url, { headers: { Range: header } })
  const gotRange = res.headers.get('content-range')
  const gotLen = Number(res.headers.get('content-length'))
  const okStatus = res.status === wantStatus
  const okRange = wantRange === null || gotRange === wantRange
  const okLen = wantLen === null || gotLen === wantLen
  if (res.status === 200) await res.body?.cancel()
  else if (res.headers.get('content-length') && Number(res.headers.get('content-length')) <= 4096) {
    await res.arrayBuffer()
  } else {
    await res.body?.cancel()
  }
  check(name, okStatus && okRange && okLen, `status=${res.status}${gotRange ? ` range=${gotRange}` : ''} len=${gotLen}`)
}

server.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
