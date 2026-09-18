import { describe, expect, it, vi, type Mock } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { SessionCreateValue, SessionPromptRequest } from '@deepseek-ai/dsh-api-session-controller/types'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ClockTime } from '@deepseek-ai/dsh-schedule-work/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { openScheduleWorkRuntime, ScheduleWorkStoreError } from '../src/runtime.ts'
import type { CommandDispatch, ScheduleWorkRuntime } from '../src/runtime.ts'
import type { SessionDispatch } from '../src/runtime.ts'
import type { ScheduleWorkTaskId, ScheduleWorkTaskInput } from '../src/types.ts'

const DAILY_TASK = {
  name: '资讯总结',
  prompt: '总结昨日重点资讯',
  rule: { kind: 'daily', time: '09:00' as ClockTime },
} satisfies ScheduleWorkTaskInput

/** Local-time helper keeps expectations independent of the test host's zone. */
const local = (day: number, hours: number, minutes: number): Date => new Date(2026, 8, day, hours, minutes, 0, 0)

/** The pinned clock most harnesses share: 2026-09-19 08:00 local. */
const CLOCK_START = local(19, 8, 0)

/** Deferred hook standing in for one agent turn. */
function idleGate(): { gate: Promise<void>; release: () => void } {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  return { gate, release }
}

interface SessionsStub {
  create: Mock<(request: { workspaceId?: WorkspaceId }) => Promise<SessionCreateValue>>
  prompt: Mock<(request: SessionPromptRequest, signal: AbortSignal) => Promise<{ readonly accepted: true }>>
  resolveAgent: Mock<
    (sessionId: SessionId) => Promise<{ readonly agent: Agent } | { readonly error: { readonly code: string; readonly message: string } }>
  >
}

function sessionsStub(options?: { createFails?: Error; promptFails?: Error; idle?: Promise<void> }): SessionsStub {
  let next = 0
  const stub: SessionsStub = {
    create: vi.fn(async (): Promise<SessionCreateValue> => {
      if (options?.createFails !== undefined) throw options.createFails
      next += 1
      return { sessionId: SessionId(`session-${next}`) }
    }),
    prompt: vi.fn(async (_request: SessionPromptRequest, _signal: AbortSignal): Promise<{ readonly accepted: true }> => {
      if (options?.promptFails !== undefined) throw options.promptFails
      return { accepted: true }
    }),
    resolveAgent: vi.fn(async (_sessionId: SessionId): Promise<{ readonly agent: Agent }> => ({
      agent: { whenIdle: () => options?.idle ?? Promise.resolve() } as unknown as Agent,
    })),
  }
  return stub
}

function commandsStub(options?: { unknownCommand?: boolean }): { stub: CommandDispatch; run: ReturnType<typeof vi.fn> } {
  const run = vi.fn(async () => (options?.unknownCommand === true ? undefined : { id: 'command-1' }))
  return { stub: { run }, run }
}

interface Harness {
  runtime: ScheduleWorkRuntime
  close: () => Promise<void>
}

/** Boot one runtime over the real storage domain on a shared or fresh medium. */
async function harness(
  sessions: SessionDispatch,
  commands: CommandDispatch,
  options?: { now?: Date; pool?: MemoryMediaPool },
): Promise<{ pool: MemoryMediaPool } & Harness> {
  const pool = options?.pool ?? new MemoryMediaPool()
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.provide('storageDomain', facility)
  const now = options?.now ?? CLOCK_START
  const opened = await openScheduleWorkRuntime(ctx, sessions, commands, () => now)
  return {
    pool,
    runtime: opened.runtime,
    close: opened.close,
  }
}

describe('task store', () => {
  it('creates, lists newest-first, and projects the next occurrence', async () => {
    const sessions = sessionsStub()
    const pool = new MemoryMediaPool()
    const earlier = await harness(sessions, commandsStub().stub, { pool, now: local(15, 8, 0) })
    await earlier.runtime.create(DAILY_TASK)
    await earlier.close()

    const later = await harness(sessions, commandsStub().stub, { pool, now: CLOCK_START })
    try {
      const newer = await later.runtime.create({ ...DAILY_TASK, name: ' newer ' })
      expect(newer.name).toBe('newer')
      const { tasks } = later.runtime.list()
      expect(tasks.map(task => task.name)).toEqual(['newer', '资讯总结'])
      // The fresh task awaits its first morning; the earlier one catches up on
      // the latest missed slot (the 18th's 09:00) before anything newer.
      expect(tasks[0]?.nextRunAt).toBe(local(19, 9, 0).toISOString())
      expect(tasks[1]?.nextRunAt).toBe(local(18, 9, 0).toISOString())
    } finally {
      await later.close()
    }
  })

  it('survives a reopen over the same medium', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness(sessionsStub(), commandsStub().stub, { pool })
    await first.runtime.create(DAILY_TASK)
    await first.close()

    const second = await harness(sessionsStub(), commandsStub().stub, { pool })
    try {
      expect(second.runtime.list().tasks).toHaveLength(1)
    } finally {
      await second.close()
    }
  })

  it('patches fields, clears optionals with null, and rejects unknown ids', async () => {
    const { runtime, close } = await harness(sessionsStub(), commandsStub().stub)
    try {
      const created = await runtime.create({
        ...DAILY_TASK,
        workspaceId: 'workspace-1' as WorkspaceId,
        validUntil: local(30, 9, 0).toISOString(),
      })
      const paused = await runtime.update(created.id, { enabled: false })
      expect(paused.enabled).toBe(false)
      expect(paused.nextRunAt).toBeNull()
      const edited = await runtime.update(created.id, {
        rule: { kind: 'weekly', weekdays: [1], time: '08:00' as ClockTime },
        workspaceId: null,
        validUntil: null,
      })
      expect(edited.rule).toEqual({ kind: 'weekly', weekdays: [1], time: '08:00' })
      expect(edited).not.toHaveProperty('workspaceId')
      expect(edited).not.toHaveProperty('validUntil')
      await expect(runtime.update('schedule-work-task-none' as ScheduleWorkTaskId, { enabled: true }))
        .rejects.toThrow(ScheduleWorkStoreError)
    } finally {
      await close()
    }
  })

  it('removes tasks together with their run records', async () => {
    const sessions = sessionsStub()
    const pool = new MemoryMediaPool()
    const first = await harness(sessions, commandsStub().stub, { pool })
    await first.runtime.create(DAILY_TASK)
    first.runtime.drain(local(19, 9, 15))
    await first.close()
    expect(sessions.create).toHaveBeenCalledTimes(1)

    const second = await harness(sessions, commandsStub().stub, { pool })
    try {
      const view = second.runtime.list().tasks[0]
      expect(view).toBeDefined()
      expect(await second.runtime.remove([view!.id])).toBe(1)
      expect(second.runtime.list().tasks).toHaveLength(0)
      expect(second.runtime.listRuns().runs).toHaveLength(0)
      expect(await second.runtime.remove([view!.id])).toBe(0)
    } finally {
      await second.close()
    }
  })
})

describe('dispatch', () => {
  it('creates a session, queues the prompt, and completes the run when the agent idles', async () => {
    const idle = idleGate()
    const sessions = sessionsStub({ idle: idle.gate })
    const commands = commandsStub()
    const { runtime, close } = await harness(sessions, commands.stub)
    try {
      const created = await runtime.create({ ...DAILY_TASK, workspaceId: 'workspace-1' as WorkspaceId })
      runtime.drain(local(19, 9, 15))
      await vi.waitFor(() => { expect(sessions.prompt).toHaveBeenCalled() })
      expect(sessions.create).toHaveBeenCalledWith({ workspaceId: 'workspace-1' })
      expect(sessions.prompt.mock.calls[0]?.[0]).toMatchObject({
        mode: 'queue',
        content: [{ type: 'text', text: '总结昨日重点资讯' }],
      })
      expect(runtime.listRuns().runs[0]?.status).toBe('running')

      idle.release()
      await runtime.dispose()
      const run = runtime.listRuns().runs[0]
      expect(run?.status).toBe('succeeded')
      expect(run?.sessionId).toBeDefined()
      expect(run?.finishedAt).toBeDefined()
      const stored = runtime.list().tasks.find(task => task.id === created.id)
      expect(stored?.lastRunAt).toBe(local(19, 9, 0).toISOString())
      expect(commands.run).not.toHaveBeenCalled()
    } finally {
      await close()
    }
  })

  it('catches up latest-only: one dispatch for a window of missed days', async () => {
    const sessions = sessionsStub()
    const pool = new MemoryMediaPool()
    const first = await harness(sessions, commandsStub().stub, { pool, now: local(15, 8, 0) })
    await first.runtime.create(DAILY_TASK)
    await first.close()

    // Four days pass with the harness down; the reopened runtime catches up
    // on one dispatch at the latest missed slot, not one per day.
    const second = await harness(sessions, commandsStub().stub, { pool, now: local(19, 8, 0) })
    try {
      second.runtime.drain(local(19, 9, 15))
      await second.runtime.dispose()
      expect(sessions.create).toHaveBeenCalledTimes(1)
      const stored = second.runtime.list().tasks[0]
      expect(stored?.lastRunAt).toBe(local(19, 9, 0).toISOString())
      expect(second.runtime.listRuns().runs).toHaveLength(1)
    } finally {
      await second.close()
    }
  })

  it('skips paused tasks', async () => {
    const sessions = sessionsStub()
    const { runtime, close } = await harness(sessions, commandsStub().stub)
    try {
      const created = await runtime.create(DAILY_TASK)
      await runtime.update(created.id, { enabled: false })
      runtime.drain(local(19, 9, 15))
      await runtime.dispose()
      expect(sessions.create).not.toHaveBeenCalled()
      expect(runtime.listRuns().runs).toHaveLength(0)
    } finally {
      await close()
    }
  })

  it('never fires once validity has ended', async () => {
    const sessions = sessionsStub()
    const { runtime, close } = await harness(sessions, commandsStub().stub)
    try {
      await runtime.create({ ...DAILY_TASK, validUntil: local(10, 9, 0).toISOString() })
      runtime.drain(local(19, 9, 15))
      await runtime.dispose()
      expect(sessions.create).not.toHaveBeenCalled()
    } finally {
      await close()
    }
  })

  it('fires a full-access task through the permission command', async () => {
    const sessions = sessionsStub()
    const commands = commandsStub()
    const { runtime, close } = await harness(sessions, commands.stub)
    try {
      await runtime.create({ ...DAILY_TASK, fullAccess: true })
      runtime.drain(local(19, 9, 15))
      await runtime.dispose()
      expect(commands.run).toHaveBeenCalledWith(
        expect.anything(),
        '/permission danger-full-access',
        [],
        expect.anything(),
      )
      expect(runtime.listRuns().runs[0]?.status).toBe('succeeded')
    } finally {
      await close()
    }
  })

  it('fails the run without prompting when the permission command is unknown', async () => {
    const sessions = sessionsStub()
    const commands = commandsStub({ unknownCommand: true })
    const { runtime, close } = await harness(sessions, commands.stub)
    try {
      await runtime.create({ ...DAILY_TASK, fullAccess: true })
      runtime.drain(local(19, 9, 15))
      await runtime.dispose()
      const run = runtime.listRuns().runs[0]
      expect(run?.status).toBe('failed')
      expect(run?.error).toMatch(/\/permission/)
      expect(sessions.prompt).not.toHaveBeenCalled()
      // The failed run still consumed the occurrence.
      expect(runtime.list().tasks[0]?.lastRunAt).toBe(local(19, 9, 0).toISOString())
    } finally {
      await close()
    }
  })

  it('records a failed run with the session attached when the prompt is refused', async () => {
    const sessions = sessionsStub({ promptFails: new Error('agent busy') })
    const { runtime, close } = await harness(sessions, commandsStub().stub)
    try {
      await runtime.create(DAILY_TASK)
      runtime.drain(local(19, 9, 15))
      await runtime.dispose()
      const run = runtime.listRuns().runs[0]
      expect(run?.status).toBe('failed')
      expect(run?.error).toBe('agent busy')
      expect(run?.sessionId).toBeDefined()
    } finally {
      await close()
    }
  })

  it('does not double-dispatch one task while a run is in flight', async () => {
    const idle = idleGate()
    const sessions = sessionsStub({ idle: idle.gate })
    const { runtime, close } = await harness(sessions, commandsStub().stub)
    try {
      await runtime.create({ ...DAILY_TASK, rule: { kind: 'interval', everySeconds: 300 } })
      runtime.drain(local(19, 8, 10))
      runtime.drain(local(19, 8, 15))
      await vi.waitFor(() => { expect(sessions.create).toHaveBeenCalledTimes(1) })
      expect(sessions.create).toHaveBeenCalledTimes(1)
      idle.release()
      await runtime.dispose()
      expect(sessions.create).toHaveBeenCalledTimes(1)
    } finally {
      await close()
    }
  })
})

describe('lifecycle', () => {
  it('stops dispatching after dispose even when the timer would fire', async () => {
    vi.useFakeTimers()
    try {
      const sessions = sessionsStub()
      const { runtime, close } = await harness(sessions, commandsStub().stub)
      await runtime.create({ ...DAILY_TASK, rule: { kind: 'interval', everySeconds: 300 } })
      runtime.start()
      const teardown = runtime.dispose()
      await vi.advanceTimersByTimeAsync(120_000)
      await teardown
      await close()
      expect(sessions.create).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
