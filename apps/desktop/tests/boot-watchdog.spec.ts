/** Unit tests for the desktop startup watchdog. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BOOT_RELAUNCH_ARG,
  HOST_BOOT_AUTO_RELAUNCHES,
  bootEntrySignature,
  classifyInstallLocation,
  clearBootState,
  createHostBootWatchdog,
  formatBootEntries,
  hostBootWatchdogEnabled,
  inheritedStuckBoots,
  inspectBootEntries,
  readBootState,
  stuckBootAction,
  writeBootState,
  type BootEntrySource,
  type BootEntryState,
  type BootEntryView,
  type BootState,
} from '../src/main/desktop/boot-watchdog.ts'

/** Fiber states as Cordis numbers them: loading, active, unloading. */
const LOADING = 1
const ACTIVE = 2
const UNLOADING = 5

const entry = (id: string, view: Partial<BootEntryView> = {}): BootEntryView => ({
  id, options: { name: `@deepseek-ai/dsh-${id}` }, ...view,
})

const tree = (...entries: BootEntryView[]): BootEntrySource => ({ entries: () => entries })

const IMPORTING: BootEntryState = { id: 'agent-loop', module: '@deepseek-ai/dsh-agent-loop', status: 'importing' }

afterEach(() => { vi.useRealTimers() })

describe('inspectBootEntries', () => {
  it('reads no entries before the tree exists', () => {
    expect(inspectBootEntries(undefined)).toEqual([])
  })

  it('names the import and lifecycle work of every unsettled entry', () => {
    const pending = Promise.resolve()
    expect(inspectBootEntries(tree(
      entry('agent-loop', { _initTask: pending }),
      entry('session', { fiber: { inertia: pending, state: LOADING } }),
      entry('old-row', { fiber: { inertia: pending, state: UNLOADING } }),
      entry('tools'),
      entry('webserver', { fiber: { inertia: undefined, state: ACTIVE } }),
    ))).toEqual([
      { id: 'agent-loop', module: '@deepseek-ai/dsh-agent-loop', status: 'importing' },
      { id: 'session', module: '@deepseek-ai/dsh-session', status: 'starting' },
      { id: 'old-row', module: '@deepseek-ai/dsh-old-row', status: 'stopping' },
    ])
  })
})

describe('boot entry log lines', () => {
  it('formats the unsettled entries and their comparison key', () => {
    const starting: BootEntryState = { id: 'session', module: '@deepseek-ai/dsh-session', status: 'starting' }
    expect(formatBootEntries([])).toBe('none')
    expect(formatBootEntries([IMPORTING, starting])).toBe(
      'importing agent-loop (@deepseek-ai/dsh-agent-loop), starting session (@deepseek-ai/dsh-session)',
    )
    expect(bootEntrySignature([IMPORTING, starting])).toBe('importing agent-loop\nstarting session')
    expect(bootEntrySignature([starting])).not.toBe(bootEntrySignature([{ ...starting, status: 'stopping' }]))
  })
})

describe('boot state record', () => {
  let dir: string
  let path: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-boot-state-'))
    path = join(dir, 'boot-state.json')
  })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('carries the stuck-launch count to the next launch until cleared', () => {
    expect(readBootState(path)).toBeUndefined()
    writeBootState(path, { startedAt: '2026-11-25T11:30:56.806Z', stuckBoots: 2 })
    expect(readBootState(path)).toEqual({ startedAt: '2026-11-25T11:30:56.806Z', stuckBoots: 2 })
    clearBootState(path)
    expect(readBootState(path)).toBeUndefined()
    clearBootState(path)
  })

  it('reads a malformed or incomplete record as a fresh launch', () => {
    for (const text of ['{', 'null', '"stuck"', '{"startedAt":"2026-11-25"}', '{"startedAt":"x","stuckBoots":-1}', '{"startedAt":"x","stuckBoots":1.5}']) {
      writeFileSync(path, text)
      expect(readBootState(path)).toBeUndefined()
    }
  })

  it('leaves the budget unchanged when the record cannot be stored', () => {
    const missing = join(dir, 'missing', 'boot-state.json')
    writeBootState(missing, { startedAt: 'x', stuckBoots: 1 })
    expect(readBootState(missing)).toBeUndefined()
  })
})

describe('stuck startup decisions', () => {
  it('relaunches within the automatic budget and asks after it', () => {
    expect(stuckBootAction(1)).toBe('relaunch')
    expect(stuckBootAction(HOST_BOOT_AUTO_RELAUNCHES)).toBe('relaunch')
    expect(stuckBootAction(HOST_BOOT_AUTO_RELAUNCHES + 1)).toBe('ask')
  })

  it('continues a stuck sequence only for the relaunches of the watchdog itself', () => {
    const previous: BootState = { startedAt: '2026-11-25T11:30:56.806Z', stuckBoots: 3 }
    expect(inheritedStuckBoots([ '/Applications/DeepWorker.app/Contents/MacOS/DeepWorker' ], previous)).toBe(0)
    expect(inheritedStuckBoots([ 'DeepWorker', BOOT_RELAUNCH_ARG ], previous)).toBe(3)
    expect(inheritedStuckBoots([ 'DeepWorker', BOOT_RELAUNCH_ARG ], undefined)).toBe(0)
  })

  it('watches installed launches only', () => {
    expect(hostBootWatchdogEnabled({}, true)).toBe(true)
    expect(hostBootWatchdogEnabled({}, false)).toBe(false)
    expect(hostBootWatchdogEnabled({ DSH_DESKTOP_DEV: '1' }, true)).toBe(false)
    expect(hostBootWatchdogEnabled({ DSH_PACKAGED_SMOKE: '1' }, true)).toBe(false)
  })

  it('names a disk image or translocated launch location', () => {
    expect(classifyInstallLocation('/Applications/DeepWorker.app/Contents/MacOS/DeepWorker')).toBe('standard')
    expect(classifyInstallLocation('/Volumes/DeepWorker 1.2.18-arm64/DeepWorker.app/Contents/MacOS/DeepWorker')).toBe('disk-image')
    expect(classifyInstallLocation('/private/var/folders/ab/AppTranslocation/123/DeepWorker.app/Contents/MacOS/DeepWorker')).toBe('translocated')
    expect(classifyInstallLocation('C:\\Users\\jiege\\AppData\\Local\\Programs\\DeepWorker\\DeepWorker.exe')).toBe('standard')
  })
})

describe('createHostBootWatchdog', () => {
  const setup = (inspect: () => readonly BootEntryState[]) => {
    vi.useFakeTimers()
    const lines: string[] = []
    const stuck = vi.fn()
    const watchdog = createHostBootWatchdog({ log: line => lines.push(line), inspect, onStuck: stuck })
    return { watchdog, lines, stuck }
  }

  it('logs the unsettled entries at every check and declares a startup stuck once they stop changing', () => {
    const { watchdog, lines, stuck } = setup(() => [IMPORTING])
    vi.advanceTimersByTime(10_000)
    vi.advanceTimersByTime(10_000)
    expect(stuck).not.toHaveBeenCalled()
    vi.advanceTimersByTime(10_000)
    expect(lines).toEqual([
      'desktop: host boot still running after 10000ms (stage profile); unsettled: importing agent-loop (@deepseek-ai/dsh-agent-loop)',
      'desktop: host boot still running after 20000ms (stage profile); unsettled: importing agent-loop (@deepseek-ai/dsh-agent-loop)',
      'desktop: host boot stuck after 30000ms (stage profile); unsettled: importing agent-loop (@deepseek-ai/dsh-agent-loop)',
    ])
    expect(stuck).toHaveBeenCalledTimes(1)
    expect(stuck).toHaveBeenCalledWith({
      elapsedMs: 30_000,
      stage: 'profile',
      entries: [IMPORTING],
    })
    vi.advanceTimersByTime(60_000)
    expect(lines).toHaveLength(3)
    expect(watchdog.settle()).toBe(false)
  })

  it('follows the startup stage and keeps watching while entries keep settling', () => {
    const settled = [IMPORTING, { ...IMPORTING, id: 'session', module: '@deepseek-ai/dsh-session' }]
    const { watchdog, lines, stuck } = setup(() => settled.splice(0, 1))
    watchdog.stage('tree')
    vi.advanceTimersByTime(30_000)
    expect(stuck).not.toHaveBeenCalled()
    expect(lines[1]).toBe('desktop: host boot still running after 20000ms (stage tree); unsettled: importing session (@deepseek-ai/dsh-session)')
    vi.advanceTimersByTime(20_000)
    expect(stuck).toHaveBeenCalledTimes(1)
    expect(stuck).toHaveBeenCalledWith({ elapsedMs: 40_000, stage: 'tree', entries: [] })
    watchdog.stage('window')
    expect(watchdog.settle()).toBe(false)
  })

  it('does not count a check that could not read the entries as a stall', () => {
    let readable = false
    const { lines, stuck } = setup(() => {
      if (!readable) throw new Error('loader disposed')
      return []
    })
    vi.advanceTimersByTime(30_000)
    expect(stuck).not.toHaveBeenCalled()
    expect(lines.filter(line => line.includes('inspection failed: loader disposed'))).toHaveLength(3)
    readable = true
    vi.advanceTimersByTime(10_000)
    expect(stuck).not.toHaveBeenCalled()
    vi.advanceTimersByTime(10_000)
    expect(stuck).toHaveBeenCalledTimes(1)
  })

  it('stops at settle', () => {
    const { watchdog, lines, stuck } = setup(() => [IMPORTING])
    expect(watchdog.settle()).toBe(true)
    expect(watchdog.settle()).toBe(false)
    vi.advanceTimersByTime(120_000)
    expect(lines).toEqual([])
    expect(stuck).not.toHaveBeenCalled()
  })
})
