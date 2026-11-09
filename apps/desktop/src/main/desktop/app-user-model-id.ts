/**
 * The Windows AppUserModelId of the desktop shell. Windows draws a window's
 * taskbar button, and the toast app name, from the Start Menu shortcut that
 * carries the same id. The installed build owns `com.deepagens.app` alone.
 * Checkout launches never share an id. Each one is `.dev.<checkout>`, derived
 * from that clone's root. A shared `.dev` id lets the other clone's shortcut
 * replace this launch's taskbar icon and notification name.
 * @module @deepseek-ai/dsh-desktop/desktop/app-user-model-id
 */

import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

/** Installed id; equals electron-builder.yml `appId`, which the NSIS shortcuts carry. */
export const DESKTOP_APP_USER_MODEL_ID = 'com.deepagens.app'

/**
 * Resolve the AppUserModelId for this launch.
 * @param environment - Process environment. The dev launcher sets `DSH_DESKTOP_DEV=1` and
 *   `DSH_DESKTOP_DEV_ROOT` to the checkout root.
 * @param checkoutPath - Checkout path used when `DSH_DESKTOP_DEV_ROOT` is unset. A dev launch
 *   with neither throws, so two clones cannot fall back to one id.
 * @returns The installed id, or a per-checkout `.dev.<token>` id.
 */
export function resolveAppUserModelId(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  checkoutPath?: string,
): string {
  if (environment.DSH_DESKTOP_DEV !== '1') return DESKTOP_APP_USER_MODEL_ID
  const root = environment.DSH_DESKTOP_DEV_ROOT?.trim() || checkoutPath?.trim()
  if (root === undefined || root === '') {
    throw new Error('desktop dev launch requires a checkout path so its AppUserModelId stays unique')
  }
  return `${DESKTOP_APP_USER_MODEL_ID}.dev.${checkoutToken(root)}`
}

/** Stable AppUserModelId suffix for one checkout. Paths that differ only by slash or case share a token. */
function checkoutToken(checkoutPath: string): string {
  const normalized = resolve(checkoutPath).replaceAll('\\', '/').toLowerCase()
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12)
}
