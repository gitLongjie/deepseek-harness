/**
 * Browser-side formatting for schedule-work records: rule summaries, run
 * labels, and the derived task status. Pure over the record shapes — the
 * durable values never carry presentation text.
 * @module
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ScheduleWorkRule, ScheduleWorkTaskView } from '@deepseek-ai/dsh-schedule-work/types'
import { NS } from './locales.ts'

/** The derived display status of one task. */
export type TaskStatus = 'active' | 'paused' | 'ended'

/**
 * Derive a task's display status. Paused wins over expiry so a paused task
 * still reads as paused after its validity passes.
 * @param task - The task view.
 * @returns the derived status.
 */
export function taskStatus(task: ScheduleWorkTaskView): TaskStatus {
  if (!task.enabled) return 'paused'
  return task.nextRunAt === null ? 'ended' : 'active'
}

/**
 * The localized one-line schedule summary, e.g. `每天 09:00`.
 * @param rule - The task's rule.
 * @param t - The namespace-bound translate seat.
 * @returns the summary text.
 */
export function ruleSummary(rule: ScheduleWorkRule, t: TranslateNS<typeof NS>): string {
  switch (rule.kind) {
    case 'once':
      return t('summary.once', { datetime: formatDateTime(rule.at) })
    case 'daily':
      return t('summary.daily', { time: rule.time })
    case 'weekly': {
      const days = [...rule.weekdays].sort((left, right) => left - right)
        .map(day => t(`weekday.${day}` as WeekdayKey)).join(' ')
      return t('summary.weekly', { days, time: rule.time })
    }
    case 'monthly': {
      const day = [...rule.days].sort((left, right) => left - right).join('/')
      return t('summary.monthly', { day, time: rule.time })
    }
    case 'interval': {
      const { value, unit } = intervalParts(rule.everySeconds)
      const unitKey: UnitKey = value === 1 ? `unit.${unit}.one` : `unit.${unit}.other`
      return t('summary.interval', { value, unit: t(unitKey, { count: value }) })
    }
  }
}

/** Local date-time of an RFC 3339 instant in the browser's locale, e.g. `2026/9/19 09:00`. */
export function formatDateTime(instant: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(Date.parse(instant))
}

/** Local clock-time of an RFC 3339 instant in the browser's locale. */
export function formatTime(instant: string): string {
  return new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(Date.parse(instant))
}

/** The exact whole-unit breakdown of a fixed-rate interval; sub-minute remainders round (the editor only creates whole minutes). */
function intervalParts(everySeconds: number): { value: number; unit: 'day' | 'hour' | 'minute' } {
  if (everySeconds % 86_400 === 0) return { value: everySeconds / 86_400, unit: 'day' }
  if (everySeconds % 3_600 === 0) return { value: everySeconds / 3_600, unit: 'hour' }
  return { value: Math.round(everySeconds / 60), unit: 'minute' }
}

type WeekdayKey = 'weekday.0' | 'weekday.1' | 'weekday.2' | 'weekday.3' | 'weekday.4' | 'weekday.5' | 'weekday.6'
type UnitKey = 'unit.minute.one' | 'unit.minute.other' | 'unit.hour.one' | 'unit.hour.other' | 'unit.day.one' | 'unit.day.other'
