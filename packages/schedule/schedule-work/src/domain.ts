/**
 * Pure schedule-work rule logic: validation and occurrence math over the
 * durable record shapes. Calendar rules resolve against the Host's local
 * time zone; every function here is side-effect free so the scheduler and
 * the tests drive the same clock. DST gaps resolve to the shifted instant
 * JavaScript's `Date` construction produces (a skipped local time fires at
 * the shifted wall clock); overlaps take the first instant.
 * @module @deepseek-ai/dsh-schedule-work/src/domain
 */

import type { ClockTime, ScheduleWorkRule, ScheduleWorkTaskInput, ScheduleWorkTaskRecord } from './types.ts'

/** Minimum fixed-rate interval, matching the session reminder floor (5 minutes). */
export const MIN_INTERVAL_SECONDS = 300

/** Maximum fixed-rate interval (one year) to bound the arithmetic. */
export const MAX_INTERVAL_SECONDS = 31_536_000

/** Longest task or run name accepted; longer input is a validation failure, not a silent truncation. */
export const MAX_NAME_LENGTH = 200

/** Source pattern of a local clock time; `spec.ts` reuses it at the storage boundary. */
export const CLOCK_TIME_PATTERN = '([01]\\d|2[0-3]):([0-5]\\d)'

const CLOCK_TIME_RE = new RegExp(`^${CLOCK_TIME_PATTERN}$`)
const WEEKDAY_MIN = 0
const WEEKDAY_MAX = 6
const MONTHDAY_MIN = 1
const MONTHDAY_MAX = 31
/** Month scan bound for monthly rules: four years covers every 29 Feb cycle. */
const MONTH_SCAN_MONTHS = 48
/** Week scan bound for weekly rules: 8 days covers a full week plus DST shift. */
const WEEK_SCAN_DAYS = 8

/**
 * A create or edit input failed validation. The gateway maps this onto its
 * `schedule-work/invalid-task` Remote failure with the offending field.
 */
export class ScheduleWorkValidationError extends Error {
  /**
   * @param field - dotted record field the input failed on.
   * @param message - human diagnostic.
   */
  constructor(readonly field: string, message: string) {
    super(message)
    this.name = 'ScheduleWorkValidationError'
  }
}

/**
 * Validate a local clock time.
 * @param value - Candidate `HH:mm` string.
 * @returns the same string, branded.
 * @throws ScheduleWorkValidationError outside `00:00`–`23:59`.
 */
export function validateClockTime(value: string): ClockTime {
  if (!CLOCK_TIME_RE.test(value)) {
    throw new ScheduleWorkValidationError('rule.time', `rule.time must be HH:mm between 00:00 and 23:59, got '${value}'`)
  }
  return value as ClockTime
}

/**
 * Validate one recurrence rule's shape and ranges. Field names in the errors
 * address the rule object (`rule.time`, `rule.weekdays`, …).
 * @param rule - Candidate rule.
 * @returns the same rule when every field is in range.
 * @throws ScheduleWorkValidationError on an unknown kind, empty or
 *   out-of-range day sets, a malformed clock time, or an interval outside
 *   the fixed-rate bounds.
 */
export function validateRule(rule: ScheduleWorkRule): ScheduleWorkRule {
  switch (rule.kind) {
    case 'once': {
      const at = Date.parse(rule.at)
      if (Number.isNaN(at)) {
        throw new ScheduleWorkValidationError('rule.at', `rule.at must be an RFC 3339 instant, got '${rule.at}'`)
      }
      return rule
    }    case 'daily':
      validateClockTime(rule.time)
      return rule
    case 'weekly': {
      const days = new Set(rule.weekdays)
      if (rule.weekdays.length === 0 || [...days].some(day => day < WEEKDAY_MIN || day > WEEKDAY_MAX)) {
        throw new ScheduleWorkValidationError('rule.weekdays', 'rule.weekdays must list at least one value 0 (Sunday) through 6 (Saturday)')
      }
      validateClockTime(rule.time)
      return rule
    }
    case 'monthly': {
      const days = new Set(rule.days)
      if (rule.days.length === 0 || [...days].some(day => day < MONTHDAY_MIN || day > MONTHDAY_MAX)) {
        throw new ScheduleWorkValidationError('rule.days', 'rule.days must list at least one value 1 through 31')
      }
      validateClockTime(rule.time)
      return rule
    }
    case 'interval':
      if (!Number.isSafeInteger(rule.everySeconds) || rule.everySeconds < MIN_INTERVAL_SECONDS
        || rule.everySeconds > MAX_INTERVAL_SECONDS) {
        throw new ScheduleWorkValidationError(
          'rule.everySeconds',
          `rule.everySeconds must be an integer between ${MIN_INTERVAL_SECONDS} and ${MAX_INTERVAL_SECONDS}`,
        )
      }
      return rule
    default:
      throw new ScheduleWorkValidationError('rule', 'rule kind must be one of once, daily, weekly, monthly, interval')
  }
}

/**
 * Validate and normalize one create/edit input. Trims `name` and `prompt`;
 * rejects an empty result, an invalid rule, and an unparseable `validUntil`;
 * normalizes a `null` optional field to absent.
 * @param input - Candidate input from a Remote caller.
 * @returns the normalized input.
 * @throws ScheduleWorkValidationError naming the first offending field.
 */
export function validateTaskInput(input: ScheduleWorkTaskInput): ScheduleWorkTaskInput {
  const name = input.name.trim()
  if (name.length === 0) throw new ScheduleWorkValidationError('name', 'name must not be empty')
  if (name.length > MAX_NAME_LENGTH) {
    throw new ScheduleWorkValidationError('name', `name must be at most ${MAX_NAME_LENGTH} characters`)
  }
  const prompt = input.prompt.trim()
  if (prompt.length === 0) throw new ScheduleWorkValidationError('prompt', 'prompt must not be empty')
  validateRule(input.rule)
  if (input.validUntil != null && Number.isNaN(Date.parse(input.validUntil))) {
    throw new ScheduleWorkValidationError('validUntil', `validUntil must be an RFC 3339 instant, got '${input.validUntil}'`)
  }
  return {
    name,
    prompt,
    ...(input.workspaceId == null ? {} : { workspaceId: input.workspaceId }),
    ...(input.fullAccess === undefined ? {} : { fullAccess: input.fullAccess }),
    rule: input.rule,
    ...(input.validUntil == null ? {} : { validUntil: input.validUntil }),
    ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
  }
}

/** The recurrence anchor of a task: fixed-rate arithmetic keys off `createdAt`. */
function anchorOf(record: Pick<ScheduleWorkTaskRecord, 'createdAt'>): Date {
  return new Date(record.createdAt)
}

/** Earliest instant strictly after `after` whose local clock matches `time`. */
function nextDailyAfter(time: ClockTime, after: Date): Date {
  const [hours, minutes] = time.split(':').map(Number) as [number, number]
  for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
    const candidate = new Date(after.getFullYear(), after.getMonth(), after.getDate() + dayOffset, hours, minutes, 0, 0)
    if (candidate.getTime() > after.getTime()) return candidate
  }
  // Unreachable: tomorrow at the same wall clock is always strictly later.
  throw new Error(`nextDailyAfter: no occurrence after ${after.toISOString()}`)
}

/**
 * Earliest instant strictly after `after` on a listed weekday at `time`.
 * Weekdays use `Date.getDay()` numbering (0 = Sunday).
 */
function nextWeeklyAfter(weekdays: readonly number[], time: ClockTime, after: Date): Date {
  const wanted = new Set(weekdays)
  const [hours, minutes] = time.split(':').map(Number) as [number, number]
  for (let dayOffset = 0; dayOffset <= WEEK_SCAN_DAYS; dayOffset += 1) {
    const candidate = new Date(after.getFullYear(), after.getMonth(), after.getDate() + dayOffset, hours, minutes, 0, 0)
    if (candidate.getTime() > after.getTime() && wanted.has(candidate.getDay())) return candidate
  }
  throw new Error(`nextWeeklyAfter: no occurrence after ${after.toISOString()}`)
}

/**
 * Earliest instant strictly after `after` on a listed day-of-month at
 * `time`. Months without the listed day contribute nothing (no clamping).
 */
function nextMonthlyAfter(days: readonly number[], time: ClockTime, after: Date): Date {
  const wanted = [...new Set(days)].sort((left, right) => left - right)
  const [hours, minutes] = time.split(':').map(Number) as [number, number]
  let year = after.getFullYear()
  let month = after.getMonth()
  for (let step = 0; step <= MONTH_SCAN_MONTHS; step += 1) {
    for (const day of wanted) {
      const candidate = new Date(year, month, day, hours, minutes, 0, 0)
      // A month without the day rolls the Date into the next month; skip it.
      if (candidate.getDate() !== day) continue
      if (candidate.getTime() > after.getTime()) return candidate
    }
    month += 1
    if (month > 11) {
      month = 0
      year += 1
    }
  }
  throw new Error(`nextMonthlyAfter: no occurrence within ${MONTH_SCAN_MONTHS} months after ${after.toISOString()}`)
}

/**
 * Earliest fixed-rate occurrence strictly after `after`, on the
 * `createdAt`-anchored grid.
 */
function nextIntervalAfter(everySeconds: number, anchor: Date, after: Date): Date {
  const intervalMs = everySeconds * 1_000
  const steps = Math.floor((after.getTime() - anchor.getTime()) / intervalMs) + 1
  return new Date(anchor.getTime() + steps * intervalMs)
}

/**
 * Earliest occurrence of a rule strictly after `after`.
 * @param rule - Validated rule.
 * @param after - Exclusive lower bound.
 * @param createdAt - Task creation instant; the fixed-rate anchor.
 * @returns the occurrence, or `null` when a `once` rule is already spent.
 */
export function nextOccurrenceAfter(
  rule: ScheduleWorkRule,
  after: Date,
  createdAt: Date,
): Date | null {
  switch (rule.kind) {
    case 'once': {
      const at = new Date(rule.at)
      return at.getTime() > after.getTime() ? at : null
    }
    case 'daily':
      return nextDailyAfter(rule.time, after)
    case 'weekly':
      return nextWeeklyAfter(rule.weekdays, rule.time, after)
    case 'monthly':
      return nextMonthlyAfter(rule.days, rule.time, after)
    case 'interval':
      return nextIntervalAfter(rule.everySeconds, createdAt, after)
  }
}

/**
 * The latest occurrence in the half-open window `(baseline, horizon]`, or
 * `null` when none is due. This is the catch-up read: a task paused across
 * many missed calendar occurrences fires once, at the latest missed slot,
 * and the next wait starts from there (latest-only catch-up).
 * @param rule - Validated rule.
 * @param baseline - Exclusive lower bound (`lastRunAt`, else `createdAt`).
 * @param horizon - Inclusive upper bound (usually now, clamped by validity).
 * @param createdAt - Task creation instant; the fixed-rate anchor.
 * @returns the latest due occurrence, or `null`.
 */
export function latestDueOccurrence(
  rule: ScheduleWorkRule,
  baseline: Date,
  horizon: Date,
  createdAt: Date,
): Date | null {
  if (horizon.getTime() <= baseline.getTime()) return null
  if (rule.kind === 'once') {
    const at = new Date(rule.at)
    return at.getTime() > baseline.getTime() && at.getTime() <= horizon.getTime() ? at : null
  }
  let latest: Date | null = null
  let cursor = baseline
  // Iteration is bounded in practice (calendar rules step days or months);
  // the guard only caps a pathological rule never reached through validation.
  for (let steps = 0; steps < 100_000; steps += 1) {
    const occurrence = nextOccurrenceAfter(rule, cursor, createdAt)
    if (occurrence === null || occurrence.getTime() > horizon.getTime()) break
    latest = occurrence
    cursor = occurrence
  }
  return latest
}

/**
 * Whether `at` is inside a task's validity. An absent `validUntil` is
 * open-ended; the bound itself is inclusive.
 */
export function withinValidity(validUntil: string | undefined, at: Date): boolean {
  return validUntil === undefined || at.getTime() <= Date.parse(validUntil)
}

/**
 * The validity horizon of a task: its `validUntil` when set, else `until`.
 * @returns the clamped horizon instant.
 */
function validityClamp(record: ScheduleWorkTaskRecord, until: Date): Date {
  if (record.validUntil === undefined) return until
  const end = new Date(record.validUntil)
  return end.getTime() < until.getTime() ? end : until
}

/**
 * Compute a task's next occurrence for display and scheduling.
 * @param record - Durable task.
 * @param now - Current instant.
 * @returns the instant the task will fire next: the latest due occurrence
 *   when one is pending (the scheduler dispatches it on the following
 *   drain), otherwise the earliest future occurrence; `null` when the task
 *   is paused or its validity ended before anything is due.
 */
export function computeNextRunAt(record: ScheduleWorkTaskRecord, now: Date): string | null {
  if (!record.enabled) return null
  const anchor = anchorOf(record)
  const baseline = new Date(record.lastRunAt ?? record.createdAt)
  const horizon = validityClamp(record, now)
  const due = latestDueOccurrence(record.rule, baseline, horizon, anchor)
  if (due !== null) return due.toISOString()
  const cursor = baseline.getTime() > now.getTime() ? baseline : now
  if (!withinValidity(record.validUntil, cursor)) return null
  const upcoming = nextOccurrenceAfter(record.rule, cursor, anchor)
  if (upcoming === null) return null
  return withinValidity(record.validUntil, upcoming) ? upcoming.toISOString() : null
}
