/**
 * Desktop profile boot. Reuses the web profile composition (dsh-base +
 * dsh-web-app), stacks the desktop overlay patch, and boots the Loader tree
 * in-process inside the Electron main process — the same foundation
 * apps/cli/src/profile-boot.ts uses, with Electron taking over process
 * lifetime and closed packaged runtimes resolving bare plugin packages through
 * an installed-host base.
 * @module @deepseek-ai/dsh-desktop/boot
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { FiberState, type Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import {
  boot,
  composeEntries,
  healProfilesModuleFallback,
  installFailLoud,
  loadOptionalPatches,
  loadOverlayPatches,
  loadProfile,
  PROFILE_PATCH_FILENAME,
  resolveInstallationModuleLinks,
  watchUserPatches,
} from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { DSH_LAUNCH_ENVIRONMENT_KEY, type LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { createProcessShutdown, type ProcessShutdown } from './process-shutdown.ts'

const NAME = 'desktop'

/** Absolute path of this desktop app's package.json, from dist/main in both the source and packaged layouts. */
const INSTALL_ANCHOR = fileURLToPath(new URL('../../package.json', import.meta.url))

/** The desktop overlay patch, beside this app (source and built layouts share the apps/desktop directory). */
const DESKTOP_PATCH = fileURLToPath(new URL('../../cordis.patch.yml', import.meta.url))

/** Shipped agent-preset root: beside this app's own config, in both layouts. */
const SHIPPED_PRESET_ROOT = fileURLToPath(new URL('../../config/agent-presets/', import.meta.url))

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

/** Directory overrides for {@link ensureRootPluginLinks}, so tests never touch the real tree. */
export interface RootPluginLinkDirs {
  /** The shared `$DSH_HOME/profiles/node_modules/@deepseek-ai` fallback directory. */
  profilesAi?: string
  /** The repository-root `node_modules/@deepseek-ai` directory the links are written into. */
  rootAi?: string
  /** The installation anchor whose plugin closure the direct links follow. */
  installAnchor?: string
}

/**
 * Link the loader-visible plugin packages into the repository root node_modules.
 * In the open (non-packaged) runtime the vendored Loader's plain bare import
 * resolves from vendor/loader, whose lookup walks up to the repository root —
 * not the profile baseUrl — so every dsh-owned link points directly at the
 * running installation's resolved package directory and is rewritten when its
 * target differs: the shared fallback directory is rewritten by whichever dsh
 * installation healed last, and a mirror link would follow whatever foreign
 * plugin generation it currently holds. Names outside the installation closure
 * keep that mirror for profile-scope plugins. Junctions avoid Windows symlink
 * privileges. Best-effort: the packaged runtime needs none of this.
 * @param dirs - directory overrides for tests.
 */
export function ensureRootPluginLinks(dirs: RootPluginLinkDirs = {}): void {
  try {
    const profilesAi = dirs.profilesAi ?? join(resolveDshHome(), 'profiles', 'node_modules', '@deepseek-ai')
    // dist/main → repository root is four hops (main → dist → desktop → apps → root).
    const rootAi = dirs.rootAi ?? fileURLToPath(new URL('../../../../node_modules/@deepseek-ai', import.meta.url))
    mkdirSync(rootAi, { recursive: true })
    // rootAi is one package scope directory; only that scope's closure entries
    // belong here, named without the scope prefix. Other closure packages
    // resolve beside their dependents and stay out of this mirror.
    const scope = `${basename(rootAi)}/`
    const targets = new Map<string, string>()
    for (const [packageName, target] of resolveInstallationModuleLinks(dirs.installAnchor ?? INSTALL_ANCHOR)) {
      if (packageName.startsWith(scope)) targets.set(packageName.slice(scope.length), target)
    }
    if (existsSync(profilesAi)) {
      for (const name of readdirSync(profilesAi)) {
        if (!targets.has(name)) targets.set(name, join(profilesAi, name))
      }
    }
    let created = 0
    let updated = 0
    for (const [name, target] of targets) {
      const link = join(rootAi, name)
      let current: string | undefined
      try {
        current = readlinkSync(link)
      } catch {
        // Missing link — nothing to compare or replace.
      }
      if (current === target) continue
      if (current !== undefined) {
        try {
          unlinkSync(link)
        } catch {
          // A non-link entry (pnpm-owned or foreign) is not ours to replace.
          continue
        }
      }
      try {
        symlinkSync(target, link, 'junction')
        if (current === undefined) created += 1
        else updated += 1
      } catch {
        // A racing link or permission denial is not fatal; a later launch retries.
      }
    }
    console.error(`desktop: root plugin links ensured (${created} created, ${updated} updated)`)
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
 * Returns the patch entries when the package resolves and declares a
 * `dsh.bundle.patch`; `undefined` when the package is not installed, which is
 * the optional case this probe exists for. A package that resolves but fails
 * to parse fails boot loudly like every other patch layer.
 * @param installAnchor - absolute path of the app's package.json.
 * @param packageName - the bundle's package name to probe.
 * @returns the patch entries, or `undefined` when the package is not installed.
 */
export function resolveOptionalBundlePatch(installAnchor: string, packageName: string): PatchOptions[] | undefined {
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
  return loadOverlayPatches(NAME, join(packageDir, declared))
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
  // Heal the shared module fallback only in the open runtime: a closed packaged
  // runtime resolves bare plugins through bareModuleBaseUrl instead, because
  // creating $DSH_HOME/profiles/node_modules symlinks inside app.asar is not
  // reliable.
  if (options.bareModuleBaseUrl === undefined) {
    await healProfilesModuleFallback({ installAnchor: INSTALL_ANCHOR })
    ensureRootPluginLinks()
  }
  const profile = loadProfile(NAME, 'web', INSTALL_ANCHOR)
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
  // The SHIPPED root is the part of the roster only this app can resolve; the
  // writable root stays `dsh-agent-presets`' own (`includeUserRoot`).
  if (rows.has('agent-presets')) {
    overlays.push({
      id: 'agent-presets',
      config: {
        ...(rows.get('agent-presets')?.config ?? {}) as Record<string, unknown>,
        roots: [{ path: SHIPPED_PRESET_ROOT, trust: 'system' }],
      },
    })
  }
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
  // without requiring the user to edit the profile manifest.
  const businessEntryPatch = resolveOptionalBundlePatch(INSTALL_ANCHOR, '@xmanrui/dsh-business-entry')
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
  const ctx = await boot(NAME, rootConfig, structuredClone(allPatches), (hostCtx) => {
    app.current = hostCtx
    hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, options.environment)
    provideCmdline(hostCtx, {
      args: options.args,
      exit: code => void shutdown.shutdown(code),
      // The desktop boots the web profile; profile-scoped services (the
      // plugin market) resolve the profile they manage from this fact.
      profile: 'web',
    })
  }, options.bareModuleBaseUrl)
  app.current = ctx

  // Config-only HMR for the live profile/home patch layers, mirroring the CLI
  // surface: the web bundle disables the shared `hmr` row, so mount a
  // watch-only instance with no module roots when the composition left none.
  if (ctx.fiber.state === FiberState.ACTIVE && ctx.get('loader') !== undefined) {
    const composeLive = (): PatchOptions[] => structuredClone([
      ...bundlePatches,
      ...loadOptionalPatches(NAME, profile.patchPath) ?? [],
      ...loadOptionalPatches(NAME, homePatchPath()) ?? [],
      ...overlays,
    ])
    try {
      if (ctx.get('hmr') === undefined) {
        if (ctx.get('timer') === undefined) {
          await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-timer' })
        }
        await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-hmr', config: { root: [] } })
      }
      await watchUserPatches(ctx, {
        binName: NAME,
        filename: profile.patchPath,
        compose: composeLive,
      })
      await watchUserPatches(ctx, {
        binName: NAME,
        filename: homePatchPath(),
        compose: composeLive,
      })
    } catch (error) {
      // The tree already exited as asked, or watching failed; a broken watch
      // must not take the app down with it.
      ctx.logger.warn(`desktop: user-patch watching failed: ${String(error)}`)
    }
  }
  return { ctx, shutdown }
}
