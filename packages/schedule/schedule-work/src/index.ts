/**
 * Remote gateway for the schedule-work capability: durable app-level
 * scheduled tasks (create, edit, pause, remove, list) plus their run
 * records, projected onto the Typert wire for the desktop client. The
 * gateway owns the runtime lifetime — the storage domain opens in Service
 * init and the dispatch loop runs until the effect disposer stops it.
 * @module @deepseek-ai/dsh-schedule-work
 */

import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import type { CommandRuntime } from '@deepseek-ai/dsh-commands'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { brandString } from '@deepseek-ai/dsh-brand'
import { openScheduleWorkRuntime, ScheduleWorkStoreError } from './runtime.ts'
import type { CommandDispatch, ScheduleWorkRuntime, SessionDispatch } from './runtime.ts'
import { ScheduleWorkValidationError } from './domain.ts'
import type {
  ScheduleWorkRunList,
  ScheduleWorkTaskId, ScheduleWorkTaskInput, ScheduleWorkTaskList, ScheduleWorkTaskView,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The gateway service; the wire namespace stays `scheduleWork`. */
    scheduleWorkGateway: ScheduleWorkGateway
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Create or edit input refused validation; `field` names the offending input field. */
    'schedule-work/invalid-task': { readonly field?: string; readonly taskId?: string }
    /** An update named an unknown task. */
    'schedule-work/task-not-found': { readonly taskId?: string }
  }
}

/**
 * Adapt the session controller's public face to the runtime's dispatch
 * seam; the controller's create, prompt, and resolveAgent signatures
 * already satisfy it structurally.
 */
function sessionFace(sessionController: SessionController): SessionDispatch {
  return sessionController
}

/**
 * Adapt the command runtime to the runtime's command seam. The bound
 * reference keeps the concrete `CommandRuntime` type out of the seam.
 */
function commandFace(commands: CommandRuntime): CommandDispatch {
  return { run: commands.execute.bind(commands) }
}

/**
 * Remote-only schedule-work gateway. The Context key `scheduleWorkGateway`
 * names this service registration; the wire namespace stays `scheduleWork`.
 */
export class ScheduleWorkGateway extends TypertRemoteService {
  static inject = ['storageDomain', 'sessionController', 'commands']

  private runtime?: ScheduleWorkRuntime
  private closeRuntime?: () => Promise<void>

  constructor(ctx: Context) {
    super(ctx, 'scheduleWorkGateway', { namespace: 'scheduleWork' })
  }

  /** Open the domain and start the dispatch loop. */
  protected async [Service.init](): Promise<void> {
    const opened = await openScheduleWorkRuntime(
      this.ctx,
      sessionFace(this.ctx.sessionController),
      commandFace(this.ctx.commands),
    )
    this.runtime = opened.runtime
    this.closeRuntime = opened.close
    this.runtime.start()
    this.ctx.effect(() => () => { void this.closeRuntime?.() }, 'scheduleWorkGateway: runtime teardown')
  }

  /**
   * List every task with its computed next occurrence.
   * @returns tasks newest-first by creation.
   */
  @Remote('list')
  list(): Promise<ScheduleWorkTaskList> {
    return Promise.resolve(this.requireRuntime().list())
  }

  /**
   * List run records, newest first.
   * @param request - Optional task filter.
   * @returns the run records of the requested task, or every task's.
   */
  @Remote('listRuns')
  listRuns(request: { taskId?: string }): Promise<ScheduleWorkRunList> {
    const taskId = request.taskId === undefined ? undefined : brandString<ScheduleWorkTaskId>(request.taskId)
    return Promise.resolve(this.requireRuntime().listRuns(taskId))
  }

  /**
   * Create one task.
   * @param input - Task fields; validated host-side.
   * @returns the stored task view.
   */
  @Remote('create')
  async create(input: ScheduleWorkTaskInput): Promise<ScheduleWorkTaskView> {
    try {
      return await this.requireRuntime().create(input)
    } catch (error) {
      throw this.mapStoreError(error)
    }
  }

  /**
   * Edit one task.
   * @param request - Task identity and the fields to replace.
   * @returns the updated task view.
   */
  @Remote('update')
  async update(request: { id: string; patch: Partial<ScheduleWorkTaskInput> }): Promise<ScheduleWorkTaskView> {
    try {
      return await this.requireRuntime().update(brandString<ScheduleWorkTaskId>(request.id), request.patch)
    } catch (error) {
      throw this.mapStoreError(error)
    }
  }

  /**
   * Remove tasks and their run records. The wire method avoids the reserved
   * `remove` name: it collides with the Remote namespace service's own
   * members and the client API refuses the whole namespace over it.
   * @param request - Task identities; unknown ids are skipped.
   * @returns how many tasks were removed.
   */
  @Remote('removeTasks')
  removeTasks(request: { ids: readonly string[] }): Promise<{ removed: number }> {
    const ids = request.ids.map(id => brandString<ScheduleWorkTaskId>(id))
    return Promise.resolve(this.requireRuntime().remove(ids).then(removed => ({ removed })))
  }

  private requireRuntime(): ScheduleWorkRuntime {
    if (this.runtime === undefined) throw new Error('schedule-work: runtime is not started')
    return this.runtime
  }

  /** Map a store or validation failure onto its Remote failure; anything else propagates. */
  private mapStoreError(error: unknown): unknown {
    if (error instanceof ScheduleWorkValidationError) {
      return new RemoteError('schedule-work/invalid-task', error.message, { field: error.field })
    }
    if (error instanceof ScheduleWorkStoreError) {
      const code = error.code === 'invalid-task' ? 'schedule-work/invalid-task' : 'schedule-work/task-not-found'
      return new RemoteError(code, error.message, error.details)
    }
    return error
  }
}

export default ScheduleWorkGateway
