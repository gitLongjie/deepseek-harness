/**
 * Product data roots for the desktop shell.
 *
 * DeepWorker keeps sessions, settings, credentials, plugins, and agent
 * configuration under its own Electron appData directory. The shared defaults
 * `~/.dsh` and `~/.agents` belong to DeepSeek Harness and other agent tools.
 * An explicit `DSH_HOME` or `DSH_AGENTS_HOME` that already points somewhere
 * else still selects that launch's data root.
 * @module @deepseek-ai/dsh-desktop/product-data-home
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { defaultAgentsHome, defaultDshHome, resolveAgentsHome, resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** ASCII directory name under Electron appData. Display names stay off this path. */
export const DESKTOP_PRODUCT_DATA_DIR = 'DeepWorker'

/** Child of {@link DESKTOP_PRODUCT_DATA_DIR} that replaces `~/.dsh`. */
const PRODUCT_HOME_DIR = 'home'

/** Child of {@link DESKTOP_PRODUCT_DATA_DIR} that replaces `~/.agents`. */
const PRODUCT_AGENTS_DIR = 'agents'

/**
 * Electron's appData directory for a launcher that has not created an `app` yet.
 * Packaged startup uses `app.getPath('appData')` instead of this fallback.
 * @param platform - Operating system; defaults to the current process.
 * @param env - Environment used for `APPDATA` and `XDG_CONFIG_HOME`.
 * @param home - Account home used when the platform variable is absent.
 * @returns Absolute appData directory.
 */
export function desktopAppDataDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  if (platform === 'win32') {
    const appData = env.APPDATA
    if (appData !== undefined && appData.trim() !== '') return appData
    return join(home, 'AppData', 'Roaming')
  }
  if (platform === 'darwin') return join(home, 'Library', 'Application Support')
  const xdg = env.XDG_CONFIG_HOME
  if (xdg !== undefined && xdg.trim() !== '') return xdg
  return join(home, '.config')
}

/**
 * Compare two absolute paths. Windows treats capitalization as the same path.
 * @param left - First absolute or relative path.
 * @param right - Second absolute or relative path.
 * @returns Whether both resolve to the same location.
 */
function samePath(left: string, right: string): boolean {
  const a = resolve(left)
  const b = resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** Resolved product data roots for one launch. */
export interface DesktopProductDataRoots {
  /** Harness home (`DSH_HOME`): sessions, settings, credentials, plugins. */
  readonly home: string
  /** Agent configuration root (`DSH_AGENTS_HOME`). */
  readonly agents: string
}

/**
 * Choose the desktop data roots.
 * A blank variable and a value that resolves to `~/.dsh` or `~/.agents` select
 * the product directories. Any other explicit value is kept.
 * @param appData - Electron appData directory.
 * @param env - Environment whose `DSH_HOME` and `DSH_AGENTS_HOME` are read.
 * @returns Absolute home and agents directories for this launch.
 */
export function resolveDesktopProductDataRoots(
  appData: string,
  env: Record<string, string | undefined>,
): DesktopProductDataRoots {
  const root = join(appData, DESKTOP_PRODUCT_DATA_DIR)
  const home = resolveDshHome(undefined, env)
  const agents = resolveAgentsHome(undefined, env)
  return {
    home: samePath(home, defaultDshHome()) ? join(root, PRODUCT_HOME_DIR) : home,
    agents: samePath(agents, defaultAgentsHome()) ? join(root, PRODUCT_AGENTS_DIR) : agents,
  }
}

/**
 * Publish the product data roots on the launch environment before Host boot.
 * Later readers, including `loadLayeredEnv`, then stay on these directories.
 * @param appData - Electron appData directory.
 * @param env - Mutable process environment for this launch.
 */
export function pinDesktopProductDataRoots(appData: string, env: NodeJS.ProcessEnv): void {
  const roots = resolveDesktopProductDataRoots(appData, env)
  env.DSH_HOME = roots.home
  env.DSH_AGENTS_HOME = roots.agents
}
