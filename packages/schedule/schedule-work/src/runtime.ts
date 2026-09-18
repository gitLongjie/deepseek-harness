/**
 * Schedule-work runtime: the durable task store plus the dispatch loop that
 * turns due rules into Sessions. One runtime owns one timer over an opened
 * storage domain; a dispatch creates its Session through the Session
 * Controller (so the Session lands in the workspace UI like any
 * user-created one), optionally switches the permission preset through the
 * `/permission` command, delivers the prompt as the Session's first queued
 * user message, and records the run's completion when the Session returns
 * to idle. Missed occurrences catch up latest-only, matching the session
 * reminder scheduler's policy.
 * @module @deepseek-ai/dsh-schedule-work/src/runtime
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionCreateValue, SessionPromptRequest, SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { computeNextRunAt, latestDueOccurrence, validateTaskInput } from './domain.ts'
import { scheduleWorkDomainSpec } from './spec.ts'
import type {
  ScheduleWorkRunId, ScheduleWorkRunList, ScheduleWorkRunRecord,
  ScheduleWorkTaskId, ScheduleWorkTaskInput, ScheduleWorkTaskList,
  ScheduleWorkTaskRecord, ScheduleWorkTaskView,
} from './types.ts'

/**
 * The `/permission` command line that switches a created Session to the
 * shipped full-access preset (the preset table's `danger-full-access` key).
 */
const FULL_ACCESS_COMMAND = '/permission danger-full-access'

/** Run records kept per task; older records are pruned after a run finishes. */
const KEEP_RUNS_PER_TASK = 50

/** Milliseconds between due-drains. */
const DRAIN_INTERVAL_MS = 30_000

/**
 * The Session Controller face this runtime dispatches through. Structural on
 * purpose: the runtime names only what it calls, and tests stand in a stub.
 */
export interface SessionDispatch {
  /**
   * Create (or adopt) one Session, attached to the named workspace when given.
   * Mirrors `SessionController.create`.
   */
  create: (request: { workspaceId?: WorkspaceId }) => Promise<SessionCreateValue>
  /**
   * Queue the first user message on the freshly created Session.
   * Mirrors `SessionController.prompt`.
   */
  prompt: (request: SessionPromptRequest, signal: AbortSignal) => Promise<{ readonly accepted: true }>
  /**
   * Resolve the live Agent of a just-created Session. The failure side is
   * the structural projection of the controller's `ApiSessionAgentResult`.
   * Mirrors `SessionController.resolveAgent`.
   */
  resolveAgent: (sessionId: SessionId) => Promise<
    { readonly agent: Agent } | { readonly error: { readonly code: string; readonly message: string } }
  >
}

/** The commands face used for the full-access preset switch. Structural for the same reason. */
export interface CommandDispatch {
  /**
   * Run one slash command line in the Session's Agent.
   * Mirrors the command runtime's execute; resolves `undefined` when the
   * line names no known command.
   */
  run: (
    agent: Agent,
    line: string,
    submittedAttachments: readonly never[],
    signal: AbortSignal,
  ) => Promise<object | undefined>
}

/**
 * The opened schedule-work domain; table names resolve through the spec's
 * literal declaration.
 */
export type ScheduleWorkTables = Domain<typeof scheduleWorkDomainSpec>

/**
 * Failure thrown by the task-store operations the gateway forwards. The
 * gateway maps it onto the `schedule-work/invalid-task` and
 * `schedule-work/task-not-found` Remote failures.
 */
export class ScheduleWorkStoreError extends Error {
  /**
   * @param code - `invalid-task` for refused input, `task-not-found` for an
   *   update naming an unknown id.
   * @param message - human diagnostic.
   * @param details - structured payload carried to the caller.
   */
  constructor(
    readonly code: 'invalid-task' | 'task-not-found',
    message: string,
    readonly details: { readonly field?: string; readonly taskId?: string },
  ) {
    super(message)
    this.name = 'ScheduleWorkStoreError'
  }
}

/** Mint one task id. */
function mintTaskId(): ScheduleWorkTaskId {
  return brandString<ScheduleWorkTaskId>('schedule-work-task-'.concat(randomUUID()))
}

/** Mint one run id. */
function mintRunId(): ScheduleWorkRunId {
  return brandString<ScheduleWorkRunId>('schedule-work-run-'.concat(randomUUID()))
}

/**
 * The store plus dispatch loop. Constructed by the gateway's Service init,
 * which owns the lifetime: `dispose()` stops the timer and drains in-flight
 * dispatches; the domain closes through the gateway's effect disposer.
 */
export class ScheduleWorkRuntime {
  private readonly tasks: KvTable<ScheduleWorkTaskId, ScheduleWorkTaskRecord>
  private readonly runs: KvTable<ScheduleWorkRunId, ScheduleWorkRunRecord>
  /** Record removal over the tasks table, bound at construction. */
  private readonly eraseTask: (id: ScheduleWorkTaskId) => Promise<boolean>
  /** Record removal over the runs table, bound at construction. */
  private readonly eraseRun: (runId: ScheduleWorkRunId) => Promise<boolean>
  private readonly dispatching = new Set<ScheduleWorkTaskId>()
  private readonly inFlight = new Set<Promise<void>>()
  private readonly forgetDispatching: (id: ScheduleWorkTaskId) => boolean
  private readonly forgetFlight: (flight: Promise<void>) => boolean
  private timer?: ReturnType<typeof setInterval>
  private disposed = false

  /**
   * @param tables - Opened schedule-work table handles.
   * @param sessions - Session dispatch face.
   * @param commands - Command dispatch face for the permission switch.
   * @param now - Current-instant source; tests pin it for determinism.
   */
  constructor(
    tables: ScheduleWorkTables,
    private readonly sessions: SessionDispatch,
    private readonly commands: CommandDispatch,
    private readonly now: () => Date = () => new Date(),
  ) {
    const tasks = tables.table('tasks')
    const runs = tables.table('runs')
    this.tasks = tasks
    this.runs = runs
    this.eraseTask = tasks.delete.bind(tasks)
    this.eraseRun = runs.delete.bind(runs)
    this.forgetDispatching = this.dispatching.delete.bind(this.dispatching)
    this.forgetFlight = this.inFlight.delete.bind(this.inFlight)
  }

  /** Start the due-drain timer. Call once after construction. */
  start(): void {
    this.timer = setInterval(() => { this.drain() }, DRAIN_INTERVAL_MS)
  }

  /**
   * Stop the timer and wait for in-flight dispatches. Storage writes inside
   * a finishing dispatch land before the caller proceeds; the domain closes
   * after this resolves.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    if (this.timer !== undefined) clearInterval(this.timer)
    await Promise.allSettled([...this.inFlight])
  }

  /**
   * Read every task with its computed next occurrence.
   * @returns tasks newest-first by creation.
   */
  list(): ScheduleWorkTaskList {
    const tasks = [...this.tasks.entries()]
      .map(([, record]) => record)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .map(record => this.viewOf(record))
    return { tasks }
  }

  /**
   * Read run records, newest first.
   * @param taskId - Optional task filter.
   * @returns the run list.
   */
  listRuns(taskId?: ScheduleWorkTaskId): ScheduleWorkRunList {
    const runs = [...this.runs.entries()]
      .map(([, record]) => record)
      .filter(record => taskId === undefined || record.taskId === taskId)
      .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
    return { runs }
  }

  /**
   * Create one task and store it durably.
   * @param input - Caller input, validated here.
   * @returns the stored task view.
   */
  async create(input: ScheduleWorkTaskInput): Promise<ScheduleWorkTaskView> {
    const now = this.now().toISOString()
    const normalized = validateTaskInput(input)
    const record: ScheduleWorkTaskRecord = {
      id: mintTaskId(),
      name: normalized.name,
      prompt: normalized.prompt,
      ...(normalized.workspaceId == null ? {} : { workspaceId: normalized.workspaceId }),
      fullAccess: normalized.fullAccess ?? false,
      rule: normalized.rule,
      ...(normalized.validUntil == null ? {} : { validUntil: normalized.validUntil }),
      enabled: normalized.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    }
    await this.tasks.put(record.id, record)
    return this.viewOf(record)
  }

  /**
   * Edit one task. Absent fields keep their stored values; an explicit
   * `null` clears an optional field; `enabled: false` pauses without
   * touching the rule, and the next occurrence recomputes from the stored
   * `lastRunAt`.
   * @param id - Task identity.
   * @param patch - Fields to replace.
   * @returns the updated task view.
   * @throws ScheduleWorkStoreError `task-not-found` for an unknown id.
   */
  async update(id: ScheduleWorkTaskId, patch: Partial<ScheduleWorkTaskInput>): Promise<ScheduleWorkTaskView> {
    const current = this.tasks.get(id)
    if (current === undefined) {
      throw new ScheduleWorkStoreError('task-not-found', `task '${id}' does not exist`, { taskId: id })
    }
    const merged = validateTaskInput({
      name: patch.name ?? current.name,
      prompt: patch.prompt ?? current.prompt,
      workspaceId: patch.workspaceId === undefined ? current.workspaceId ?? null : patch.workspaceId,
      fullAccess: patch.fullAccess ?? current.fullAccess,
      rule: patch.rule ?? current.rule,
      validUntil: patch.validUntil === undefined ? current.validUntil ?? null : patch.validUntil,
      enabled: patch.enabled ?? current.enabled,
    })
    const next: ScheduleWorkTaskRecord = {
      id: current.id,
      name: merged.name,
      prompt: merged.prompt,
      ...(merged.workspaceId == null ? {} : { workspaceId: merged.workspaceId }),
      fullAccess: merged.fullAccess ?? current.fullAccess,
      rule: merged.rule,
      ...(merged.validUntil == null ? {} : { validUntil: merged.validUntil }),
      enabled: merged.enabled ?? current.enabled,
      createdAt: current.createdAt,
      ...(current.lastRunAt === undefined ? {} : { lastRunAt: current.lastRunAt }),
      updatedAt: this.now().toISOString(),
    }
    await this.tasks.put(id, next)
    return this.viewOf(next)
  }

  /**
   * Remove tasks and their run records from the store.
   * @param ids - Task identities; unknown ids are skipped.
   * @returns the number of tasks actually removed.
   */
  async remove(ids: readonly ScheduleWorkTaskId[]): Promise<number> {
    let removed = 0
    for (const id of ids) {
      if (await this.eraseTask(id)) removed += 1
      for (const [runId, record] of [...this.runs.entries()]) {
        if (record.taskId === id) await this.eraseRun(runId)
      }
    }
    return removed
  }

  /**
   * Dispatch every task with an occurrence due in `(lastRunAt, now]`. The
   * drain itself is synchronous bookkeeping; each dispatch runs detached and
   * is tracked for dispose-time draining.
   * @param at - Current instant; defaults to the runtime clock.
   */
  drain(at?: Date): void {
    if (this.disposed) return
    const now = at ?? this.now()
    for (const record of [...this.tasks.entries()].map(([, value]) => value)) {
      if (!record.enabled || this.dispatching.has(record.id)) continue
      const baseline = new Date(record.lastRunAt ?? record.createdAt)
      const horizon = record.validUntil !== undefined
        && Date.parse(record.validUntil) < now.getTime()
        ? new Date(record.validUntil)
        : now
      const due = latestDueOccurrence(record.rule, baseline, horizon, new Date(record.createdAt))
      if (due === null) continue
      const task = record
      const flight = this.dispatch(task, due).finally(() => {
        this.forgetDispatching(task.id)
        this.forgetFlight(flight)
      })
      this.dispatching.add(task.id)
      this.inFlight.add(flight)
    }
  }

  private viewOf(record: ScheduleWorkTaskRecord): ScheduleWorkTaskView {
    return { ...record, nextRunAt: computeNextRunAt(record, this.now()) }
  }

  /**
   * Run one task once at its due occurrence. Ordering: the run record lands
   * first (status `running`), then `lastRunAt` moves onto the occurrence
   * atomically so a slow create cannot double-fire, then the Session is
   * created, the permission preset is switched when requested, and the
   * prompt is queued; completion waits for the Session to return to idle.
   */
  private async dispatch(task: ScheduleWorkTaskRecord, due: Date): Promise<void> {
    const runId = mintRunId()
    const run: ScheduleWorkRunRecord = {
      id: runId,
      taskId: task.id,
      startedAt: this.now().toISOString(),
      status: 'running',
    }
    let sessionId: SessionId | undefined
    try {
      await this.runs.put(runId, run)
      await this.tasks.update(task.id, current => ({ ...current, lastRunAt: due.toISOString() }))
      const signal = new AbortController().signal
      const created = await this.sessions.create(
        task.workspaceId === undefined ? {} : { workspaceId: task.workspaceId },
      )
      sessionId = created.sessionId
      if (task.fullAccess) await this.switchFullAccess(sessionId, signal)
      await this.sessions.prompt({
        requestId: brandString<SessionRequestId>('session-request-'.concat(randomUUID())),
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: task.prompt }],
      }, signal)
      const resolved = await this.sessions.resolveAgent(sessionId)
      if (!('agent' in resolved)) throw new Error(`agent for session '${sessionId}' is unavailable`)
      await resolved.agent.whenIdle()
      await this.finishRun(runId, { status: 'succeeded', sessionId, finishedAt: this.now().toISOString() })
    } catch (error) {
      await this.finishRun(runId, {
        status: 'failed',
        ...(sessionId === undefined ? {} : { sessionId }),
        finishedAt: this.now().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      await this.pruneRuns(task.id)
    }
  }

  /**
   * Switch the created Session to the full-access preset through the
   * `/permission` command. A missing command (the permission-presets plugin
   * is absent) fails the run: the task explicitly asked for full access and
   * silently running with defaults would hide the difference.
   */
  private async switchFullAccess(sessionId: SessionId, signal: AbortSignal): Promise<void> {
    const resolved = await this.sessions.resolveAgent(sessionId)
    if (!('agent' in resolved)) {
      throw new Error(`cannot switch permission preset: agent for session '${sessionId}' is unavailable`)
    }
    const execution = await this.commands.run(resolved.agent, FULL_ACCESS_COMMAND, [], signal)
    if (execution === undefined) {
      throw new Error('the /permission command is unavailable; cannot apply the full-access preset')
    }
  }

  /**
   * Finalize one run record. A storage failure here (the domain closing
   * during dispose) is swallowed with its cause logged — the run's Session
   * still exists, only the record is lost.
   */
  private async finishRun(
    runId: ScheduleWorkRunId,
    patch: Pick<ScheduleWorkRunRecord, 'status'> & {
      sessionId?: SessionId
      finishedAt?: string
      error?: string
    },
  ): Promise<void> {
    const current = this.runs.get(runId)
    if (current === undefined) return
    try {
      await this.runs.put(runId, {
        ...current,
        status: patch.status,
        ...(patch.sessionId === undefined ? {} : { sessionId: patch.sessionId }),
        ...(patch.finishedAt === undefined ? {} : { finishedAt: patch.finishedAt }),
        ...(patch.error === undefined ? {} : { error: patch.error }),
      })
    } catch (error) {
      // The domain is closing under an in-flight dispatch; the record loss
      // is logged because the run's Session itself is unaffected.
      console.error('schedule-work: run record finalize lost during teardown', error)
    }
  }

  /** Keep only the newest {@link KEEP_RUNS_PER_TASK} runs of one task. */
  private async pruneRuns(taskId: ScheduleWorkTaskId): Promise<void> {
    const mine = [...this.runs.entries()]
      .filter(([, record]) => record.taskId === taskId)
      .sort((left, right) => Date.parse(right[1].startedAt) - Date.parse(left[1].startedAt))
    for (const [runId] of mine.slice(KEEP_RUNS_PER_TASK)) {
      await this.eraseRun(runId)
    }
  }
}

/**
 * Open the schedule-work domain and construct the runtime over it.
 * @param ctx - Host context carrying the storage-domain facility.
 * @param sessions - Session dispatch face.
 * @param commands - Command dispatch face.
 * @param now - Current-instant source; tests pin it for determinism.
 * @returns the runtime plus one teardown that stops the runtime and closes
 *   the domain, in that order.
 */
export async function openScheduleWorkRuntime(
  ctx: Context,
  sessions: SessionDispatch,
  commands: CommandDispatch,
  now: () => Date = () => new Date(),
): Promise<{ runtime: ScheduleWorkRuntime; close: () => Promise<void> }> {
  const domain = await ctx.storageDomain.open(scheduleWorkDomainSpec)
  const runtime = new ScheduleWorkRuntime(domain, sessions, commands, now)
  return {
    runtime,
    close: async () => {
      await runtime.dispose()
      await domain.close()
    },
  }
}
