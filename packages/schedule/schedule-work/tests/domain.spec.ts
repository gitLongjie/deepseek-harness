import { describe, expect, it } from 'vitest'
import type { ClockTime } from '@deepseek-ai/dsh-schedule-work/types'
import {
  computeNextRunAt,
  latestDueOccurrence,
  MAX_NAME_LENGTH,
  MIN_INTERVAL_SECONDS,
  nextOccurrenceAfter,
  validateClockTime,
  validateRule,
  validateTaskInput,
} from '../src/domain.ts'
import type { ScheduleWorkRule, ScheduleWorkTaskRecord } from '../src/types.ts'

/** Brand a raw clock time at the fixture edge; these fixtures mirror `validateClockTime`'s own grammar. */
const clock = (value: string): ClockTime => value as ClockTime

/** Local-time helpers keep every expectation independent of the test host's zone. */
const local = (year: number, month: number, day: number, hours: number, minutes: number): Date =>
  new Date(year, month, day, hours, minutes, 0, 0)

const utc = (iso: string): Date => new Date(iso)

describe('validateClockTime', () => {
  it('accepts 24-hour clock times and rejects everything else', () => {
    expect(validateClockTime('00:00')).toBe('00:00')
    expect(validateClockTime('09:05')).toBe('09:05')
    expect(validateClockTime('23:59')).toBe('23:59')
    expect(() => validateClockTime('24:00')).toThrow(/HH:mm/)
    expect(() => validateClockTime('9:00')).toThrow(/HH:mm/)
    expect(() => validateClockTime('09:60')).toThrow(/HH:mm/)
  })
})

describe('validateRule', () => {
  it('accepts every well-formed kind', () => {
    const rules: readonly ScheduleWorkRule[] = [
      { kind: 'once', at: '2026-09-19T00:32:00Z' },
      { kind: 'daily', time: clock('09:00') },
      { kind: 'weekly', weekdays: [1, 3, 5], time: clock('09:00') },
      { kind: 'monthly', days: [1, 15, 31], time: clock('09:00') },
      { kind: 'interval', everySeconds: MIN_INTERVAL_SECONDS },
    ]
    for (const rule of rules) expect(validateRule(rule)).toBe(rule)
  })

  it('names the offending rule field', () => {
    expect(() => validateRule({ kind: 'once', at: 'not-a-time' })).toThrow(/rule\.at/)
    expect(() => validateRule({ kind: 'daily', time: clock('9:00') })).toThrow(/rule\.time/)
    expect(() => validateRule({ kind: 'weekly', weekdays: [], time: clock('09:00') })).toThrow(/rule\.weekdays/)
    expect(() => validateRule({ kind: 'weekly', weekdays: [7], time: clock('09:00') })).toThrow(/rule\.weekdays/)
    expect(() => validateRule({ kind: 'monthly', days: [0], time: clock('09:00') })).toThrow(/rule\.days/)
    expect(() => validateRule({ kind: 'monthly', days: [32], time: clock('09:00') })).toThrow(/rule\.days/)
    expect(() => validateRule({ kind: 'interval', everySeconds: MIN_INTERVAL_SECONDS - 1 })).toThrow(/rule\.everySeconds/)
    expect(() => validateRule({ kind: 'interval', everySeconds: 1.5 })).toThrow(/rule\.everySeconds/)
    expect(() => validateRule({ kind: 'hourly', time: clock('09:00') } as unknown as ScheduleWorkRule)).toThrow(/rule kind/)
  })
})

describe('validateTaskInput', () => {
  it('trims name and prompt and normalizes cleared optionals', () => {
    const input = validateTaskInput({
      name: '  资讯总结  ',
      prompt: '  总结昨日资讯  ',
      workspaceId: null,
      fullAccess: true,
      rule: { kind: 'daily', time: clock('09:00') },
      validUntil: null,
    })
    expect(input.name).toBe('资讯总结')
    expect(input.prompt).toBe('总结昨日资讯')
    expect(input).not.toHaveProperty('workspaceId')
    expect(input).not.toHaveProperty('validUntil')
    expect(input.fullAccess).toBe(true)
  })

  it('rejects empty or oversized text and invalid instants', () => {
    expect(() => validateTaskInput({ name: '  ', prompt: 'x', rule: { kind: 'daily', time: clock('09:00') } })).toThrow(/name/)
    expect(() => validateTaskInput({ name: 'x'.repeat(MAX_NAME_LENGTH + 1), prompt: 'x', rule: { kind: 'daily', time: clock('09:00') } })).toThrow(/name/)
    expect(() => validateTaskInput({ name: 'x', prompt: '', rule: { kind: 'daily', time: clock('09:00') } })).toThrow(/prompt/)
    expect(() => validateTaskInput({
      name: 'x', prompt: 'x', rule: { kind: 'daily', time: clock('09:00') }, validUntil: 'yesterday',
    })).toThrow(/validUntil/)
  })
})

describe('nextOccurrenceAfter', () => {
  it('returns the spent once instant as null and the future one verbatim', () => {
    const rule: ScheduleWorkRule = { kind: 'once', at: '2026-09-19T09:00:00Z' }
    expect(nextOccurrenceAfter(rule, utc('2026-09-19T08:59:59Z'), utc('2026-01-01T00:00:00Z'))).toEqual(utc('2026-09-19T09:00:00Z'))
    expect(nextOccurrenceAfter(rule, utc('2026-09-19T09:00:00Z'), utc('2026-01-01T00:00:00Z'))).toBeNull()
  })

  it('steps daily rules on the local clock', () => {
    const rule: ScheduleWorkRule = { kind: 'daily', time: clock('09:00') }
    expect(nextOccurrenceAfter(rule, local(2026, 8, 19, 5, 0), local(2026, 1, 1, 0, 0))).toEqual(local(2026, 8, 19, 9, 0))
    expect(nextOccurrenceAfter(rule, local(2026, 8, 19, 9, 0), local(2026, 1, 1, 0, 0))).toEqual(local(2026, 8, 20, 9, 0))
  })

  it('picks the earliest listed weekday', () => {
    const rule: ScheduleWorkRule = { kind: 'weekly', weekdays: [1, 3, 5], time: clock('09:00') }
    // 2026-09-19 is a Saturday; Monday the 21st at 09:00 local is next.
    expect(nextOccurrenceAfter(rule, local(2026, 8, 19, 10, 0), local(2026, 1, 1, 0, 0))).toEqual(local(2026, 8, 21, 9, 0))
  })

  it('skips months without a listed day-of-month', () => {
    const rule: ScheduleWorkRule = { kind: 'monthly', days: [31], time: clock('09:00') }
    // January 31 fires; February has no 31st, so the next is March 31.
    const january = nextOccurrenceAfter(rule, local(2026, 0, 15, 10, 0), local(2025, 0, 1, 0, 0))
    expect(january).toEqual(local(2026, 0, 31, 9, 0))
    expect(nextOccurrenceAfter(rule, local(2026, 0, 31, 9, 0), local(2025, 0, 1, 0, 0))).toEqual(local(2026, 2, 31, 9, 0))
  })

  it('keeps fixed-rate occurrences on the createdAt-anchored grid', () => {
    const rule: ScheduleWorkRule = { kind: 'interval', everySeconds: 300 }
    const anchor = utc('2026-09-19T00:00:00Z')
    expect(nextOccurrenceAfter(rule, utc('2026-09-19T00:07:00Z'), anchor)).toEqual(utc('2026-09-19T00:10:00Z'))
    expect(nextOccurrenceAfter(rule, utc('2026-09-19T00:10:00Z'), anchor)).toEqual(utc('2026-09-19T00:15:00Z'))
  })
})

describe('latestDueOccurrence', () => {
  it('collapses a window of missed daily occurrences onto the latest slot', () => {
    const rule: ScheduleWorkRule = { kind: 'daily', time: clock('09:00') }
    const due = latestDueOccurrence(
      rule,
      local(2026, 8, 15, 10, 0),
      local(2026, 8, 19, 9, 15),
      local(2026, 1, 1, 0, 0),
    )
    expect(due).toEqual(local(2026, 8, 19, 9, 0))
  })

  it('returns null past the horizon and for a spent once rule', () => {
    const daily: ScheduleWorkRule = { kind: 'daily', time: clock('09:00') }
    expect(latestDueOccurrence(daily, local(2026, 8, 19, 9, 0), local(2026, 8, 19, 9, 0), local(2026, 1, 1, 0, 0))).toBeNull()
    const once: ScheduleWorkRule = { kind: 'once', at: utc('2026-09-19T09:00:00Z').toISOString() }
    expect(latestDueOccurrence(once, utc('2026-09-19T08:00:00Z'), utc('2026-09-19T10:00:00Z'), anchorOfOnce())).toEqual(utc('2026-09-19T09:00:00Z'))
    expect(latestDueOccurrence(once, utc('2026-09-19T09:00:00Z'), utc('2026-09-19T10:00:00Z'), anchorOfOnce())).toBeNull()
  })

  it('reports one pending fixed-rate occurrence inside the window', () => {
    const rule: ScheduleWorkRule = { kind: 'interval', everySeconds: 600 }
    const anchor = utc('2026-09-19T00:00:00Z')
    expect(latestDueOccurrence(rule, utc('2026-09-19T00:00:00Z'), utc('2026-09-19T00:25:00Z'), anchor))
      .toEqual(utc('2026-09-19T00:20:00Z'))
  })
})

describe('computeNextRunAt', () => {
  const base: ScheduleWorkTaskRecord = {
    id: 'schedule-work-task-1' as ScheduleWorkTaskRecord['id'],
    name: '资讯总结',
    prompt: '总结昨日资讯',
    fullAccess: false,
    rule: { kind: 'daily', time: clock('09:00') },
    enabled: true,
    createdAt: local(2026, 8, 1, 8, 0).toISOString(),
    updatedAt: local(2026, 8, 1, 8, 0).toISOString(),
  }

  it('is null for a paused task', () => {
    expect(computeNextRunAt({ ...base, enabled: false }, local(2026, 8, 19, 10, 0))).toBeNull()
  })

  it('surfaces a pending due occurrence before the future one', () => {
    const ranYesterday = { ...base, lastRunAt: local(2026, 8, 18, 9, 0).toISOString() }
    expect(computeNextRunAt(ranYesterday, local(2026, 8, 19, 10, 0))).toBe(local(2026, 8, 19, 9, 0).toISOString())
    expect(computeNextRunAt(ranYesterday, local(2026, 8, 19, 8, 0))).toBe(local(2026, 8, 19, 9, 0).toISOString())
  })

  it('is null once validity ends before anything is due', () => {
    const bounded: ScheduleWorkTaskRecord = {
      ...base,
      validUntil: local(2026, 8, 20, 9, 0).toISOString(),
      lastRunAt: local(2026, 8, 20, 9, 0).toISOString(),
    }
    expect(computeNextRunAt(bounded, local(2026, 8, 20, 10, 0))).toBeNull()
  })

  it('is null for a spent once rule and non-null for a pending one', () => {
    const spent: ScheduleWorkTaskRecord = {
      ...base,
      rule: { kind: 'once', at: utc('2026-09-10T09:00:00Z').toISOString() },
      lastRunAt: utc('2026-09-10T09:00:00Z').toISOString(),
    }
    expect(computeNextRunAt(spent, utc('2026-09-19T00:00:00Z'))).toBeNull()
    const pending: ScheduleWorkTaskRecord = { ...spent, lastRunAt: undefined }
    expect(computeNextRunAt(pending, utc('2026-09-01T00:00:00Z'))).toBe(utc('2026-09-10T09:00:00Z').toISOString())
  })
})

/** The createdAt anchor shared by the once-rule expectations. */
function anchorOfOnce(): Date {
  return utc('2026-01-01T00:00:00Z')
}
