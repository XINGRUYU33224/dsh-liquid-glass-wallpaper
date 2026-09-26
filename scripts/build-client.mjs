/**
 * Build step for the client half.
 *
 * The DSH loader serves each client plugin as a single self-registering bundle:
 *
 *   window.__ModuleLoader__.load({ id, factory: (require) => { … } })
 *
 * This script wraps `src/client.js` in exactly that envelope, so the source can
 * stay plain ESM (readable, lintable, testable) while the artifact matches the
 * loader contract.
 *
 *   node scripts/build-client.mjs [--check]
 *
 * `--check` builds in memory and fails if lib/client.js is stale, so CI can
 * catch a source edit that was never rebuilt.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Script } from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const PKG = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const ID = PKG.name
const SRC = join(root, 'src', 'client.js')
const OUT = join(root, 'lib', 'client.js')

const source = readFileSync(SRC, 'utf8')

/**
 * Collect the top-level `export const|function|let|var` declarations. The
 * source must be well-formed ESM, so an `export` keyword can only appear at the
 * start of a line for a top-level declaration. Anything else (an `export`
 * inside a template literal or a comment) is a hard error rather than silent
 * corruption: this transform is deliberately strict.
 */
const DECL = /^export +(const|function|let|var) +([A-Za-z_$][\w$]*)/gm
const renames = new Map()
let stripped = ''
let cursor = 0
let m
while ((m = DECL.exec(source)) !== null) {
  const [, kind, id] = m
  if (renames.has(id)) {
    throw new Error(`duplicate export "${id}" in src/client.js`)
  }
  const local = `__x_${id}`
  renames.set(id, local)
  stripped += source.slice(cursor, m.index)
  stripped += kind === 'function' ? `function ${local}` : `${kind} ${local}`
  cursor = m.index + m[0].length
}
stripped += source.slice(cursor)

if (renames.size === 0) {
  throw new Error('no exports found in src/client.js — the bundle would register nothing')
}

// Guard against a stray `export` that the anchored pass did not consume (for
// example one inside a multi-line template literal): that would leave invalid
// syntax inside the factory.
const stray = /^export +/m.exec(stripped)
if (stray !== null) {
  const line = stripped.slice(0, stray.index).split('\n').length
  throw new Error(
    `unconsumed \`export\` at src/client.js:${line}. Move it to a top-level declaration ` +
      '(the source must not contain a line starting with "export " that is not a top-level declaration).',
  )
}

// `ctx.react` is not part of the plugin context; React arrives via require().
// Only rewrite it outside string literals, so a documented mention or a user
// string can never be mangled.
const rewritten = stripped.replace(
  /(['"`])(?:\\.|(?!\1)[^\\])*\1|\bctx\.react\b/g,
  (match) => (match === 'ctx.react' ? 'React' : match),
)

const indented = (text) =>
  text
    .split('\n')
    .map((l) => (l.trim() === '' ? l : `\t\t${l}`))
    .join('\n')

const exportLines = [...renames.entries()]
  .map(([original, local]) => `\t\texports.${original} = ${local};`)
  .join('\n')

const out = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(ID)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
\t\tconst React = require("react");
${indented(rewritten)}
${exportLines}
\t\treturn module.exports;
\t}
});
`

// ---- verification of the artifact -----------------------------------------
// 1. The bundle must parse. Compiling (not running) catches any transform
//    mistake before it reaches the GUI, where it would take the plugin down.
try {
  new Script(out, { filename: 'lib/client.js' })
} catch (error) {
  // The CSS and HTML in the client source live in template literals, so an
  // accidental backtick inside a comment or a CSS value silently ends the
  // literal and reports a syntax error far from the real cause. Say so.
  const hint = /Unexpected identifier|Invalid or unexpected token/.test(error.message)
    ? '\n  hint: check for a stray backtick inside a template literal (the CSS/HTML' +
      ' strings in src/client.js are backtick-delimited, so a backtick in a comment breaks them)'
    : ''
  throw new Error(`built bundle does not parse: ${error.message}${hint}`)
}

// 2. Every run of non-ASCII characters must survive byte-for-byte. A lossy
//    decode or a bad rewrite would otherwise ship silent mojibake UI labels.
const literals = source.match(/[^\x00-\x7F]+/g) ?? []
const missing = [...new Set(literals)].filter((s) => !out.includes(s))
if (missing.length > 0) {
  throw new Error(
    `non-ASCII text did not survive the build (${missing.length} run(s)): ` +
      missing.slice(0, 5).map((s) => JSON.stringify(s)).join(', '),
  )
}

if (process.argv.includes('--check')) {
  let current = ''
  try {
    current = readFileSync(OUT, 'utf8')
  } catch {
    /* not built yet */
  }
  if (current !== out) {
    console.error('lib/client.js is stale — run `node scripts/build-client.mjs`')
    process.exit(1)
  }
  console.log(`lib/client.js is up to date (id=${ID}, ${renames.size} exports)`)
  process.exit(0)
}

writeFileSync(OUT, out, 'utf8')
console.log(
  `built lib/client.js — id=${ID}, ${renames.size} exports (${[...renames.keys()].join(', ')}), ` +
    `${literals.length} non-ASCII runs verified`,
)
