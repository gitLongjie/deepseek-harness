/**
 * Startup watchdog for the desktop shell. The shell creates its window only
 * after the host tree settles, so one entry that never finishes importing or
 * activating keeps the process up with a menu bar and no window. The watchdog
 * names the startup stage in the log, reports the entries still unsettled while
 * a startup runs long, and declares the startup stuck once those entries stop
 * changing.
 * @module @deepseek-ai/dsh-desktop/desktop/boot-watchdog
 */

import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { FiberState } from '@deepseek-ai/cordis'
import type { DesktopBootStage } from '../boot.ts'

// Cordis declares FiberState as a const enum, which has no runtime object to read.
const FIBER_UNLOADING = 5 as FiberState.UNLOADING

/** Time between two checks of a running startup. */
export const HOST_BOOT_TICK_MS = 10_000

/**
 * Running time a startup may take. From then on it is declared stuck at the
 * first check that finds the same unsettled entries as the previous check, so a
 * slow startup whose entries keep settling is left alone.
 */
export const HOST_BOOT_STALL_MS = 30_000

/** Consecutive stuck launches that relaunch the app without asking. */
export const HOST_BOOT_AUTO_RELAUNCHES = 2

/** File name of the launch record under userData. */
export const BOOT_STATE_FILENAME = 'boot-state.json'

/** Argument the watchdog adds when it relaunches the app, which marks the next launch as part of the same sequence. */
export const BOOT_RELAUNCH_ARG = '--boot-relaunch'

/** Shell stages that follow the host boot. */
export type ShellBootStage = 'office' | 'window'

/** A startup stage the watchdog names in its log lines. */
export type BootStage = DesktopBootStage | ShellBootStage

/** Work a Loader entry still had in flight when a startup was inspected. */
export type BootEntryStatus = 'importing' | 'starting' | 'stopping'

/** One Loader entry that had not settled when a startup was inspected. */
export interface BootEntryState {
  /** Loader entry id, qualified by its nested tree. */
  id: string
  /** Plugin module the entry imports. */
  module: string
  /** Work still in flight. */
  status: BootEntryStatus
}

/** The Loader entry fields {@link inspectBootEntries} reads. */
export interface BootEntryView {
  /** Loader entry id. */
  id: string
  /** Entry options; `name` is the plugin module. */
  options: { name?: unknown }
  /** Import and start task of an entry that has not started its fiber yet. */
  _initTask?: Promise<void> | undefined
  /** Fiber of a started entry. */
  fiber?: { inertia: Promise<void> | undefined; state: FiberState } | undefined
}

/** A Loader tree that enumerates its entries. */
export interface BootEntrySource {
  /** Iterate every entry of the tree and its nested trees. */
  entries(): Iterable<BootEntryView>
}

/** The record one launch leaves for the next. */
export interface BootState {
  /** ISO time the launch started. */
  startedAt: string
  /** Consecutive launches before this one that the watchdog declared stuck. */
  stuckBoots: number
}

/** How the shell answers a startup the watchdog declared stuck. */
export type StuckBootAction = 'relaunch' | 'ask'

/** What the watchdog observed when it declared a startup stuck. */
export interface StuckBootReport {
  /** Running time of the startup. */
  elapsedMs: number
  /** Stage the startup was in. */
  stage: BootStage
  /** Entries unsettled at the declaring check. */
  entries: readonly BootEntryState[]
}

/** Dependencies of the watchdog, injectable so tests drive time. */
export interface HostBootWatchdogOptions {
  /** Startup line sink.
   * @param line - Line without timestamp. */
  log(line: string): void
  /** Loader entries of the running startup that have not settled. */
  inspect(): readonly BootEntryState[]
  /** Runs once, after watching stops, for a startup declared stuck.
   * @param report - The declaring observation. */
  onStuck(report: StuckBootReport): void
  /** Time between checks; defaults to {@link HOST_BOOT_TICK_MS}. */
  tickMs?: number
  /** Running time after which unchanged entries declare the startup stuck; defaults to {@link HOST_BOOT_STALL_MS}. */
  stallMs?: number
  /** Clock reading in milliseconds; defaults to `Date.now`. */
  now?: () => number
}

/** The running watchdog. */
export interface HostBootWatchdog {
  /** Record the stage the startup entered.
   * @param stage - Stage that began. */
  stage(stage: BootStage): void
  /**
   * Stop watching: the window is up, or the startup failed.
   * @returns True when the watchdog was still watching; false once it had already stopped for a stuck report or an earlier call.
   */
  settle(): boolean
}

/**
 * List the Loader entries whose import or lifecycle work has not settled.
 * Entries waiting for a service are absent: the Loader does not wait for them.
 * @param source - Loader tree of the startup in flight; undefined before the tree exists.
 * @returns The unsettled entries, in tree order.
 */
export function inspectBootEntries(source: BootEntrySource | undefined): BootEntryState[] {
  if (source === undefined) return []
  const states: BootEntryState[] = []
  for (const entry of source.entries()) {
    const fiber = entry.fiber
    const status: BootEntryStatus | undefined = entry._initTask !== undefined
      ? 'importing'
      : fiber?.inertia === undefined ? undefined : fiber.state === FIBER_UNLOADING ? 'stopping' : 'starting'
    if (status === undefined) continue
    states.push({ id: entry.id, module: String(entry.options.name), status })
  }
  return states
}

/**
 * Render inspected entries for one log line.
 * @param entries - Unsettled entries.
 * @returns `none`, or each entry as its status, id, and module.
 */
export function formatBootEntries(entries: readonly BootEntryState[]): string {
  return entries.length === 0
    ? 'none'
    : entries.map(entry => `${entry.status} ${entry.id} (${entry.module})`).join(', ')
}

/**
 * The comparison key of inspected entries: equal keys mean no entry changed its status.
 * @param entries - Unsettled entries.
 * @returns One `status id` pair per entry.
 */
export function bootEntrySignature(entries: readonly BootEntryState[]): string {
  return entries.map(entry => `${entry.status} ${entry.id}`).join('\n')
}

/**
 * Read the record the previous launch left.
 * @param path - Record file path.
 * @returns The record, or undefined when it is absent, unreadable, or malformed; such a launch counts as a fresh one.
 */
export function readBootState(path: string): BootState | undefined {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (_unreadable) {
    // Absent or unreadable: nothing limits this launch.
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (_malformed) {
    // A damaged record counts as a fresh launch.
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const { startedAt, stuckBoots } = parsed as Partial<BootState>
  if (typeof startedAt !== 'string' || typeof stuckBoots !== 'number' || !Number.isSafeInteger(stuckBoots) || stuckBoots < 0) {
    return undefined
  }
  return { startedAt, stuckBoots }
}

/**
 * Write the record for the next launch. A record that cannot be written leaves
 * the next launch the default relaunch budget.
 * @param path - Record file path.
 * @param state - The record.
 */
export function writeBootState(path: string, state: BootState): void {
  try {
    writeFileSync(path, `${JSON.stringify(state)}\n`)
  } catch (_unwritable) {
    // Only the relaunch budget is lost; startup proceeds.
  }
}

/**
 * Remove the record, so the next launch counts as a fresh one.
 * @param path - Record file path.
 */
export function clearBootState(path: string): void {
  try {
    rmSync(path, { force: true })
  } catch (_unremovable) {
    // A record left behind only narrows the next launch's relaunch budget.
  }
}

/**
 * Count the stuck launches a startup inherits. Only the watchdog's own
 * relaunches continue a stuck sequence; a launch the user starts begins with
 * the full budget.
 * @param argv - `process.argv`.
 * @param previous - The record the previous launch left, if any.
 * @returns The consecutive stuck launches before this one.
 */
export function inheritedStuckBoots(argv: readonly string[], previous: BootState | undefined): number {
  return argv.includes(BOOT_RELAUNCH_ARG) ? previous?.stuckBoots ?? 0 : 0
}

/**
 * Decide the response to a stuck startup. The stall does not repeat on every
 * launch, so the first ones relaunch the app by themselves; the next asks.
 * @param stuckBoots - Consecutive stuck launches, including this one.
 * @returns `relaunch` within the automatic budget, `ask` once it is spent.
 */
export function stuckBootAction(stuckBoots: number): StuckBootAction {
  return stuckBoots <= HOST_BOOT_AUTO_RELAUNCHES ? 'relaunch' : 'ask'
}

/**
 * Whether this launch runs the watchdog. The development executable boots from
 * source at an unpredictable speed, and the packaging smoke must exit by itself.
 * @param environment - The process environment.
 * @param packaged - `app.isPackaged`.
 * @returns True for an installed launch outside the packaging smoke.
 */
export function hostBootWatchdogEnabled(environment: NodeJS.ProcessEnv, packaged: boolean): boolean {
  return packaged && environment.DSH_DESKTOP_DEV !== '1' && environment.DSH_PACKAGED_SMOKE !== '1'
}

/** Where the running executable was launched from. */
export type InstallLocation = 'standard' | 'disk-image' | 'translocated'

/**
 * Classify the launch location of the executable. A disk image or an App
 * Translocation mount serves every module read through a user-space file system,
 * which is why the launch log names the location.
 * @param execPath - `process.execPath`.
 * @returns The location class.
 */
export function classifyInstallLocation(execPath: string): InstallLocation {
  if (execPath.includes('/AppTranslocation/')) return 'translocated'
  if (execPath.startsWith('/Volumes/')) return 'disk-image'
  return 'standard'
}

/**
 * Watch one startup. Every check logs the entries still unsettled; once the
 * startup has run past the stall time, a check that finds them unchanged since
 * the previous check stops the watchdog and reports the startup stuck.
 * @param options - Log sink, entry inspection, stuck handler, and timing.
 * @returns The stage recorder of the running startup.
 */
export function createHostBootWatchdog(options: HostBootWatchdogOptions): HostBootWatchdog {
  const tickMs = options.tickMs ?? HOST_BOOT_TICK_MS
  const stallMs = options.stallMs ?? HOST_BOOT_STALL_MS
  const now = options.now ?? Date.now
  const startedAt = now()
  let stage: BootStage = 'profile'
  let settled = false
  let previous: string | undefined
  const settle = (): boolean => {
    if (settled) return false
    settled = true
    clearInterval(timer)
    return true
  }
  const timer = setInterval((): void => {
    const elapsedMs = now() - startedAt
    let entries: readonly BootEntryState[]
    try {
      entries = options.inspect()
    } catch (error) {
      // An entry set that cannot be read shows no progress, so this check must not count as a stall.
      options.log(`desktop: host boot inspection failed: ${error instanceof Error ? error.message : String(error)}`)
      previous = undefined
      return
    }
    const signature = bootEntrySignature(entries)
    const unsettled = formatBootEntries(entries)
    if (elapsedMs >= stallMs && previous === signature) {
      settle()
      options.log(`desktop: host boot stuck after ${String(elapsedMs)}ms (stage ${stage}); unsettled: ${unsettled}`)
      options.onStuck({ elapsedMs, stage, entries })
      return
    }
    options.log(`desktop: host boot still running after ${String(elapsedMs)}ms (stage ${stage}); unsettled: ${unsettled}`)
    previous = signature
  }, tickMs)
  timer.unref()
  return {
    stage(next) {
      if (!settled) stage = next
    },
    settle,
  }
}
