/**
 * Resolve desktop shell paths from the apps/desktop package root. Compiled
 * main code may run from dist/main, bundled lib/main.js, or lib/types; walk
 * upward until the desktop manifest is found instead of assuming a fixed depth.
 * @module @deepseek-ai/dsh-desktop/desktop-paths
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Absolute path of the apps/desktop directory for the executing main module.
 *
 * The walk starts inside the package's own build output, so the first readable
 * manifest upward is the package root itself. The packaged manifest's `name`
 * is the ASCII OEM identity (DeepWorker), not the workspace name, so the name
 * cannot select the root.
 */
export function desktopPackageRoot(moduleUrl: string): string {
  let directory = dirname(resolve(fileURLToPath(moduleUrl)))
  for (let depth = 0; depth < 8; depth += 1) {
    const manifestPath = join(directory, 'package.json')
    if (existsSync(manifestPath)) {
      try {
        JSON.parse(readFileSync(manifestPath, 'utf8'))
        return directory
      } catch {
        // Keep walking when the manifest is unreadable.
      }
    }
    const parent = resolve(directory, '..')
    if (parent === directory) break
    directory = parent
  }
  throw new Error('desktop: cannot locate the apps/desktop package root from the executing main module')
}

/** Built web dist directory (Vite output copied or emitted under apps/desktop/web). */
export function desktopWebDistDir(moduleUrl: string): string {
  return join(desktopPackageRoot(moduleUrl), 'web')
}

/** Preload script path for the current on-disk layout (dev dist emit or packaged lib bundle). */
export function resolveDesktopPreloadPath(moduleUrl: string): string {
  const root = desktopPackageRoot(moduleUrl)
  for (const relative of ['lib/preload/index.cjs', 'dist/preload/index.js', 'lib/preload/index.js']) {
    const candidate = join(root, relative)
    if (existsSync(candidate)) return candidate
  }
  throw new Error(
    'desktop: preload script is missing; run pnpm run build:main and node scripts/build-render-transport.mjs, '
    + 'or pnpm run bundle after the host TypeScript emit',
  )
}

/** Render-transport IIFE consumed by offline index.html composition. */
export function resolveDesktopRenderTransportPath(moduleUrl: string): string {
  const path = join(desktopPackageRoot(moduleUrl), 'dist/render-transport.js')
  if (!existsSync(path)) {
    throw new Error(`desktop: missing ${path}; run node scripts/build-render-transport.mjs before launching`)
  }
  return path
}
