/**
 * Product data roots for the desktop shell.
 *
 * DeepWorker keeps sessions, settings, credentials, plugins, and agent
 * configuration under its own Electron appData directory. The shared defaults
 * `~/.dsh` and `~/.agents` belong to DeepSeek Harness and other agent tools.
 * An explicit `DSH_HOME` or `DSH_AGENTS_HOME` that already points somewhere
 * else still selects that launch's data root. When the product directories
 * are selected, missing or empty top-level entries are copied from `~/.dsh`,
 * `~/.agents`, and earlier desktop data directories before Host boot.
 * The shared directories stay in place.
 * @module @deepseek-ai/dsh-desktop/product-data-home
 */

import { cpSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { defaultAgentsHome, defaultDshHome, resolveAgentsHome, resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** ASCII directory name under Electron appData. Display names stay off this path. */
export const DESKTOP_PRODUCT_DATA_DIR = 'DeepWorker'

/** Child of {@link DESKTOP_PRODUCT_DATA_DIR} that replaces `~/.dsh`. */
const PRODUCT_HOME_DIR = 'home'

/** Child of {@link DESKTOP_PRODUCT_DATA_DIR} that replaces `~/.agents`. */
const PRODUCT_AGENTS_DIR = 'agents'

/**
 * Earlier desktop file-system ids and brand names.
 * Updates keep reading `DeepWorker`, so these directories are copied forward.
 */
const PREVIOUS_DESKTOP_DATA_DIRS = ['miaoWorker', 'MindaWork', 'MeowWork', 'DeepWork', 'Deepagens-Worker'] as const

/** Chromium cache directories. They are not configuration or sessions. */
const USER_DATA_CACHE_DIRS = [
  'Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache',
  'blob_storage', 'Shared Dictionary', 'Session Storage', 'Local Storage',
  'SharedStorage', 'Service Worker', 'WebStorage',
] as const

/** Entries that identify a directory as a harness home rather than Electron user data. */
const HARNESS_HOME_MARKERS = ['profiles', 'cordis.patch.yml'] as const

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

/** Shared directories that may still hold desktop data from before the product roots. */
export interface DesktopSharedDataDirectories {
  /** Previous harness home, normally `~/.dsh`. */
  readonly home: string
  /** Previous agents root, normally `~/.agents`. */
  readonly agents: string
}

/**
 * A product-data copy stopped before the destination was replaced.
 * Staging is removed. Files that were already in either directory stay.
 */
export class DesktopProductDataMigrationError extends Error {
  /** Directory the copy read. */
  readonly source: string
  /** Directory the copy was writing. */
  readonly target: string

  /**
   * @param source - Directory the copy read.
   * @param target - Directory the copy was writing.
   * @param cause - Filesystem error from the failed copy.
   */
  constructor(source: string, target: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    super(`desktop: could not copy ${source} to ${target}: ${detail}`, { cause })
    this.name = 'DesktopProductDataMigrationError'
    this.source = source
    this.target = target
  }
}

const MIGRATING_SUFFIX = '.migrating'

function missingDirectory(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false
  return error.code === 'ENOENT' || error.code === 'ENOTDIR'
}

function readDirectory(path: string): string[] | undefined {
  try {
    return readdirSync(path)
  } catch (error) {
    if (missingDirectory(error)) return undefined
    throw error
  }
}

function discardStaging(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true })
  } catch (cleanupError) {
    // The copy error is reported to the caller. The next launch removes this staging directory.
    if (!(cleanupError instanceof Error)) throw cleanupError
  }
}

/**
 * Copy one directory onto a path that does not yet exist.
 * A link is copied as a link. Failure removes the staging directory and leaves `target` unchanged.
 * @param source - Existing file or directory.
 * @param target - Path that must not exist when the copy finishes.
 * @throws {DesktopProductDataMigrationError} when the copy or rename fails.
 */
function copyTree(source: string, target: string): void {
  const staging = `${target}${MIGRATING_SUFFIX}`
  try {
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(dirname(target), { recursive: true })
    cpSync(source, staging, { recursive: true, verbatimSymlinks: true })
    renameSync(staging, target)
  } catch (error) {
    discardStaging(staging)
    if (error instanceof DesktopProductDataMigrationError) throw error
    throw new DesktopProductDataMigrationError(source, target, error)
  }
}

/** Whether a product entry can accept a copy from the shared directory. */
function copyDestination(path: string): 'absent' | 'empty-directory' | 'occupied' {
  try {
    if (!lstatSync(path).isDirectory()) return 'occupied'
  } catch (error) {
    if (missingDirectory(error)) return 'absent'
    throw error
  }
  const entries = readDirectory(path)
  return entries !== undefined && entries.length === 0 ? 'empty-directory' : 'occupied'
}

/**
 * Copy top-level entries that the product directory does not already have.
 * A file or a directory that already has entries is kept. An empty directory is replaced.
 * The source directory is not modified or removed.
 * @param source - Shared directory, such as `~/.dsh`.
 * @param target - Product directory selected for this launch.
 * @param exclude - Top-level names that stay behind, such as browser caches.
 * @throws {DesktopProductDataMigrationError} when a copy fails. Completed entries stay; the rest are retried next launch.
 */
export function migrateDesktopProductDirectory(source: string, target: string, exclude: readonly string[] = []): void {
  if (samePath(source, target)) return
  const sourceEntries = readDirectory(source)?.filter(name => !exclude.includes(name))
  if (sourceEntries === undefined || sourceEntries.length === 0) return
  const targetKind = copyDestination(target)
  if (targetKind === 'absent' && exclude.length === 0) {
    copyTree(source, target)
    return
  }
  if (targetKind === 'occupied' && !lstatSync(target).isDirectory()) return
  if (targetKind === 'absent') mkdirSync(target, { recursive: true })
  for (const name of sourceEntries) {
    if (name.endsWith(MIGRATING_SUFFIX)) continue
    const destination = join(target, name)
    const kind = copyDestination(destination)
    if (kind === 'occupied') continue
    if (kind === 'empty-directory') rmSync(destination, { recursive: true, force: true })
    copyTree(join(source, name), destination)
  }
}

/**
 * Copy an earlier desktop data directory into the current product directory.
 * A nested `home` and `agents` follow the current layout. A directory that itself
 * holds harness files is copied into `home`. Shell files such as `desktop/` stay
 * beside `home`. Browser caches are left behind.
 * @param legacy - Previous product directory under appData.
 * @param productRoot - Current `DeepWorker` directory.
 * @param home - Product home for this launch, when the launch selected it.
 * @param agents - Product agents directory for this launch, when the launch selected it.
 */
function adoptPreviousProductDirectory(legacy: string, productRoot: string, home: string | undefined, agents: string | undefined): void {
  if (samePath(legacy, productRoot)) return
  const entries = readDirectory(legacy)
  if (entries === undefined || entries.length === 0) return
  const harnessRoot = !entries.includes(PRODUCT_HOME_DIR)
    && HARNESS_HOME_MARKERS.some(marker => entries.includes(marker))
  if (home !== undefined) {
    if (entries.includes(PRODUCT_HOME_DIR)) migrateDesktopProductDirectory(join(legacy, PRODUCT_HOME_DIR), home)
    else if (harnessRoot) {
      migrateDesktopProductDirectory(legacy, home, [...USER_DATA_CACHE_DIRS, PRODUCT_HOME_DIR, PRODUCT_AGENTS_DIR, 'desktop'])
    }
  }
  if (agents !== undefined && entries.includes(PRODUCT_AGENTS_DIR)) {
    migrateDesktopProductDirectory(join(legacy, PRODUCT_AGENTS_DIR), agents)
  }
  const keptInHome = harnessRoot ? [...HARNESS_HOME_MARKERS, 'plugin-settings.json'] : []
  migrateDesktopProductDirectory(legacy, productRoot, [
    ...USER_DATA_CACHE_DIRS, PRODUCT_HOME_DIR, PRODUCT_AGENTS_DIR, ...keptInHome,
  ])
}

/**
 * Copy missing shared-home entries into the product directories this launch selected.
 * A custom `DSH_HOME` or `DSH_AGENTS_HOME` is left untouched. Call this before
 * {@link pinDesktopProductDataRoots} so Host boot reads the copied files.
 * @param appData - Electron appData directory.
 * @param env - Environment whose `DSH_HOME` and `DSH_AGENTS_HOME` are read.
 * @param shared - Directories that previously held desktop data. Defaults to `~/.dsh` and `~/.agents`.
 * @param legacyNames - Extra previous data-directory names, such as the display name Electron used before the stable id.
 * @throws {DesktopProductDataMigrationError} when a copy fails.
 */
export function adoptDesktopProductData(
  appData: string,
  env: Record<string, string | undefined>,
  shared: DesktopSharedDataDirectories = { home: defaultDshHome(), agents: defaultAgentsHome() },
  legacyNames: readonly string[] = [],
): void {
  const roots = resolveDesktopProductDataRoots(appData, env)
  const productRoot = join(appData, DESKTOP_PRODUCT_DATA_DIR)
  const home = samePath(roots.home, join(productRoot, PRODUCT_HOME_DIR)) ? roots.home : undefined
  const agents = samePath(roots.agents, join(productRoot, PRODUCT_AGENTS_DIR)) ? roots.agents : undefined
  if (home !== undefined) migrateDesktopProductDirectory(shared.home, home)
  if (agents !== undefined) migrateDesktopProductDirectory(shared.agents, agents)
  const names = new Set<string>([...PREVIOUS_DESKTOP_DATA_DIRS, ...legacyNames])
  for (const name of names) {
    const trimmed = name.trim()
    if (trimmed === '' || trimmed === DESKTOP_PRODUCT_DATA_DIR || trimmed.includes('/') || trimmed.includes('\\')) continue
    adoptPreviousProductDirectory(join(appData, trimmed), productRoot, home, agents)
  }
}
