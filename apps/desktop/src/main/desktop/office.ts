/**
 * Mount Desktop Office create tools (and skills when the payload is complete)
 * into the in-process Electron host. The child `dsh-desktop-host` process used
 * the same composition; the current shell boots the profile in-process and must
 * mount it here or `create_pptx` never appears in chat.
 */

import { cpSync, existsSync, mkdirSync, realpathSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { shell } from 'electron'
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import * as officeSkills from '@deepseek-ai/dsh-skill-office'
import * as officeCreate from '@deepseek-ai/dsh-tool-office-create'
import * as workspaceDependencies from '@deepseek-ai/dsh-tool-workspace-dependencies'
import type {} from '@deepseek-ai/dsh-tools'
import { installOfficeEngineResolution, runtimeArchivePath } from './office-engine.ts'

const CREATE_TOOL_NAMES = new Set(['create_pptx', 'create_docx', 'create_xlsx'])

/** Absolute apps/desktop root (works from both `src/main/desktop` and `dist/main/desktop`). */
const DESKTOP_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** Inputs that locate the Offline Office payload for packaged and unpackaged launches. */
export interface DesktopOfficeMountOptions {
  /** Whether the Electron shell is running from an installed package. */
  readonly packaged: boolean
  /** Electron `process.resourcesPath` (packaged layout). */
  readonly resourcesPath: string
  /** Electron `app.getAppPath()` (packaged `app.asar` or the desktop package root). */
  readonly appPath: string
}

/** Resolved payload directories used by the Office composition. */
export interface DesktopOfficePaths {
  /** Primary-runtime payload directory carrying `runtime.json` and `dependencies/`. */
  readonly source: string
  /**
   * Harness-home install directory. Omitted when `source` is already the live
   * install tree and should be used in place.
   */
  readonly root?: string
  /** Prepared or ASAR-contained application dependency directory for LibreOffice Kit. */
  readonly runtimeDir: string
  /** Whether sibling `office-skills` assets are present beside `source`. */
  readonly skillsAvailable: boolean
}

/**
 * Directory of skills shipped with Desktop, including `dashi-ppt`.
 * Installed launches copy `dashi-ppt` into the Harness home on first use so
 * its generator can install npm dependencies. Development uses the prepared
 * runtime directory directly.
 * @param options - Packaged flag and Electron path anchors.
 * @returns The skill root passed to `DSH_BUNDLED_SKILL_DIR`, or `undefined` when `dashi-ppt` is absent.
 */
export function resolveBundledSkillDir(options: DesktopOfficeMountOptions): string | undefined {
  const shipped = bundledSkillRoot(options)
  if (shipped === undefined || !existsSync(join(shipped, 'dashi-ppt', 'SKILL.md'))) return undefined
  if (!usePackagedOfficeLayout(options.packaged)) return shipped
  const live = join(resolveDshHome(), 'bundled-skills')
  if (!existsSync(join(live, 'dashi-ppt', 'SKILL.md'))) {
    mkdirSync(live, { recursive: true })
    cpSync(join(shipped, 'dashi-ppt'), join(live, 'dashi-ppt'), { recursive: true })
  }
  return live
}

/** Runtime directory that holds `bundled-skills/` beside `primary-runtime`. */
function bundledSkillRoot(options: DesktopOfficeMountOptions): string | undefined {
  if (usePackagedOfficeLayout(options.packaged)) {
    const runtime = join(options.resourcesPath, 'runtime')
    if (existsSync(join(runtime, 'primary-runtime'))) return join(runtime, 'bundled-skills')
  }
  const override = process.env.DSH_DESKTOP_PRIMARY_RUNTIME
  if (override !== undefined && override !== '') return join(dirname(override), 'bundled-skills')
  const target = process.platform === 'darwin'
    ? (process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64')
    : 'win-x64'
  const prepared = join(DESKTOP_ROOT, '.desktop-build', 'targets', target, 'runtime', 'primary-runtime')
  if (existsSync(prepared)) return join(dirname(prepared), 'bundled-skills')
  return undefined
}

/**
 * Whether this launch should use the installed `resources/runtime` layout.
 * The branded development executable reports `app.isPackaged` like a product
 * build, but `DSH_DESKTOP_DEV` marks it as a checkout launch whose
 * `process.resourcesPath` is Electron's own dist, not a Desktop payload.
 * @param packaged - Electron `app.isPackaged`.
 * @param developmentEnv - Raw `DSH_DESKTOP_DEV` value.
 * @returns True only for an installed Desktop product launch.
 */
export function usePackagedOfficeLayout(
  packaged: boolean,
  developmentEnv: string | undefined = process.env.DSH_DESKTOP_DEV,
): boolean {
  return packaged && developmentEnv !== '1'
}

/**
 * Resolve the offline Office payload for the current Desktop launch.
 * Installed builds use `resources/runtime`; development prefers the prepared
 * `.desktop-build` payload, then the Harness-home install tree.
 * @param options - Packaged flag and Electron path anchors.
 * @returns Absolute payload directories for create tools and optional skills,
 *   or `undefined` when no payload exists on this machine — the Office engine
 *   is an optional payload, and a build without it stays bootable.
 */
export function resolveDesktopOfficePaths(options: DesktopOfficeMountOptions): DesktopOfficePaths | undefined {
  const installRoot = join(resolveDshHome(), 'dsh-runtimes', 'dsh-primary-runtime')
  if (usePackagedOfficeLayout(options.packaged)) {
    const source = join(options.resourcesPath, 'runtime', 'primary-runtime')
    if (existsSync(source)) {
      return {
        source,
        root: installRoot,
        runtimeDir: join(options.appPath, 'dsh'),
        skillsAvailable: existsSync(join(dirname(source), 'office-skills')),
      }
    }
  }
  const override = process.env.DSH_DESKTOP_PRIMARY_RUNTIME
  if (override !== undefined && override !== '') {
    return {
      source: override,
      root: installRoot,
      runtimeDir: override,
      skillsAvailable: existsSync(join(dirname(override), 'office-skills')),
    }
  }
  const target = process.platform === 'darwin'
    ? (process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64')
    : 'win-x64'
  const prepared = join(DESKTOP_ROOT, '.desktop-build', 'targets', target, 'runtime', 'primary-runtime')
  if (existsSync(prepared)) {
    return {
      source: prepared,
      root: installRoot,
      runtimeDir: join(DESKTOP_ROOT, '.desktop-build', 'targets', target, 'dsh'),
      skillsAvailable: existsSync(join(dirname(prepared), 'office-skills')),
    }
  }
  if (existsSync(installRoot)) {
    return {
      source: installRoot,
      runtimeDir: installRoot,
      skillsAvailable: existsSync(join(dirname(installRoot), 'office-skills')),
    }
  }
  return undefined
}

/**
 * Mount Office create tools and, when assets exist, authoring/operation skills.
 * @param ctx - Settled Desktop host context after profile boot.
 * @param options - Packaged flag and Electron path anchors.
 */
export async function mountDesktopOffice(ctx: Context, options: DesktopOfficeMountOptions): Promise<void> {
  const paths = resolveDesktopOfficePaths(options)
  if (paths === undefined) {
    // The engine ships beside installers produced by the packaging pipeline;
    // a payload-less build stays fully bootable and just offers no Office tools.
    ctx.logger.warn('desktop office: no primary-runtime payload found; Office create tools stay unavailable (prepare one with pnpm --filter @deepseek-ai/dsh-desktop run prepare:primary-runtime)')
    return
  }
  if (!existsSync(paths.source)) {
    throw new Error(`desktop office: primary-runtime source missing at ${paths.source}`)
  }
  installOfficeEngineResolution(paths.runtimeDir)
  const payload = paths.root === undefined
    ? { source: paths.source }
    : { source: paths.source, root: paths.root }
  await ctx.plugin(workspaceDependencies, payload)
  await ctx.plugin(officeCreate, payload)
  // Open created Office files in the OS default app. Diff review cannot show
  // binary PPTX/DOCX/XLSX contents; opening is the useful completion path.
  ctx.on('tools/result', (exec, result) => {
    if (result.isError || !CREATE_TOOL_NAMES.has(exec.name)) return
    const value = result.value
    if (typeof value !== 'object' || value === null || !('path' in value)) return
    const outputPath = value.path
    if (typeof outputPath !== 'string' || outputPath === '') return
    void shell.openPath(outputPath).then((error) => {
      if (error !== '') console.error(`desktop office: failed to open ${outputPath}: ${error}`)
    })
  })
  if (!paths.skillsAvailable) return
  const archive = runtimeArchivePath(paths.runtimeDir) === undefined
    ? undefined
    : dirname(realpathSync(paths.runtimeDir))
  const manifest = fileURLToPath(import.meta.resolve('@deepseek-ai/libreoffice-kit/package.json'))
  const packageRoot = dirname(archive === undefined ? manifest : join(`${archive}.unpacked`, relative(archive, manifest)))
  await ctx.plugin(officeSkills, {
    assetRoot: join(dirname(paths.source), 'office-skills'),
    node: join(paths.source, 'dependencies', 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node'),
    cli: join(packageRoot, 'lib', 'cli.js'),
  })
}
