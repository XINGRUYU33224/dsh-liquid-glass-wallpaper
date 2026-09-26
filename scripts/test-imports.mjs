/**
 * Import smoke test: every module in lib/ must load and expose the plugin
 * contract. Catches bad re-exports before they take the whole GUI boot down.
 */
const mods = ['../lib/we-library.js', '../lib/routes.js', '../lib/index.js']
let fail = 0
for (const m of mods) {
  try {
    const mod = await import(m)
    const keys = Object.keys(mod)
    console.log(`  OK    ${m} — ${keys.length} exports`)
    if (m.endsWith('index.js')) {
      const need = ['apply', 'inject', 'name', 'API_PREFIX', 'makeRoutes', 'buildInventory']
      const missing = need.filter((k) => !(k in mod))
      if (missing.length) {
        console.log(`  FAIL  index.js missing: ${missing.join(', ')}`)
        fail++
      } else {
        console.log(`  OK    index.js exposes the plugin contract (${need.join(', ')})`)
      }
    }
  } catch (e) {
    console.log(`  FAIL  ${m} — ${e.message}`)
    fail++
  }
}
console.log(fail === 0 ? '\nimport smoke: PASS' : `\nimport smoke: ${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
