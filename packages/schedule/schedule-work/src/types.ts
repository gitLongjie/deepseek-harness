/**
 * Durable record and wire vocabulary of the schedule-work capability. The
 * zod schemas in `./spec` validate these records at the storage boundary;
 * the `./client` subpath re-exports this module as the browser-safe surface.
 * @module @deepseek-ai/dsh-schedule-work/src/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

/** Identity of one scheduled task; minted by the runtime, never reused. */
export type ScheduleWorkTaskId = Branded<'schedule-work-task-id'>

/** Identity of one task run; minted by the runtime at dispatch start. */
export type ScheduleWorkRunId = Branded<'schedule-work-run-id'>

/**
 * Local clock time of a calendar rule, `HH:mm` 24-hour. Validated by
 * `validateClockTime` in `./domain`; the record schemas re-check the same
 * pattern at the storage boundary.
 */
export type ClockTime = Branded<'clock-time'>

/**
 * The recurrence rule of a task. `once` fires at one RFC 3339 UTC instant;
 * `daily`, `weekly`, and `monthly` fire on local calendar days at a fixed
 * local clock time; `interval` fires on a fixed rate anchored at the task's
 * `createdAt`. Calendar times follow the Host's local time zone — the
 * desktop deployment runs where its user is.
 */
export type ScheduleWorkRule =
  | { readonly kind: 'once'; readonly at: string }
  | { readonly kind: 'daily'; readonly time: ClockTime }
  | { readonly kind: 'weekly'; readonly weekdays: readonly number[]; readonly time: ClockTime }
  | { readonly kind: 'monthly'; readonly days: readonly number[]; readonly time: ClockTime }
  | { readonly kind: 'interval'; readonly everySeconds: number }

/**
 * One durable scheduled task. `prompt` is delivered verbatim as the created
 * Session's first user message; `workspaceId` binds where it runs (absent
 * uses the Host's default project directory); `fullAccess` requests the
 * `danger-full-access` permission preset after creation; `validUntil` ends
 * the task's validity (RFC 3339 UTC, absent means open-ended); `enabled`
 * paused tasks stop firing without changing their rule. Timestamps are
 * RFC 3339 UTC strings.
 */
export interface ScheduleWorkTaskRecord {
  readonly id: ScheduleWorkTaskId
  readonly name: string
  readonly prompt: string
  readonly workspaceId?: WorkspaceId | undefined
  readonly fullAccess: boolean
  readonly rule: ScheduleWorkRule
  readonly validUntil?: string | undefined
  readonly enabled: boolean
  readonly createdAt: string
  readonly updatedAt: string
  readonly lastRunAt?: string | undefined
}

/** Dispatch outcome of one task run. */
export type ScheduleWorkRunStatus = 'running' | 'succeeded' | 'failed'

/**
 * One durable run record. `sessionId` addresses the Session the prompt was
 * delivered to; `error` carries the failure diagnostic when the dispatch
 * itself failed (creation, preset switch, prompt admission). Completion
 * means the Session returned to idle, not that the agent's work succeeded.
 */
export interface ScheduleWorkRunRecord {
  readonly id: ScheduleWorkRunId
  readonly taskId: ScheduleWorkTaskId
  readonly sessionId?: SessionId | undefined
  readonly startedAt: string
  readonly finishedAt?: string | undefined
  readonly status: ScheduleWorkRunStatus
  readonly error?: string | undefined
}

/** Wire view of one task: the durable record plus its computed next occurrence. */
export type ScheduleWorkTaskView = ScheduleWorkTaskRecord & {
  /** Earliest future occurrence, or `null` when the task is paused, past its validity, or a spent `once`. */
  readonly nextRunAt: string | null
}

/** Requested task creation or edit; identity and audit fields are runtime-owned. `null` clears an optional field. */
export type ScheduleWorkTaskInput = {
  readonly name: string
  readonly prompt: string
  readonly workspaceId?: WorkspaceId | null
  readonly fullAccess?: boolean
  readonly rule: ScheduleWorkRule
  readonly validUntil?: string | null
  readonly enabled?: boolean
}

/** Remote list value for tasks. */
export interface ScheduleWorkTaskList {
  readonly tasks: readonly ScheduleWorkTaskView[]
}

/** Remote list value for run records, newest first. */
export interface ScheduleWorkRunList {
  readonly runs: readonly ScheduleWorkRunRecord[]
}
