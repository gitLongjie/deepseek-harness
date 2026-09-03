/**
 * Single source of truth for the packaged desktop's on-disk runtime resources:
 * the asar-unpack manifest the packager injects and the boot-time completeness
 * assertions. Plain-Node subprocesses (ELECTRON_RUN_AS_NODE) and native
 * bindings cannot load from inside app.asar, so their load closures must exist
 * as `app.asar.unpacked` twins. `scripts/deploy-app.mjs` imports this module's
 * built output for the packager globs, and the desktop boot asserts the same
 * list fails loud before the host tree mounts.
 * @module @deepseek-ai/dsh-desktop/desktop/packaged-resources
 */

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Packages whose load closure must exist on disk beside app.asar: the Windows
 * ACL sandbox runner chain (spawned in Node mode, which cannot read the
 * archive) and its koffi FFI binding. The packager globs ship on every
 * platform; the twin assertions apply only where the packages are used.
 */
export const REQUIRED_UNPACKED_PACKAGES: readonly string[] = [
  '@deepseek-ai/dsh-sandbox-windows-acl',
  '@deepseek-ai/dsh-win32-process',
  'koffi',
]

/** electron-builder `asarUnpack` globs covering every required unpacked package. */
export const ASAR_UNPACK_GLOBS: readonly string[] = [
  '**/*.node',
  ...REQUIRED_UNPACKED_PACKAGES.map(name => `**/node_modules/${name}/**`),
]

/** Stable id of one boot-critical packaged resource, localized in desktop/locales. */
export type PackagedResourceLabel =
  | 'web-dist'
  | 'agent-presets'
  | 'desktop-patch'
  | 'workflow-worker'
  | 'windows-acl-runner'
  | 'koffi-binding'

/** One missing boot-critical packaged resource. */
export interface MissingPackagedResource {
  /** Stable id for localization. */
  label: PackagedResourceLabel
  /** The path whose absence breaks the launch. */
  path: string
}

/** Options for {@link findMissingPackagedResources}. */
export interface PackagedResourceCheckOptions {
  /** Platform selecting the Windows-only twin assertions; defaults to `process.platform`. */
  platform?: NodeJS.Platform
  /** Force twin assertions on regardless of the appRoot layout (test hook). */
  forcePackaged?: boolean
}

/**
 * Collect the desktop's boot-critical runtime resources missing from `appRoot`.
 * An empty array means the layout is complete. Runs inside the Electron main
 * process, where fs reads see through app.asar, so the archive-layout checks
 * work identically against the packed archive and the open checkout. The
 * unpacked-twin checks apply only to the packaged layout (`app.asar` root) and
 * only on their owning platform.
 * @param appRoot - the app directory (`app.getAppPath()`): the `app.asar`
 *   archive path when packaged, the checkout `apps/desktop` otherwise.
 * @param options - platform and packaged-layout overrides (test hooks).
 * @returns one entry per missing resource.
 */
export function findMissingPackagedResources(
  appRoot: string,
  options: PackagedResourceCheckOptions = {},
): MissingPackagedResource[] {
  const missing: MissingPackagedResource[] = []
  const webIndex = join(appRoot, 'web', 'index.html')
  if (!existsSync(webIndex)) missing.push({ label: 'web-dist', path: webIndex })
  const presetsRoot = join(appRoot, 'config', 'agent-presets')
  if (!existsSync(presetsRoot) || readdirSync(presetsRoot).length === 0) {
    missing.push({ label: 'agent-presets', path: presetsRoot })
  }
  const desktopPatch = join(appRoot, 'cordis.patch.yml')
  if (!existsSync(desktopPatch)) missing.push({ label: 'desktop-patch', path: desktopPatch })
  const workerEntry = join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-workflow-worker-thread', 'lib', 'worker.cjs')
  if (!existsSync(workerEntry)) missing.push({ label: 'workflow-worker', path: workerEntry })

  // The open checkout has no app.asar and no unpacked twins: its runner and
  // koffi resolve through regular node_modules, which boot itself exercises.
  const packaged = options.forcePackaged === true || appRoot.endsWith('app.asar')
  if (!packaged || (options.platform ?? process.platform) !== 'win32') return missing

  const unpackedRoot = `${appRoot}.unpacked`
  const runnerEntry = join(unpackedRoot, 'node_modules', '@deepseek-ai', 'dsh-sandbox-windows-acl', 'lib', 'runner.js')
  if (!existsSync(runnerEntry)) missing.push({ label: 'windows-acl-runner', path: runnerEntry })
  const koffiEntry = join(unpackedRoot, 'node_modules', 'koffi', 'package.json')
  if (!existsSync(koffiEntry)) missing.push({ label: 'koffi-binding', path: koffiEntry })
  return missing
}
