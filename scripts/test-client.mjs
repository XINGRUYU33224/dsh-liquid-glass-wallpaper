/**
 * Bundle contract test: load lib/client.js under a stubbed
 * `window.__ModuleLoader__` and assert it registers the right id and exports
 * `apply` + `inject`. Also exercises `apply()` against a minimal fake context
 * to prove the backdrop mounts and the settings card registers.
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

// ---- minimal DOM -------------------------------------------------------
const styleTags = []
const elements = []
function makeEl(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    children: [],
    dataset: {},
    style: { setProperty() {}, removeProperty() {} },
    attributes: {},
    className: '',
    textContent: '',
    parentNode: null,
    appendChild(c) {
      this.children.push(c)
      c.parentNode = this
      return c
    },
    append(...cs) {
      for (const c of cs) this.appendChild(c)
    },
    insertBefore(c) {
      this.children.unshift(c)
      c.parentNode = this
      return c
    },
    removeChild(c) {
      this.children = this.children.filter((x) => x !== c)
      c.parentNode = null
      return c
    },
    setAttribute(k, v) {
      this.attributes[k] = v
    },
    removeAttribute(k) {
      delete this.attributes[k]
    },
    querySelector() {
      return null
    },
    addEventListener() {},
    removeEventListener() {},
    replaceChildren() {
      this.children = []
    },
  }
  elements.push(el)
  return el
}

const body = makeEl('body')
const head = makeEl('head')
head.appendChild = function (c) {
  styleTags.push(c)
  c.parentNode = this
  return c
}
const documentElement = makeEl('html')
documentElement.attributes = {}
documentElement.setAttribute = function (k, v) {
  this.attributes[k] = v
}
documentElement.removeAttribute = function (k) {
  delete this.attributes[k]
}

globalThis.document = {
  body,
  head,
  documentElement,
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

// ---- loader stub -------------------------------------------------------
let registered = null
globalThis.window.__ModuleLoader__ = {
  load(spec) {
    registered = spec
  },
}

const reactStub = {
  createElement: (type, props, ...kids) => ({ type, props, kids }),
  useCallback: (fn) => fn,
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useRef: (v) => ({ current: v }),
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
}
const requireStub = (id) => {
  if (id === 'react') return reactStub
  if (id === 'react/jsx-runtime') return {}
  throw new Error(`unexpected require: ${id}`)
}

console.log('== bundle contract ==')
runInThisContext(src, { filename: 'lib/client.js' })
check('loader.load called', registered !== null)
check('registers correct id', registered?.id === 'dsh-liquid-glass-wallpaper', registered?.id)
check('factory is a function', typeof registered?.factory === 'function')

const exportsObj = registered.factory(requireStub)
check('exports apply', typeof exportsObj.apply === 'function')
check('exports inject', Array.isArray(exportsObj.inject), JSON.stringify(exportsObj.inject))
check('inject includes slots', exportsObj.inject.includes('slots'))

console.log('\n== apply() wiring ==')
let effectCalls = 0
let injectCalls = 0
let registeredSection = null
const ctx = {
  effect(fn, label) {
    effectCalls++
    return () => {}
  },
  slots: {
    inject(name, fn) {
      injectCalls++
      fn()
    },
    register(spec, comp) {
      registeredSection = { spec, comp }
      return () => {}
    },
  },
  locale: {
    define() {},
    bind: () => () => '液态玻璃壁纸',
  },
}

exportsObj.apply(ctx)
check('ctx.effect used', effectCalls === 1, `${effectCalls}`)
check('settings slot injected', injectCalls === 1)
check('section registered', registeredSection !== null)
check('section id correct', registeredSection?.spec?.id === 'liquid-glass-wallpaper', registeredSection?.spec?.id)
check('section name is settings.section', registeredSection?.spec?.name === 'settings.section')
check('section component is callable', typeof registeredSection?.comp === 'function')

console.log('\n== backdrop DOM ==')
const htmlHasAttr = () => 'data-liquid-glass' in documentElement.attributes
await new Promise((r) => setTimeout(r, 30))
check('root attribute set on <html>', htmlHasAttr(), JSON.stringify(Object.keys(documentElement.attributes)))
const backdrop = body.children.find((c) => c.className === 'lgw-backdrop')
check('backdrop element mounted in <body>', Boolean(backdrop))
check('backdrop has glass layers', backdrop?.children?.length === 5, `layers=${backdrop?.children?.length}`)
check('style tag injected once', styleTags.length === 1, `tags=${styleTags.length}`)
check('style contains frost layer', String(styleTags[0]?.textContent ?? '').includes('.lgw-frost'))
check('style contains scoping attr', String(styleTags[0]?.textContent ?? '').includes('data-liquid-glass'))

console.log('\n== settings card renders ==')
const tree = registeredSection.comp({})
check('card returns an element', tree !== null && typeof tree === 'object')
check('card root is a div', tree?.type === 'div')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
