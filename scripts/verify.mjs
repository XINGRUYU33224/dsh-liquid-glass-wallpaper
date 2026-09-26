/**
 * Full verification for the liquid-glass wallpaper plugin.
 *   node scripts/verify.mjs
 * Runs every suite in order and reports one verdict. Exits non-zero on any
 * failure so it can gate a release.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const suites = [
  ['build client bundle', ['scripts/build-client.mjs']],
  ['build integrity + guards', ['scripts/test-build.mjs']],
  ['import contract', ['scripts/test-imports.mjs']],
  ['client bundle contract', ['scripts/test-client.mjs']],
  ['boot lifecycle safety', ['scripts/test-lifecycle.mjs']],
  ['host routes + library', ['scripts/test-host.mjs']],
  ['HTTP range edge cases', ['scripts/test-range.mjs']],
]

let failed = 0
for (const [label, args] of suites) {
  console.log(`\n${'='.repeat(58)}\n${label}\n${'='.repeat(58)}`)
  const res = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' })
  if (res.status !== 0) {
    failed++
    console.log(`!! ${label} FAILED (exit ${res.status})`)
  }
}

console.log(`\n${'='.repeat(58)}`)
if (failed === 0) {
  console.log('verify: ALL SUITES PASSED')
  process.exit(0)
}
console.log(`verify: ${failed} suite(s) failed`)
process.exit(1)
