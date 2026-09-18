import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import type { CommandRuntime } from '@deepseek-ai/dsh-commands'
import type { ClockTime } from '@deepseek-ai/dsh-schedule-work/types'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import ScheduleWorkGateway from '../src/index.ts'

/** The session controller stub satisfies the gateway's dispatch seam. */
function sessionStub(): {
  controller: SessionController
  create: ReturnType<typeof vi.fn>
  prompt: ReturnType<typeof vi.fn>
} {
  let next = 0
  const create = vi.fn(async () => {
    next += 1
    return { sessionId: SessionId(`session-${next}`) }
  })
  const prompt = vi.fn(async () => ({ accepted: true as const }))
  const controller = {
    create,
    prompt,
    resolveAgent: vi.fn(async () => ({ agent: { whenIdle: async () => {} } })),
  } as unknown as SessionController
  return { controller, create, prompt }
}

/** The command runtime stub records the full-access switch. */
function commandStub(): { runtime: CommandRuntime; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn(async () => ({ id: 'command-1' }))
  return { runtime: { execute } as unknown as CommandRuntime, execute }
}

/** Boot the real gateway plugin over the in-memory storage domain and stubbed peers. */
async function harness() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.provide('storageDomain', facility)
  const session = sessionStub()
  ctx.provide('sessionController', session.controller)
  const command = commandStub()
  ctx.provide('commands', command.runtime)
  await ctx.plugin(ScheduleWorkGateway)
  return { gateway: ctx.scheduleWorkGateway, session, command }
}

describe('ScheduleWorkGateway binding', () => {
  it('binds the scheduleWork wire namespace under its own service key', async () => {
    const { gateway } = await harness()
    expect(gateway.typertRemote.serviceKey).toBe('scheduleWorkGateway')
    expect(gateway.typertRemote.namespace).toBe('scheduleWork')
  })
})

describe('ScheduleWorkGateway projection', () => {
  it('creates a task and projects the list view', async () => {
    const { gateway } = await harness()
    const created = await gateway.create({
      name: ' 每日资讯 ',
      prompt: '总结昨日重点资讯',
      rule: { kind: 'daily', time: '09:00' as ClockTime },
    })
    expect(created.name).toBe('每日资讯')
    expect(created.enabled).toBe(true)
    expect(created.nextRunAt).not.toBeNull()
    const { tasks } = await gateway.list()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.id).toBe(created.id)
  })

  it('maps validation refusals onto the invalid-task Remote failure', async () => {
    const { gateway } = await harness()
    await expect(gateway.create({ name: ' ', prompt: 'x', rule: { kind: 'daily', time: '09:00' as ClockTime } }))
      .rejects.toMatchObject({ code: 'schedule-work/invalid-task', details: { field: 'name' } })
  })

  it('maps an unknown update id onto the task-not-found Remote failure', async () => {
    const { gateway } = await harness()
    await expect(gateway.update({ id: 'schedule-work-task-none', patch: { enabled: false } }))
      .rejects.toMatchObject({ code: 'schedule-work/task-not-found' })
  })

  it('removes tasks in batch and reports the removed count', async () => {
    const { gateway } = await harness()
    const first = await gateway.create({ name: 'a', prompt: 'p', rule: { kind: 'daily', time: '09:00' as ClockTime } })
    const second = await gateway.create({ name: 'b', prompt: 'p', rule: { kind: 'daily', time: '09:00' as ClockTime } })
    const { removed } = await gateway.removeTasks({ ids: [first.id, second.id, 'schedule-work-task-none'] })
    expect(removed).toBe(2)
    expect((await gateway.list()).tasks).toHaveLength(0)
  })

  it('filters run records by task', async () => {
    const { gateway } = await harness()
    const created = await gateway.create({ name: 'a', prompt: 'p', rule: { kind: 'daily', time: '09:00' as ClockTime } })
    const { runs } = await gateway.listRuns({ taskId: created.id })
    expect(runs).toEqual([])
    expect((await gateway.listRuns({})).runs).toEqual([])
  })
})
