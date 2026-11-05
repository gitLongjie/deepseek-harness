/**
 * Desktop profile boot. Reuses the web profile composition (dsh-base +
 * dsh-web-app), stacks the desktop overlay patch, and boots the Loader tree
 * in-process inside the Electron main process — the same foundation
 * apps/cli/src/profile-boot.ts uses, with Electron taking over process
 * lifetime and closed packaged runtimes resolving bare plugin packages through
 * an installed-host base.
 * @module @deepseek-ai/dsh-desktop/boot
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { FiberState, type Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import {
  boot,
  composeEntries,
  createRuntimeResolution,
  installFailLoud,
  loadOptionalPatches,
  loadOverlayPatches,
  loadProfile,
  PluginPackages,
  PROFILE_PATCH_FILENAME,
  type Profile,
  type ProfileContext,
} from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { DSH_LAUNCH_ENVIRONMENT_KEY, type LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { createAppReady, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { createProcessShutdown, type ProcessShutdown } from './process-shutdown.ts'

const NAME = 'desktop'

/** Absolute path of this desktop app's package.json, from dist/main in both the source and packaged layouts. */
const INSTALL_ANCHOR = fileURLToPath(new URL('../../package.json', import.meta.url))

/** The desktop overlay patch, beside this app (source and built layouts share the apps/desktop directory). */
const DESKTOP_PATCH = fileURLToPath(new URL('../../cordis.patch.yml', import.meta.url))

/** Declarative expert roster beside this app's config in source and packaged layouts. */
const SHIPPED_PRESETS = new URL('../../config/agent-presets/cordis.yml', import.meta.url).href

/** Root config filename inside a profile directory. */
const PROFILE_ROOT_FILENAME = 'cordis.yml'

/** The empty root entry list every profile tree patches over. */
const PROFILE_ROOT_CONFIG = `# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# overlay. Edit cordis.patch.yml, not this file.
[]
`

/** The session-telemetry row id the DSH_TELEMETRY_DISABLED switch targets. */
const TELEMETRY_ROW_ID = 'session-telemetry-otel'

/**
 * Whether this boot runs in an open checkout and must therefore ensure the
 * repository-root plugin links. The branded dev executable reports
 * `app.isPackaged` like the installed build and receives a
 * `bareModuleBaseUrl`, but its checkout is a real filesystem tree whose
 * third-party plugin packages are resolvable only through the links
 * {@link ensureRootPluginLinks} writes. Only a closed archive skips the work:
 * links cannot reach inside app.asar, and that runtime resolves bare plugins
 * through the archive base instead. Segment comparison so an
 * `app.asar.unpacked` twin does not read as the archive.
 * @param bareModuleBaseUrl - the bare-module base URL this boot was given, if any.
 * @returns true when the boot must ensure the root plugin links.
 */
export function healsSharedModuleFallback(bareModuleBaseUrl: string | undefined): boolean {
  return bareModuleBaseUrl === undefined
    || bareModuleBaseUrl.split(/[\\/]/).every(segment => segment !== 'app.asar')
}

/** Directory overrides for {@link ensureRootPluginLinks}, so tests never touch the real tree. */
export interface RootPluginLinkDirs {
  /** The shared `$DSH_HOME/profiles/node_modules/@deepseek-ai` fallback directory. */
  profilesAi?: string
  /** The repository-root `node_modules/@deepseek-ai` directory the links are written into. */
  rootAi?: string
  /** The installation anchor whose plugin closure the direct links follow. */
  installAnchor?: string
  /** The active profile's farm `node_modules` carrying third-party plugin packages. */
  profilesModules?: string
  /** The repository-root `node_modules` the third-party links land in. */
  rootModules?: string
}

/**
 * Physical directories of the third-party plugin packages a profile farm
 * carries, keyed by package name (`@xmanrui/dsh-im`). A package qualifies when
 * its manifest declares a `dsh.bundle`; libraries in the same farm stay out.
 * @param modulesDir - the profile's farm `node_modules` directory.
 * @returns package name to its physical directory.
 */
function profilePluginPackages(modulesDir: string): Map<string, string> {
  const dirs = new Map<string, string>()
  if (!existsSync(modulesDir)) return dirs
  const qualify = (packageDir: string, name: string): void => {
    let manifest: { dsh?: { bundle?: unknown } }
    try {
      manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as typeof manifest
    } catch {
      // An unreadable manifest is not a plugin package.
      return
    }
    if (manifest.dsh?.bundle === undefined) return
    try {
      dirs.set(name, realpathSync.native(packageDir))
    } catch {
      dirs.set(name, packageDir)
    }
  }
  for (const entry of readdirSync(modulesDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === '@deepseek-ai') continue
    if (entry.name.startsWith('@')) {
      const scopeDir = join(modulesDir, entry.name)
      if (!existsSync(scopeDir)) continue
      for (const scoped of readdirSync(scopeDir, { withFileTypes: true })) {
        if (scoped.name.startsWith('.')) continue
        qualify(join(scopeDir, scoped.name), `${entry.name}/${scoped.name}`)
      }
      continue
    }
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    qualify(join(modulesDir, entry.name), entry.name)
  }
  return dirs
}

/** Counters {@link ensureLink} reports through. */
interface LinkCounts {
  created: number
  updated: number
}

/** Point `link` at `target`, replacing an existing link whose target differs; a non-link entry stays. */
function ensureLink(link: string, target: string, counts: LinkCounts): void {
  let current: string | undefined
  try {
    current = readlinkSync(link)
  } catch {
    // Missing link — nothing to compare or replace.
  }
  if (current !== undefined && sameLinkTarget(link, current, target)) return
  if (current !== undefined) {
    try {
      unlinkSync(link)
    } catch {
      // A non-link entry (pnpm-owned or foreign) is not ours to replace.
      return
    }
  }
  try {
    symlinkSync(target, link, 'junction')
    if (current === undefined) counts.created += 1
    else counts.updated += 1
  } catch {
    // A racing link or permission denial is not fatal; a later launch retries.
  }
}

/**
 * Physical directories of this checkout's `@deepseek-ai` packages, keyed by
 * the unscoped directory name (`dsh-subagent`).
 * @param repoRoot - repository root that contains `packages/` and `vendor/`.
 * @returns unscoped package name to its physical directory.
 */
function workspaceScopePackages(repoRoot: string): Map<string, string> {
  const scope = '@deepseek-ai/'
  const dirs = new Map<string, string>()
  const add = (dir: string): void => {
    const manifestPath = join(dir, 'package.json')
    if (!existsSync(manifestPath)) return
    let name = ''
    try {
      name = (JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string }).name ?? ''
    } catch {
      // An unreadable manifest is not a link target.
      return
    }
    if (!name.startsWith(scope)) return
    const unscoped = name.slice(scope.length)
    if (unscoped.length === 0 || unscoped.includes('/')) return
    try {
      dirs.set(unscoped, realpathSync.native(dir))
    } catch {
      dirs.set(unscoped, dir)
    }
  }
  for (const group of ['packages', 'vendor']) {
    const groupDir = join(repoRoot, group)
    if (!existsSync(groupDir)) continue
    for (const outer of readdirSync(groupDir, { withFileTypes: true })) {
      if (!outer.isDirectory() || outer.name === 'node_modules') continue
      const outerDir = join(groupDir, outer.name)
      if (existsSync(join(outerDir, 'package.json'))) {
        add(outerDir)
        continue
      }
      for (const inner of readdirSync(outerDir, { withFileTypes: true })) {
        if (!inner.isDirectory() || inner.name === 'node_modules') continue
        add(join(outerDir, inner.name))
      }
    }
  }
  return dirs
}

/** Whether an existing link already names the same directory as `target`. */
function sameLinkTarget(link: string, current: string, target: string): boolean {
  if (current === target) return true
  const currentPath = isAbsolute(current) ? current : join(dirname(link), current)
  try {
    return realpathSync.native(currentPath) === realpathSync.native(target)
  } catch {
    return false
  }
}

/**
 * Link the loader-visible plugin packages into the repository root node_modules.
 * The branded dev executable resolves bare imports from `apps/desktop`, which
 * walks up to this directory. Each `@deepseek-ai` package in the checkout is
 * linked at its own directory. A name that exists only in the shared profiles
 * farm stays mirrored there for profile-scope plugins, and every third-party
 * plugin package the web profile farm carries (`dsh.bundle` manifest) is
 * linked at its own node_modules location — scoped names included — because
 * the dev exe's bare import walk cannot reach the farm. A link whose target
 * differs is rewritten. Junctions avoid Windows symlink privileges.
 * Best-effort: a closed `app.asar` runtime does not call this.
 * @param dirs - directory overrides for tests.
 */
export function ensureRootPluginLinks(dirs: RootPluginLinkDirs = {}): void {
  try {
    const profilesAi = dirs.profilesAi ?? join(resolveDshHome(), 'profiles', 'node_modules', '@deepseek-ai')
    // dist/main → repository root is four hops (main → dist → desktop → apps → root).
    const rootAi = dirs.rootAi ?? fileURLToPath(new URL('../../../../node_modules/@deepseek-ai', import.meta.url))
    const installAnchor = dirs.installAnchor ?? INSTALL_ANCHOR
    // The desktop boots the web profile, so its farm is where third-party
    // plugin packages live; the branded dev exe cannot resolve them otherwise.
    const profilesModules = dirs.profilesModules ?? join(resolveDshHome(), 'profiles', 'web', 'node_modules')
    const rootModules = dirs.rootModules ?? dirname(rootAi)
    mkdirSync(rootAi, { recursive: true })
    const counts: LinkCounts = { created: 0, updated: 0 }
    const targets = workspaceScopePackages(join(dirname(installAnchor), '..', '..'))
    if (existsSync(profilesAi)) {
      for (const entry of readdirSync(profilesAi, { withFileTypes: true })) {
        if (targets.has(entry.name)) continue
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
        targets.set(entry.name, join(profilesAi, entry.name))
      }
    }
    for (const [name, target] of targets) ensureLink(join(rootAi, name), target, counts)
    for (const [name, target] of profilePluginPackages(profilesModules)) {
      const link = join(rootModules, name)
      mkdirSync(dirname(link), { recursive: true })
      ensureLink(link, target, counts)
    }
    console.error(`desktop: root plugin links ensured (${String(counts.created)} created, ${String(counts.updated)} updated)`)
  } catch (error) {
    console.error(`desktop: root plugin links failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** The home-level user patch layer (`$DSH_HOME/cordis.patch.yml`), applied over every profile's own layer. */
function homePatchPath(): string {
  return join(resolveDshHome(), PROFILE_PATCH_FILENAME)
}

/**
 * Resolve an optional bundle's cordis patch from the installation anchor.
 * Returns the patch entries when the package resolves, declares a
 * `dsh.bundle.patch`, and no existing patch layer already configures a plugin
 * id the bundle would insert — the injected rows are defaults, and an explicit
 * profile or home patch row (including a `disabled: true` row left by a
 * previous deployment) always wins. `undefined` otherwise: the package not
 * being installed is the optional case this probe exists for, and injecting
 * over an existing id would fail the loader with a duplicate id. A package
 * that resolves but fails to parse fails boot loudly like every other patch
 * layer.
 * @param installAnchor - absolute path of the app's package.json.
 * @param packageName - the bundle's package name to probe.
 * @param existingPatches - the bundle, profile, and home patch lists already composed for this boot.
 * @returns the patch entries, or `undefined` when the injection must not run.
 */
export function resolveOptionalBundlePatch(
  installAnchor: string,
  packageName: string,
  existingPatches: ReadonlyArray<PatchOptions>,
): PatchOptions[] | undefined {
  let packageJsonPath: string
  try {
    packageJsonPath = createRequire(installAnchor).resolve(`${packageName}/package.json`)
  } catch {
    // Not installed — the optional case this probe exists for; the boot
    // proceeds without the bundle.
    return undefined
  }
  const packageDir = dirname(packageJsonPath)
  const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { dsh?: { bundle?: { patch?: string } } }
  const declared = manifest.dsh?.bundle?.patch
  if (declared === undefined) return undefined
  const patches = loadOverlayPatches(NAME, join(packageDir, declared))
  const introduced = new Set(patches.flatMap(patch => patch.insert?.map(row => row.id) ?? []))
  const alreadyConfigured = existingPatches.some(patch =>
    (patch.id !== undefined && introduced.has(patch.id))
    || (patch.insert?.some(row => introduced.has(row.id)) ?? false))
  if (alreadyConfigured) return undefined
  return patches
}

/**
 * Resolve the telemetry opt-out switch into its boot patch. ANY non-empty
 * value (including `'0'`/`'false'`) disables. A composition without the row
 * exports nothing, so the switch is then trivially satisfied and no patch is
 * generated.
 * @param disabledEnv - the raw `DSH_TELEMETRY_DISABLED` value (`undefined` when unset).
 * @param hasRow - whether the composition carries the telemetry row.
 * @returns the disable patch, or `undefined` when no hard-disable patch is required.
 */
export function resolveTelemetryPatch(disabledEnv: string | undefined, hasRow: boolean): PatchOptions | undefined {
  if ((disabledEnv ?? '') === '' || !hasRow) return undefined
  return { id: TELEMETRY_ROW_ID, disabled: true }
}

/** The product analytics rows the web-app bundle inserts for the desktop surface. */
const PRODUCT_ANALYTICS_ROW_IDS = ['desktop-product-telemetry', 'product-analytics'] as const

/**
 * Resolve the development switch into patches muting product analytics. A
 * development session's activity is not product data, and the branded dev
 * executable is the only place `DSH_DESKTOP_DEV` is set; installed builds keep
 * the composition's own desktop rows.
 * @param devEnv - the raw `DSH_DESKTOP_DEV` value (`undefined` when unset).
 * @returns one disable patch per analytics row, empty outside development.
 */
export function resolveDevAnalyticsPatches(devEnv: string | undefined): PatchOptions[] {
  if (devEnv !== '1') return []
  return PRODUCT_ANALYTICS_ROW_IDS.map(id => ({ id, disabled: true }))
}

/**
 * Resolve the market anchor handoff into its boot patch. The packaged shell's
 * app package sits at the asar root, off every Node search path, so
 * market-local's own probe cannot resolve the installation anchor it
 * reconciles profile bundles against.
 * @param hasRow - whether the composition mounts the `market-local` row.
 * @param installAnchor - this boot's installation anchor (package.json path).
 * @returns the config patch, or `undefined` when the composition has no row.
 */
export function resolveMarketAnchorPatch(hasRow: boolean, installAnchor: string): PatchOptions | undefined {
  if (!hasRow) return undefined
  return { id: 'market-local', config: { installAnchor } }
}

/**
 * Launcher facts for the in-process desktop Host. The tree loads the web
 * profile bundles from the web profile directory, but `name` is `desktop` so
 * composition rows keyed on the desktop surface activate and profile-backed
 * services (`configEditor`, `settings`) mount.
 * @param profile - the loaded web profile tree this boot composes.
 * @param overlays - boot-time patches applied above bundle and user layers.
 * @returns the context every profile-scoped service reads through `ctx.profileContext`.
 */
export function createDesktopProfileContext(
  profile: Profile,
  overlays: readonly PatchOptions[],
): ProfileContext {
  return {
    name: 'desktop',
    dir: profile.dir,
    patchPath: profile.patchPath,
    installAnchor: INSTALL_ANCHOR,
    startedBundles: profile.layers.map(layer => layer.packageName),
    cwd: process.cwd(),
    home: resolveDshHome(),
    overlays,
    telemetryDisabledEnv: process.env.DSH_TELEMETRY_DISABLED,
  }
}

/** Options for {@link runDesktopBoot}. */
export interface DesktopBootOptions {
  /** This run's frozen environment snapshot, provided before any entry mounts. */
  environment: LaunchEnvironmentSnapshot
  /** Inner arguments handed to the tree through `ctx.cmdlineArgs`. */
  args: readonly string[]
  /** Installed-host base for bare plugin packages in a closed packaged runtime. */
  bareModuleBaseUrl?: string
  /** Exit wiring replaceable by Electron (app.exit) or tests. */
  forceExit?: (code: number) => void
  /** Completion wiring replaceable by Electron (app.exit) or tests. */
  complete?: (code: number) => void
}

/** Result of a settled desktop boot. */
export interface DesktopBootResult {
  /** The settled root context. */
  ctx: Context
  /** The exit controller wired to the tree's disposal. */
  shutdown: ProcessShutdown
}

/**
 * Boot the web profile under the desktop overlay and leave process lifetime
 * to Electron. Fails loud through installFailLoud; a boot rejection propagates
 * to the caller after the partial tree is disposed.
 * @param options - environment, inner args, and optional exit/bare-resolution wiring.
 * @returns the settled root context and the shutdown controller.
 */
export async function runDesktopBoot(options: DesktopBootOptions): Promise<DesktopBootResult> {
  if (healsSharedModuleFallback(options.bareModuleBaseUrl)) ensureRootPluginLinks()
  const profile = loadProfile(NAME, 'web', INSTALL_ANCHOR)
  // Preset subtrees and nested Includes resolve bare plugin names from the
  // profile directory, where only the (unmaintained) shared farm walk stands
  // between a composition and an unresolvable package. The runtime resolution
  // supplies installation- and profile-scope packages to Node's resolvers the
  // same way the CLI does; see the plugin(PluginPackages) mount below.
  const resolution = await createRuntimeResolution({ installAnchor: INSTALL_ANCHOR, profile })
  // The root is always rewritten: the whole composition is patch layers, and
  // the vendored Loader's tree write-back can bake composed rows into this file.
  writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG)

  const homePatches = loadOptionalPatches(NAME, homePatchPath()) ?? []
  const bundlePatches = profile.layers.flatMap(layer => layer.patches)
  const rows = new Map<string, EntryOptions>()
  for (const row of composeEntries([bundlePatches, profile.patches, homePatches])) {
    if (typeof row.id === 'string') rows.set(row.id, row)
  }
  const overlays: PatchOptions[] = [...loadOverlayPatches(NAME, DESKTOP_PATCH)]
  overlays.push({ insert: [{
    id: 'desktop-experts',
    name: '@deepseek-ai/cordis-plugin-include',
    config: { path: SHIPPED_PRESETS },
  }] })
  overlays.push(...resolveDevAnalyticsPatches(process.env.DSH_DESKTOP_DEV))
  // A patch's config replaces the row's config wholesale, so the market anchor
  // rides on the row's own composed config.
  const marketAnchorPatch = resolveMarketAnchorPatch(rows.has('market-local'), INSTALL_ANCHOR)
  if (marketAnchorPatch !== undefined) {
    overlays.push({
      ...marketAnchorPatch,
      config: {
        ...(rows.get('market-local')?.config ?? {}) as Record<string, unknown>,
        ...marketAnchorPatch.config as Record<string, unknown>,
      },
    })
  }
  const telemetryPatch = resolveTelemetryPatch(process.env.DSH_TELEMETRY_DISABLED, rows.has(TELEMETRY_ROW_ID))
  if (telemetryPatch !== undefined) overlays.push(telemetryPatch)

  // The business-entry sidebar plugin ships inside app.asar but is not part of
  // the web profile template's bundles list. If its package is resolvable from
  // the installation anchor, inject its cordis patch so the Loader mounts it
  // without requiring the user to edit the profile manifest — unless a patch
  // layer composed above already configures the same plugin id (a machine that
  // deployed the plugin before this injection shipped, or disabled it in the
  // home patch); then the existing configuration wins.
  const businessEntryPatch = resolveOptionalBundlePatch(
    INSTALL_ANCHOR,
    '@xmanrui/dsh-business-entry',
    [...bundlePatches, ...profile.patches, ...homePatches],
  )
  if (businessEntryPatch !== undefined) overlays.push(...businessEntryPatch)

  const app: { current?: Context } = {}
  const shutdown = createProcessShutdown(
    async () => { await app.current?.fiber.dispose() },
    options.forceExit,
    options.complete,
  )
  installFailLoud(NAME, process, async () => { await app.current?.fiber.dispose() })

  const rootConfig = join(profile.dir, PROFILE_ROOT_FILENAME)
  const allPatches = [...bundlePatches, ...profile.patches, ...homePatches, ...overlays]
  const profileContext = createDesktopProfileContext(profile, overlays)
  const appReady = createAppReady()
  const ctx = await boot(NAME, rootConfig, structuredClone(allPatches), async (hostCtx) => {
    app.current = hostCtx
    hostCtx.provide('profileContext', profileContext)
    hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, options.environment)
    // Before any config-tree entry mounts, so every plugin import routes
    // through the computed resolution rather than the shared farm walk.
    await hostCtx.plugin(PluginPackages, { resolution })
    provideCmdline(hostCtx, {
      args: options.args,
      exit: code => void shutdown.shutdown(code),
      // Profile-scoped entries (the `hmr` row) hold startup work until the
      // launcher commits this signal.
      ready: appReady.service,
      // The desktop boots the web profile; profile-scoped services (the
      // plugin market) resolve the profile they manage from this fact.
      profile: 'web',
    })
  }, options.bareModuleBaseUrl)
  app.current = ctx

  // Config-only HMR for the live profile/home patch layers, mirroring the CLI
  // surface: the composition's own `hmr` row reloads profile patch files once
  // readiness commits; mount a watch-only instance with no module roots when
  // the composition left none.
  if (ctx.fiber.state === FiberState.ACTIVE && ctx.get('loader') !== undefined) {
    appReady.commit()
    // FIXME(host-patches): user-patch hot reload (the upstream-removed
    // watchUserPatches) is disabled; committed patch edits now apply on the
    // next launch. The hmr/timer plugins stay available for entry-level HMR.
    if (ctx.get('hmr') === undefined) {
      if (ctx.get('timer') === undefined) {
        await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-timer' })
      }
      await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-hmr', config: { root: [] } })
    }
  }
  return { ctx, shutdown }
}
