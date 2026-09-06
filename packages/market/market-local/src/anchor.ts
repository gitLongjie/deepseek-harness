/**
 * Resolution of the running dsh installation's package.json — the first anchor
 * of the two-anchor profile bundle lookup — by resolving the app package name
 * from the caller's own module location. Works from a workspace checkout and
 * from a published installation alike: both layouts place the app package on
 * a Node search path that reaches the caller.
 * @module @deepseek-ai/dsh-market-local/anchor
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

/** The app package whose manifest is the installation anchor. */
const APP_PACKAGE_NAME = '@deepseek-ai/dsh'

/**
 * Resolve the installation anchor by probing Node's package search paths for
 * {@link APP_PACKAGE_NAME}.
 * @param from - module URL or path the search paths resolve from.
 * @returns absolute path of the app package's package.json.
 * @throws when no search-path candidate carries the app package; the market
 *   service cannot reconcile profile bundles without it.
 */
export function resolveInstallAnchor(from: string): string {
  const candidates = createRequire(from).resolve.paths(APP_PACKAGE_NAME) ?? []
  for (const candidate of candidates) {
    const anchor = join(candidate, ...APP_PACKAGE_NAME.split('/'), 'package.json')
    if (!existsSync(anchor)) continue
    try {
      const manifest = JSON.parse(readFileSync(anchor, 'utf8')) as { name?: unknown }
      if (manifest.name === APP_PACKAGE_NAME) return anchor
    } catch {
      // A malformed manifest at one search-path candidate is not this package; keep walking.
    }
  }
  throw new Error(`market-local: cannot resolve the running dsh installation (${APP_PACKAGE_NAME}) from ${from}`)
}
