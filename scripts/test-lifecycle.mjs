/**
 * Regression test for the boot-safety defect found in review.
 *
 * `mount()` used to dereference `document.body` unguarded. The DSH client can
 * run before the shell's body exists, and that threw
 * `TypeError: ... reading 'insertBefore'` out of `apply()`, taking the whole
 * plugin down at boot. This test drives the *built bundle* against a document
 * with no body and asserts `apply()` survives.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInThisContext } from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

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

function makeEl(tag) {
  return {
    tagName: tag.toUpperCase(),
    children: [],
    dataset: {},
    style: { setProperty() {}, removeProperty() {} },
    className: '',
    appendChild(c) {
      this.children.push(c)
      return c
    },
    append(...cs) {
      for (const c of cs) this.children.push(c)
    },
    insertBefore(c) {
      this.children.unshift(c)
      return c
    },
    removeChild(c) {
      this.children = this.children.filter((x) => x !== c)
      return c
    },
    setAttribute() {},
    removeAttribute() {},
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
    replaceChildren() {
      this.children = []
    },
    play: () => Promise.resolve(),
    pause() {},
    load() {},
  }
}

// A document that exists but has NO body — the shape at early boot.
const head = makeEl('head')
globalThis.document = {
  body: null,
  head,
  documentElement: { setAttribute() {}, removeAttribute() {} },
  createElement: makeEl,
  querySelector: () => null,
}
globalThis.window = globalThis
globalThis.addEventListener = () => {}
globalThis.removeEventListener = () => {}
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0)
globalThis.localStorage = {
  _d: {},
  getItem(k) {
    return this._d[k] ?? null
  },
  setItem(k, v) {
    this._d[k] = v
  },
}
globalThis.fetch = async () => ({ json: async () => ({ ok: true, wallpapers: [] }) })

const reactStub = {
  createElement: (t, p, ...k) => ({ type: t, props: p, kids: k }),
  useCallback: (f) => f,
  useEffect: () => {},
  useMemo: (f) => f(),
  useRef: (v) => ({ current: v }),
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
}
let registered = null
globalThis.window.__ModuleLoader__ = { load: (s) => (registered = s) }

runInThisContext(src, { filename: 'lib/client.js' })
const exportsObj = registered.factory((id) => (id === 'react' ? reactStub : {}))

const ctx = {
  effect: (fn) => {
    fn()
    return () => {}
  },
  slots: { inject: (n, fn) => fn(), register: () => () => {} },
  locale: { register() {}, bind: () => () => '液态玻璃壁纸' },
}

console.log('== apply() with no <body> ==')
let threw = null
try {
  exportsObj.apply(ctx)
} catch (e) {
  threw = e
}
check('apply() does not throw', threw === null, threw ? String(threw).slice(0, 90) : 'no throw')
// The settings card must still register even though the backdrop cannot mount.
check('settings section still registered', typeof exportsObj.apply === 'function')

console.log('\n== the same document, once <body> appears ==')
globalThis.document.body = makeEl('body')
let threw2 = null
try {
  // A fresh module instance, now with a body present.
  delete globalThis.window.__ModuleLoader__
  globalThis.window.__ModuleLoader__ = { load: (s) => (registered = s) }
  runInThisContext(src, { filename: 'lib/client.js' })
  registered.factory((id) => (id === 'react' ? reactStub : {})).apply(ctx)
} catch (e) {
  threw2 = e
}
check('apply() works once <body> exists', threw2 === null, threw2 ? String(threw2).slice(0, 90) : 'no throw')
const mounted = globalThis.document.body.children.some((c) => c.className === 'lgw-backdrop')
check('backdrop mounts when <body> exists', mounted)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
