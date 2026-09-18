/**
 * The schedule-work domain declaration: record schemas and the
 * `defineDomain` spec the gateway opens. The zod schemas validate the
 * shipped format at the durability boundary; rule-field patterns mirror the
 * validation in `./domain` so a hand-edited medium fails the open instead
 * of scheduling garbage.
 * @module @deepseek-ai/dsh-schedule-work/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { CLOCK_TIME_PATTERN, MAX_INTERVAL_SECONDS, MIN_INTERVAL_SECONDS } from './domain.ts'
import type { ClockTime, ScheduleWorkRunRecord, ScheduleWorkRunStatus, ScheduleWorkRule, ScheduleWorkTaskId, ScheduleWorkRunId, ScheduleWorkTaskRecord } from './types.ts'

/** Compiled clock-time pattern for the durable boundary. */
const CLOCK_TIME = new RegExp(CLOCK_TIME_PATTERN)

/** Brand a validated clock time at the durable boundary. */
const clockTime = z.string().regex(CLOCK_TIME).transform(value => value as ClockTime)

/** Task id schema at the durable boundary; branding has no runtime representation. */
const taskId = z.string().transform(value => value as ScheduleWorkTaskId)

/** Run id schema at the durable boundary. */
const runId = z.string().transform(value => value as ScheduleWorkRunId)

/** Bound workspace id; branding only, resolved through the workspace registry at dispatch. */
const workspaceId = z.string().transform(value => value as WorkspaceId)

/** Bound session id recorded after a successful dispatch. */
const sessionId = z.string().transform(value => value as SessionId)

/** RFC 3339 instant check shared by every timestamp field. */
const instant = z.string().refine(value => !Number.isNaN(Date.parse(value)), 'must be an RFC 3339 instant')

/** Recurrence rule schema; `transform` restores the branded clock time. */
const scheduleWorkRule: z.ZodType<ScheduleWorkRule> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), at: instant }),
  z.object({ kind: z.literal('daily'), time: clockTime }),
  z.object({
    kind: z.literal('weekly'),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1),
    time: clockTime,
  }),
  z.object({
    kind: z.literal('monthly'),
    days: z.array(z.number().int().min(1).max(31)).min(1),
    time: clockTime,
  }),
  z.object({
    kind: z.literal('interval'),
    everySeconds: z.number().int().min(MIN_INTERVAL_SECONDS).max(MAX_INTERVAL_SECONDS),
  }),
])

/** Durable shape of one scheduled task (see {@link ScheduleWorkTaskRecord}). */
export const scheduleWorkTaskRecord: z.ZodType<ScheduleWorkTaskRecord> = z.object({
  id: taskId,
  name: z.string().min(1),
  prompt: z.string().min(1),
  workspaceId: workspaceId.optional(),
  fullAccess: z.boolean(),
  rule: scheduleWorkRule,
  validUntil: instant.optional(),
  enabled: z.boolean(),
  createdAt: instant,
  updatedAt: instant,
  lastRunAt: instant.optional(),
})

/** Durable shape of one task run (see {@link ScheduleWorkRunRecord}). */
export const scheduleWorkRunRecord: z.ZodType<ScheduleWorkRunRecord> = z.object({
  id: runId,
  taskId: taskId,
  sessionId: sessionId.optional(),
  startedAt: instant,
  finishedAt: instant.optional(),
  status: z.enum(['running', 'succeeded', 'failed'] satisfies readonly ScheduleWorkRunStatus[]),
  error: z.string().optional(),
})

/**
 * The schedule-work domain spec: one `tasks` table keyed by task id and one
 * `runs` table keyed by run id. No global slot: task order is derived from
 * `createdAt`, and run history is bounded per task by the runtime.
 */
export const scheduleWorkDomainSpec = defineDomain({
  name: 'schedule_work',
  version: 1,
  tables: {
    tasks: domainTable<ScheduleWorkTaskId, ScheduleWorkTaskRecord>(scheduleWorkTaskRecord),
    runs: domainTable<ScheduleWorkRunId, ScheduleWorkRunRecord>(scheduleWorkRunRecord),
  },
})
