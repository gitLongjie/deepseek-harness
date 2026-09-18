/**
 * Production client composition without the page: mount the Loader over a
 * module system, create every manifest row, wait for quiescence, and audit
 * activation. `AppWebEntry` and the whole-client test carrier both call it.
 * Every stage, entry-state transition, and stall snapshot goes through the
 * `[boot]` logger so a wedged boot on a machine without devtools leaves its
 * stuck rows in the desktop log.
 * @module @deepseek-ai/dsh-client-web/src/boot-client
 */
import type { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { BootManifest, ClientModuleLoader } from '@deepseek-ai/dsh-client-modules/client'
import { bootLog, bootWarn } from './boot-log.ts'
import { FIBER_STATE, STATE_LABELS } from './loader-status.ts'

/**
 * Stillness budget (in macrotask passes) for the settle loop: a pass that
 * changes no pending or loading entry is one unit of stillness, and any
 * state change resets it. See {@link settlePendingEntries}.
 */
const PENDING_SETTLE_STABLE_PASSES = 128

/** Wall-clock interval between boot stall snapshots. */
export const BOOT_WATCHDOG_INTERVAL_MS = 10_000

/** Entry state label as the boot page renders it. */
export type EntryStateLabel = (typeof STATE_LABELS)[keyof typeof STATE_LABELS] | 'loading' | 'failed'

/** Inputs of {@link bootClient}. */
export interface ClientBootOptions {
  /** Fresh root Context that will own the plugin tree. */
  readonly ctx: Context
  /** Module system installed as `loader.internal`. */
  readonly modules: ClientModuleLoader
  /** Parsed manifest whose `plugins` rows become Loader entries (entry name = row id). */
  readonly manifest: BootManifest
  /** Per-entry state reporting (the boot page); omitted when no one renders progress. */
  readonly onEntryState?: (name: string, state: EntryStateLabel) => void
}

/** A running boot watchdog. */
export interface BootWatchdog {
  /** Cancel future snapshots (idempotent). */
  stop(): void
}

/**
 * Compose the client: `ctx.plugin(Loader)`, `loader.internal = modules`, one
 * `loader.create({ name })` per manifest row, `loader.await()`, then
 * {@link settlePendingEntries}. A row whose module cannot be imported is marked
 * failed; the Loader logs its import error and the audit rejects startup.
 * A stall watchdog snapshots non-active entries every
 * {@link BOOT_WATCHDOG_INTERVAL_MS} so an import that never settles names
 * itself in the log instead of hanging silently.
 * @param options - context, module system, manifest, optional progress sink.
 * @returns resolves after every entry is active; rejects with the audit report otherwise.
 */
export async function bootClient(options: ClientBootOptions): Promise<void> {
  const { ctx, manifest, onEntryState } = options
  const watchdog = startBootWatchdog(() => inactiveEntryLines(ctx))
  try {
    bootLog(`plugin activation: ${manifest.plugins.length} rows`)
    await ctx.plugin(Loader)
    const loader = ctx.loader
    loader.internal = options.modules as never

    const report = (name: string, state: EntryStateLabel): void => {
      bootLog(`entry ${name} -> ${state}`)
      onEntryState?.(name, state)
    }
    ctx.on('internal/status', (fiber) => {
      const entry = fiber.entry
      if (entry === undefined || entry.fiber === undefined) return
      report(entry.options.name, STATE_LABELS[entry.fiber.state])
    })

    const rows = manifest.plugins.map(row => row.id)
    await Promise.all(rows.map(async (name) => {
      report(name, 'loading')
      const id = await loader.create({ name })
      if (loader.resolve(id).fiber === undefined) report(name, 'failed')
    }))

    await loader.await()
    bootLog('loader settled')
    await settlePendingEntries(ctx)
    assertEntriesActive(ctx)
    bootLog(`plugin activation finished: ${rows.length} rows active`)
  } finally {
    watchdog.stop()
  }
}

/**
 * Wait out in-flight activation before the audit judges an entry pending. A
 * fiber that waits on a service reactivates only once the providing fiber has
 * settled, and a chain of waiting rows settles one level per tick, so the state
 * `loader.await()` resolves on can still read as `pending` for a dependency that
 * is already there. Drains until no entry is pending or loading, or until the
 * pending set stays identical for {@link PENDING_SETTLE_STABLE_PASSES} passes —
 * stillness that no activation will ever disturb, because the waiters depend on
 * services nothing provides.
 * @param ctx - root Context carrying the Loader.
 */
async function settlePendingEntries(ctx: Context): Promise<void> {
  let previous: string | undefined
  let stable = 0
  for (;;) {
    const pending = [...ctx.loader.entries()].filter((entry) => {
      const fiber = entry.fiber
      return fiber !== undefined && (fiber.state === FIBER_STATE.PENDING || fiber.state === FIBER_STATE.LOADING)
    })
    if (pending.length === 0) return
    const signature = pending.map(entry => `${entry.options.name}:${entry.fiber?.state}`).join('\n')
    if (signature === previous) {
      stable += 1
    } else {
      bootLog(`settle pass: ${pending.length} entries settling (${signature.split('\n').join(', ')})`)
      stable = 0
      previous = signature
    }
    if (stable >= PENDING_SETTLE_STABLE_PASSES) {
      bootWarn(
        `settle gave up: ${pending.length} entries unchanged for ${PENDING_SETTLE_STABLE_PASSES} passes; `
        + `the activation audit will reject them:\n  ${inactiveEntryLines(ctx).join('\n  ')}`,
      )
      return
    }
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

/**
 * One diagnostic line per non-active loader entry, worded for the boot
 * failure report and the stall watchdog alike: an entry without a fiber
 * failed to import, a pending entry names the services it waits on, and any
 * other non-active state is reported verbatim.
 * @param ctx - root Context carrying the Loader.
 * @returns the lines in loader entry order; empty when every entry is active.
 */
export function inactiveEntryLines(ctx: Context): string[] {
  const lines: string[] = []
  for (const entry of ctx.loader.entries()) {
    const name = entry.options.name
    if (entry.fiber === undefined) {
      lines.push(`${name}: import failed (see console for the import error)`)
      continue
    }
    const state = STATE_LABELS[entry.fiber.state]
    if (state === 'active') continue
    if (state === 'pending') {
      const missing = Object.keys(entry.fiber.inject).filter(service => ctx.get(service) === undefined)
      lines.push(`${name}: pending (waiting for service${missing.length === 1 ? '' : 's'}: ${missing.join(', ') || 'unknown'})`)
    } else {
      lines.push(`${name}: ${state}`)
    }
  }
  return lines
}

/**
 * Warn-snapshot a boot that has not finished: every
 * {@link BOOT_WATCHDOG_INTERVAL_MS} while the watchdog runs, report the
 * non-active entry lines so a wedged boot names its stuck rows in a log that
 * survives the window. Empty snapshots stay silent — with every entry active,
 * a stall belongs to a later stage, which the stage logs identify.
 * @param snapshot - returns the current non-active entry lines.
 * @returns the watchdog; `stop()` it when boot settles either way.
 */
export function startBootWatchdog(snapshot: () => readonly string[]): BootWatchdog {
  const timer = setInterval(() => {
    const lines = snapshot()
    if (lines.length === 0) return
    bootWarn(`boot still running; ${lines.length} entries not active:\n  ${lines.join('\n  ')}`)
  }, BOOT_WATCHDOG_INTERVAL_MS)
  return {
    stop: () => { clearInterval(timer) },
  }
}

/**
 * Reject entries that failed import/apply or still wait on missing services.
 * @param ctx - root Context carrying the Loader.
 * @throws {Error} listing every non-active entry with its reason.
 */
export function assertEntriesActive(ctx: Context): void {
  const failures = inactiveEntryLines(ctx)
  if (failures.length > 0) {
    throw new Error(`web boot: ${failures.length} entr${failures.length === 1 ? 'y' : 'ies'} did not activate\n${failures.join('\n')}`)
  }
}
