/**
 * The @xmanrui/expert-geo-optimizer mount: syncs the packaged expert
 * directories into the harness home's user preset root, where the
 * agent-presets roster's user root discovers them on its next read
 * (trust: user).
 *
 * The host loader anchors both directories through the bundle patch's `!!js`
 * config (the archify skill-root precedent), so this module stays
 * dependency-free: node builtins only, and the composition's copies of the
 * domain packages are resolved by the patch, never by this file.
 */

import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Sync one directory tree into the user preset root: files copy when their
 * content differs (so an unchanged mount never rewrites mtimes), directories
 * recurse, and nothing is ever deleted — a user's edit or an uninstall's
 * leftover stays until the user removes it in the preset authoring UI.
 * @param {string} sourceDir - the packaged expert directory to install from.
 * @param {string} targetDir - the user preset root to install into.
 */
export function syncExperts(sourceDir, targetDir) {
  mkdirSync(targetDir, { recursive: true })
  for (const entry of readdirSync(sourceDir)) {
    const source = join(sourceDir, entry)
    const target = join(targetDir, entry)
    if (statSync(source).isDirectory()) {
      syncExperts(source, target)
      continue
    }
    let identical = false
    try {
      identical = readFileSync(target).equals(readFileSync(source))
    } catch {
      // A missing or unreadable target file is the common first-install case.
      identical = false
    }
    if (!identical) copyFileSync(source, target)
  }
}

/**
 * Cordis plugin apply. Both directories arrive through the bundle patch's
 * `!!js` config; a mount without either is a broken package, so it fails loud
 * instead of silently installing nothing.
 * @param {unknown} ctx - the plugin's cordis context (unused; the sync touches no service).
 * @param {{ expertDir?: unknown, targetDir?: unknown }} config - `expertDir`
 *   (the packaged experts/ root) and `targetDir` (the harness home's user
 *   preset root), both absolute.
 */
export function apply(ctx, config) {
  void ctx
  const expertDir = typeof config?.expertDir === 'string' ? config.expertDir : ''
  const targetDir = typeof config?.targetDir === 'string' ? config.targetDir : ''
  if (expertDir === '' || targetDir === '') {
    throw new Error(
      'expert-geo-optimizer: the mount needs `expertDir` and `targetDir` in its bundle patch config',
    )
  }
  syncExperts(expertDir, targetDir)
}
