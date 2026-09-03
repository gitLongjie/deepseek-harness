/**
 * The packaged desktop's boot self-check. Exercises the resources that
 * missing-file regressions historically break as owned relationships — real
 * loads, spawns, and renders, not file existence alone:
 *
 * - the host tree itself: a settled boot is the plugin-closure check (any
 *   plugin package absent from app.asar fails the boot), plus the three IPC
 *   carrier services the shell serves;
 * - the preset roster: every shipped preset resolves from the packaged
 *   node_modules, the same walk a session's standing mount imports from;
 * - the frontend document: the real index render over the packaged web dist;
 * - the ripgrep platform binary: resolved and spawned;
 * - the workflow worker entry: resolved through the packaged node_modules;
 * - on packaged Windows: the koffi native binding loaded from its unpacked
 *   twin, and the sandbox runner executed in Node mode (a healthy runner
 *   rejects a bare argv with its `windows-acl-run:` stderr signature and exit
 *   127; a second app instance — the historical single-instance-lock failure —
 *   exits 0 with no signature).
 *
 * `scripts/packaged-smoke.mjs` runs this through the real packaged artifact
 * and gates publication on the result.
 * @module @deepseek-ai/dsh-desktop/desktop/packaged-smoke
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveRgPath } from '@deepseek-ai/dsh-tool-fs-search'
import { renderDesktopIndex } from '../ipc/index-html.ts'
import { findMissingPackagedResources } from './packaged-resources.ts'

/** One executed smoke check. */
export interface PackagedSmokeCheck {
  /** Stable check id for gate output. */
  name: string
  /** Whether the check passed. */
  ok: boolean
  /** What the check observed; failure detail on `ok: false`. */
  detail: string
}

/** The smoke verdict consumed by the packaging gate. */
export interface PackagedSmokeResult {
  /** Whether every check passed. */
  ok: boolean
  /** The executed checks, in execution order. */
  checks: PackagedSmokeCheck[]
}

/** Options for {@link runPackagedSmoke}. */
export interface PackagedSmokeOptions {
  /** The app directory (`app.getAppPath()`), archive path when packaged. */
  appRoot: string
  /** The built frontend dist directory served over the app scheme. */
  webDistDir: string
  /** The settled host context. */
  ctx: Context
}

/**
 * Run every smoke check to completion, collecting failures instead of
 * short-circuiting so one gate run reports the full damage.
 * @param options - app root, web dist, and the settled host context.
 * @returns the collected checks with their aggregate verdict.
 */
export async function runPackagedSmoke(options: PackagedSmokeOptions): Promise<PackagedSmokeResult> {
  const { appRoot, webDistDir, ctx } = options
  const checks: PackagedSmokeCheck[] = []

  const missing = findMissingPackagedResources(appRoot)
  checks.push({
    name: 'packaged-resources',
    ok: missing.length === 0,
    detail: missing.length === 0
      ? 'every boot-critical resource present'
      : missing.map(entry => `${entry.label}: ${entry.path}`).join('; '),
  })

  const carriers: ReadonlyArray<readonly [string, unknown]> = [
    ['connection', ctx.get('connection')],
    ['typertGateway', ctx.get('typertGateway')],
    ['clientModules', ctx.get('clientModules')],
  ]
  const absentCarriers = carriers.filter(([, value]) => value === undefined).map(([name]) => name)
  checks.push({
    name: 'host-services',
    ok: absentCarriers.length === 0,
    detail: absentCarriers.length === 0
      ? 'connection, typertGateway, and clientModules settled'
      : `missing services: ${absentCarriers.join(', ')}`,
  })

  try {
    // The preset roster answers from the same on-disk closure a session's
    // standing mount imports from: a packaged layout whose preset rows cannot
    // resolve (the composition base has no node_modules a closed runtime can
    // walk) reports every shipped preset broken here instead of failing the
    // user's first session create.
    const roster = (ctx as { get(name: string): unknown }).get('agentPresets') as
      | { list(): Promise<{ id: string; broken?: string }[]> }
      | undefined
    const presets = await roster?.list() ?? []
    const broken = presets.filter(preset => preset.broken !== undefined)
    checks.push({
      name: 'agent-preset-roster',
      ok: roster !== undefined && broken.length === 0,
      detail: roster === undefined
        ? 'the agentPresets service is not composed'
        : broken.length === 0
          ? `${String(presets.length)} presets resolve from the packaged node_modules`
          : `broken presets: ${broken.map(preset => preset.id).join(', ')}`,
    })
  } catch (error) {
    checks.push({ name: 'agent-preset-roster', ok: false, detail: error instanceof Error ? error.message : String(error) })
  }

  try {
    const html = renderDesktopIndex(ctx, webDistDir)
    checks.push({
      name: 'web-index-render',
      ok: html.length > 0,
      detail: html.length > 0 ? `rendered ${html.length} bytes from the packaged web dist` : 'the index render produced an empty document',
    })
  } catch (error) {
    checks.push({ name: 'web-index-render', ok: false, detail: error instanceof Error ? error.message : String(error) })
  }

  try {
    const rgPath = await resolveRgPath()
    const run = spawnSync(rgPath, ['--version'], { timeout: 30_000, encoding: 'utf8' })
    checks.push({
      name: 'ripgrep-spawn',
      ok: run.status === 0,
      detail: run.status === 0
        ? `spawned ${rgPath}`
        : `rg --version exited ${String(run.status)} (${run.error?.message ?? firstLine(run.stderr)})`,
    })
  } catch (error) {
    checks.push({ name: 'ripgrep-spawn', ok: false, detail: error instanceof Error ? error.message : String(error) })
  }

  try {
    const workerEntry = createRequire(join(appRoot, 'package.json')).resolve('@deepseek-ai/dsh-workflow-worker-thread/worker')
    checks.push({
      name: 'workflow-worker-resolve',
      ok: existsSync(workerEntry),
      detail: existsSync(workerEntry) ? `resolved ${workerEntry}` : 'the ./worker subpath resolved to a missing file',
    })
  } catch (error) {
    checks.push({ name: 'workflow-worker-resolve', ok: false, detail: error instanceof Error ? error.message : String(error) })
  }

  if (process.platform === 'win32' && appRoot.endsWith('app.asar')) {
    // Load koffi the way the runtime does — resolved from the archive's
    // node_modules, with Electron redirecting the .node dlopen to its
    // unpacked twin — not by anchoring inside the unpacked tree.
    try {
      const koffi = createRequire(join(appRoot, 'package.json'))('koffi') as { version?: string }
      checks.push({
        name: 'koffi-load',
        ok: typeof koffi === 'object' && koffi !== null,
        detail: `loaded the native binding (version ${String(koffi?.version)})`,
      })
    } catch (error) {
      checks.push({ name: 'koffi-load', ok: false, detail: error instanceof Error ? error.message : String(error) })
    }

    const runnerEntry = join(`${appRoot}.unpacked`, 'node_modules', '@deepseek-ai', 'dsh-sandbox-windows-acl', 'lib', 'runner.js')
    if (existsSync(runnerEntry)) {
      const run = spawnSync(process.execPath, [runnerEntry], {
        timeout: 30_000,
        encoding: 'utf8',
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      })
      // A healthy runner rejects the bare argv with its documented failure
      // signature; exit 0 without it means the host launched as a second app
      // instance instead (the Node-mode regression this check exists for).
      const healthy = run.status === 127 && run.stderr.includes('windows-acl-run:')
      checks.push({
        name: 'sandbox-runner-node-mode',
        ok: healthy,
        detail: healthy
          ? 'the runner executed as plain Node and reported its bad-argv failure contract'
          : `bare runner run exited ${String(run.status)} (stderr: ${firstLine(run.stderr) || '<none>'})`,
      })
    } else {
      checks.push({ name: 'sandbox-runner-node-mode', ok: false, detail: `missing runner entry ${runnerEntry}` })
    }
  }

  return { ok: checks.every(check => check.ok), checks }
}

/** The first non-empty line of captured process output, for failure details. */
function firstLine(text: string | undefined): string {
  const line = (text ?? '').split(/\r?\n/).find(candidate => candidate.trim() !== '')
  return line?.trim() ?? ''
}
