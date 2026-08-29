/**
 * Desktop profile boot. Reuses the web profile composition (dsh-base +
 * dsh-web-app), stacks the desktop overlay patch, and boots the Loader tree
 * in-process inside the Electron main process — the same foundation
 * apps/cli/src/profile-boot.ts uses, with Electron taking over process
 * lifetime and closed packaged runtimes resolving bare plugin packages through
 * an installed-host base.
 * @module @deepseek-ai/dsh-desktop/boot
 */

import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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

/**
 * Mirror the healed profile plugin links into the repository root node_modules.
 * In the open (non-packaged) runtime the vendored Loader's plain bare import
 * resolves from vendor/loader, whose lookup walks up to the repository root —
 * not the profile baseUrl — so root node_modules must carry every plugin link,
 * mirroring what the packaged app gets from its own node_modules. Junctions
 * avoid Windows symlink privileges. Best-effort: the packaged runtime needs
 * none of this.
 */
function ensureRootPluginLinks(): void {
  try {
    const profilesAi = join(resolveDshHome(), 'profiles', 'node_modules', '@deepseek-ai')
    // dist/main → repository root is four hops (main → dist → desktop → apps → root).
    const rootAi = fileURLToPath(new URL('../../../../node_modules/@deepseek-ai', import.meta.url))
    mkdirSync(rootAi, { recursive: true })
    let created = 0
    for (const name of readdirSync(profilesAi)) {
      const target = join(rootAi, name)
      if (existsSync(target)) continue
      try {
        symlinkSync(join(profilesAi, name), target, 'junction')
        created += 1
      } catch {
        // A racing link or permission denial is not fatal; a later launch retries.
      }
    }
    console.error(`desktop: root plugin links ensured (${created} created, ${readdirSync(profilesAi).length} profiles)`)
  } catch (error) {
    console.error(`desktop: root plugin links failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** The home-level user patch layer (`$DSH_HOME/cordis.patch.yml`), applied over every profile's own layer. */
function homePatchPath(): string {
  return join(resolveDshHome(), PROFILE_PATCH_FILENAME)
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
    healProfilesModuleFallback({ installAnchor: INSTALL_ANCHOR })
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
  const telemetryPatch = resolveTelemetryPatch(process.env.DSH_TELEMETRY_DISABLED, rows.has(TELEMETRY_ROW_ID))
  if (telemetryPatch !== undefined) overlays.push(telemetryPatch)

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
