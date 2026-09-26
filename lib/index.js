/**
 * dsh-liquid-glass-wallpaper — host half.
 *
 * Reads the machine's local Wallpaper Engine library and serves it to the GUI
 * as a frosted liquid-glass backdrop. Registers the `/api/liquid-glass/*`
 * route family on the DSH web server; the client half is `lib/client.js`.
 *
 * Wallpapers are the user's own local files. Nothing is uploaded or
 * redistributed — Workshop content belongs to its authors.
 *
 * @module dsh-liquid-glass-wallpaper
 */
import { buildInventory } from './we-library.js'
import { API_PREFIX, makeRoutes } from './routes.js'

export { buildInventory, locateWallpaperEngine, owningLibraries } from './we-library.js'
export { API_PREFIX, makeRoutes } from './routes.js'

/** Cordis plugin name. */
export const name = 'liquid-glass-wallpaper'

/** Required services. */
export const inject = ['webServer']

/**
 * Plugin entry. Config may carry `manualDirs` (extra folders the user pointed
 * at) — read defensively via `ctx.config` so it stays optional, and the plugin
 * boots with zero configuration.
 */
export function apply(ctx) {
  const readConfig = () => {
    try {
      return ctx.config ?? {}
    } catch {
      // `config` is only readable once the plugin declares it in `inject`;
      // treat it as absent rather than taking the whole boot down.
      return {}
    }
  }
  const getConfig = () => {
    const config = readConfig()
    const manualDirs = Array.isArray(config.manualDirs) ? config.manualDirs.filter((d) => typeof d === 'string') : []
    return { manualDirs }
  }
  const build = () => buildInventory({ manualDirs: getConfig().manualDirs })

  /**
   * Authorities an `Origin` may claim. A loopback address on the port this host
   * is actually serving is the only browser origin that can legitimately reach
   * these routes. Deliberately NOT the request's own `Host` header, which is
   * attacker-controlled — comparing the two would let a DNS-rebound page pass.
   */
  const config = readConfig()
  const port = config.port ?? process.env.DSH_WEB_PORT ?? process.env.DSH_PORT
  const loopback = ['127.0.0.1', 'localhost', '[::1]', '::1']
  const allowedHosts = port
    ? loopback.map((h) => `${h}:${port}`)
    : [
        ...loopback,
        ...loopback.flatMap((h) => [`${h}:80`, `${h}:443`, `${h}:3080`, `${h}:19387`]),
      ]

  try {
    ctx.effect(() => {
      const disposers = []
      try {
        for (const route of makeRoutes({ buildInventory: build, getConfig, allowedHosts })) {
          disposers.push(ctx.webServer.register(route))
        }
      } catch (error) {
        for (const dispose of disposers) dispose()
        throw error
      }
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'liquid-glass-wallpaper: routes')
  } catch (error) {
    console.error('[liquid-glass-wallpaper] route registration failed:', error)
    return
  }

  try {
    const inv = buildInventory({ manualDirs: getConfig().manualDirs })
    console.info(
      `[liquid-glass-wallpaper] ready — ${inv.wallpapers.length} wallpapers` +
        (inv.installDir ? ` (${inv.installDir})` : ' (Wallpaper Engine not found)'),
    )
  } catch (error) {
    console.error('[liquid-glass-wallpaper] inventory probe failed:', error)
  }
}
