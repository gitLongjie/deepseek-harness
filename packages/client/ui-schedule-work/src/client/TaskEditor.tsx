/**
 * The add/edit task dialog: name, prompt, workspace binding, full-access
 * switch, schedule rule editor, and validity. All fields are controlled; the
 * parent owns submission and the error surface.
 * @module
 */

import { useState } from 'react'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { ClockTime, ScheduleWorkRule, ScheduleWorkTaskInput, ScheduleWorkTaskView } from '@deepseek-ai/dsh-schedule-work/types'
import { Button, Input, Modal, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import css from './TaskEditor.module.css'

/** Brand a raw HH:mm input at the form edge; the picker only emits valid clock times. */
const clock = (value: string): ClockTime => value as ClockTime

/** One selectable workspace row of the picker. */
export interface WorkspaceOption {
  readonly id: WorkspaceId
  readonly title: string
}

/** Editor dialog props. The parent supplies submission; the dialog owns form state. */
export interface TaskEditorProps {
  /** `create` shows the add title, `edit` the edit title over the initial task. */
  mode: 'create' | 'edit'
  /** The task under edit; absent when creating. */
  initial?: ScheduleWorkTaskView | undefined
  /** Selectable workspaces in display order. */
  workspaces: readonly WorkspaceOption[]
  /** Translate seat of the scheduleWork namespace. */
  t: TranslateNS<typeof NS>
  /** Close request from the cancel button, the mask, or Escape. */
  onCancel: () => void
  /** Submit the validated input; the dialog closes itself only through the parent. */
  onSubmit: (input: ScheduleWorkTaskInput) => Promise<void>
  /** Submit failure surfaced under the form; cleared by the next submit. */
  submitError?: string | undefined
}

/** The rule kinds the editor offers, in selector order. */
const RULE_KINDS = ['once', 'daily', 'weekly', 'monthly', 'interval'] as const
/** Weekday order shown in the picker (Monday-first). */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const
/** Smallest fixed interval the host accepts, in minutes. */
const MIN_INTERVAL_MINUTES = 5

/** Add/edit task dialog. */
export function TaskEditor({ mode, initial, workspaces, t, onCancel, onSubmit, submitError }: TaskEditorProps) {
  const initialRule = initial?.rule ?? { kind: 'daily', time: clock('09:00') }
  const [name, setName] = useState(initial?.name ?? '')
  const [prompt, setPrompt] = useState(initial?.prompt ?? '')
  const [workspaceId, setWorkspaceId] = useState<WorkspaceId | null>(initial?.workspaceId ?? null)
  const [fullAccess, setFullAccess] = useState(initial?.fullAccess ?? false)
  const [rule, setRule] = useState<ScheduleWorkRule>(initialRule)
  const [hasEnd, setHasEnd] = useState(initial?.validUntil !== undefined)
  const [endDate, setEndDate] = useState(() => toDateInput(initial?.validUntil))
  const [submitting, setSubmitting] = useState(false)

  const patchRule = (next: ScheduleWorkRule): void => { setRule(next) }

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    try {
      await onSubmit({
        name,
        prompt,
        workspaceId,
        fullAccess,
        rule,
        validUntil: hasEnd && endDate !== '' ? endOfDayInstant(endDate) : null,
        enabled: initial?.enabled ?? true,
      })
    } finally {
      setSubmitting(false)
    }
  }

  const ruleValid = ruleComplete(rule)
  const canSubmit = name.trim().length > 0 && prompt.trim().length > 0 && ruleValid && !submitting

  return (
    <Modal
      open
      onClose={onCancel}
      title={t(mode === 'create' ? 'dialog.addTitle' : 'dialog.editTitle')}
      closeLabel={t('action.cancel')}
      className={css.dialog ?? ''}
      contentClassName={css.dialogContent ?? ''}
      footer={(
        <div className={css.footer}>
          <Button onClick={onCancel}>{t('action.cancel')}</Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => { void submit() }}>
            {t('action.confirm')}
          </Button>
        </div>
      )}
    >
      <div className={css.form}>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('dialog.name')}</span>
          <Input
            value={name}
            placeholder={t('dialog.namePlaceholder')}
            onChange={(event) => { setName(event.currentTarget.value) }}
          />
        </label>

        <div className={css.field}>
          <span className={css.fieldLabel}>{t('dialog.prompt')}</span>
          <textarea
            className={css.prompt}
            value={prompt}
            placeholder={t('dialog.promptPlaceholder')}
            rows={5}
            onChange={(event) => { setPrompt(event.currentTarget.value) }}
          />
        </div>

        <div className={css.dialogRow}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('dialog.workspace')}</span>
            <select
              className={css.select}
              value={workspaceId ?? ''}
              onChange={(event) => { setWorkspaceId(event.currentTarget.value === '' ? null : event.currentTarget.value as WorkspaceId) }}
            >
              <option value="">{t('dialog.workspaceDefault')}</option>
              {workspaces.map(workspace => (
                <option key={workspace.id} value={workspace.id}>{workspace.title}</option>
              ))}
            </select>
          </label>
          <span className={css.switchField}>
            <Switch
              checked={fullAccess}
              onChange={setFullAccess}
              label={t('dialog.fullAccess')}
            />
          </span>
        </div>

        <div className={css.field}>
          <span className={css.fieldLabel}>{t('dialog.frequency')}</span>
          <div className={css.ruleEditor}>
            <select
              className={`${css.select} ${css.kindSelect}`}
              value={rule.kind}
              onChange={(event) => { patchRule(switchRuleKind(rule, event.currentTarget.value as ScheduleWorkRule['kind'])) }}
            >
              {RULE_KINDS.map(kind => (
                <option key={kind} value={kind}>{t(kindKey(kind))}</option>
              ))}
            </select>
            <div className={css.ruleFields}>
              <RuleFields rule={rule} t={t} onChange={patchRule} />
            </div>
          </div>
        </div>

        <div className={css.field}>
          <span className={css.fieldLabel}>{t('dialog.validity')}</span>
          <div className={css.ruleEditor}>
            <select
              className={`${css.select} ${css.kindSelect}`}
              value={hasEnd ? 'until' : 'forever'}
              onChange={(event) => { setHasEnd(event.currentTarget.value === 'until') }}
            >
              <option value="forever">{t('validity.forever')}</option>
              <option value="until">{t('validity.until')}</option>
            </select>
            {hasEnd && (
              <input
                type="date"
                className={css.select}
                value={endDate}
                onChange={(event) => { setEndDate(event.currentTarget.value) }}
              />
            )}
          </div>
        </div>

        {submitError !== undefined && <p className={css.submitError} role="alert">{t('error.save')}: {submitError}</p>}
      </div>
    </Modal>
  )
}

/** Per-kind fields of the rule editor; keyed so kind switches rebuild the inputs. */
function RuleFields({ rule, t, onChange }: {
  rule: ScheduleWorkRule
  t: TranslateNS<typeof NS>
  onChange: (rule: ScheduleWorkRule) => void
}) {
  switch (rule.kind) {
    case 'once':
      return (
        <input
          type="datetime-local"
          className={`${css.select} ${css.onceInput}`}
          value={toDateInput(rule.at)}
          onChange={(event) => {
            const value = event.currentTarget.value
            if (value !== '') onChange({ kind: 'once', at: new Date(value).toISOString() })
          }}
        />
      )
    case 'daily':
      return (
        <input
          type="time"
          className={`${css.select} ${css.timeInput}`}
          value={rule.time}
          onChange={(event) => {
            if (event.currentTarget.value !== '') onChange({ kind: 'daily', time: clock(event.currentTarget.value) })
          }}
        />
      )
    case 'weekly':
      return (
        <span className={css.weekdays}>
          {WEEKDAY_ORDER.map((day) => {
            const active = rule.weekdays.includes(day)
            return (
              <button
                key={day}
                type="button"
                className={active ? `${css.weekday} ${css.weekdayOn}` : css.weekday}
                onClick={() => {
                  const next = active ? rule.weekdays.filter(day_ => day_ !== day) : [...rule.weekdays, day]
                  if (next.length > 0) onChange({ kind: 'weekly', weekdays: next, time: rule.time })
                }}
              >
                {t(`weekday.${day}`)}
              </button>
            )
          })}
          <input
            type="time"
            className={`${css.select} ${css.timeInput}`}
            value={rule.time}
            onChange={(event) => {
              if (event.currentTarget.value !== '') onChange({ kind: 'weekly', weekdays: rule.weekdays, time: clock(event.currentTarget.value) })
            }}
          />
        </span>
      )
    case 'monthly':
      return (
        <span className={css.weekdays}>
          <input
            type="number"
            min={1}
            max={31}
            className={`${css.select} ${css.dayInput}`}
            value={rule.days[0] ?? 1}
            onChange={(event) => {
              const day = Number(event.currentTarget.value)
              if (Number.isInteger(day) && day >= 1 && day <= 31) onChange({ kind: 'monthly', days: [day], time: rule.time })
            }}
          />
          <input
            type="time"
            className={`${css.select} ${css.timeInput}`}
            value={rule.time}
            onChange={(event) => {
              if (event.currentTarget.value !== '') onChange({ kind: 'monthly', days: rule.days, time: clock(event.currentTarget.value) })
            }}
          />
        </span>
      )
    case 'interval':
      return (
        <span className={css.weekdays}>
          <input
            type="number"
            min={MIN_INTERVAL_MINUTES}
            className={`${css.select} ${css.dayInput}`}
            value={Math.max(MIN_INTERVAL_MINUTES, Math.round(rule.everySeconds / 60))}
            onChange={(event) => {
              const minutes = Number(event.currentTarget.value)
              if (Number.isInteger(minutes) && minutes >= MIN_INTERVAL_MINUTES) {
                onChange({ kind: 'interval', everySeconds: minutes * 60 })
              }
            }}
          />
          <span className={css.intervalUnit}>{t('freq.intervalUnit')}</span>
        </span>
      )
  }
}

function kindKey(kind: ScheduleWorkRule['kind']): 'freq.once' | 'freq.daily' | 'freq.weekly' | 'freq.monthly' | 'freq.interval' {
  return ({ once: 'freq.once', daily: 'freq.daily', weekly: 'freq.weekly', monthly: 'freq.monthly', interval: 'freq.interval' } as const)[kind]
}

/** Whether the current rule holds a complete value in every per-kind field. */
function ruleComplete(rule: ScheduleWorkRule): boolean {
  switch (rule.kind) {
    case 'once': return !Number.isNaN(Date.parse(rule.at))
    case 'daily': return rule.time !== ''
    case 'weekly': return rule.weekdays.length > 0 && rule.time !== ''
    case 'monthly': return rule.days.length > 0 && rule.time !== ''
    case 'interval': return Number.isInteger(rule.everySeconds) && rule.everySeconds >= MIN_INTERVAL_MINUTES * 60
  }
}

/** Switch kind while keeping the fields the two kinds share. */
function switchRuleKind(rule: ScheduleWorkRule, kind: ScheduleWorkRule['kind']): ScheduleWorkRule {
  const time = rule.kind === 'daily' || rule.kind === 'weekly' || rule.kind === 'monthly'
    ? rule.time
    : clock('09:00')
  switch (kind) {
    case 'once': return rule.kind === 'once' ? rule : { kind: 'once', at: new Date(Date.now() + 3_600_000).toISOString() }
    case 'daily': return { kind: 'daily', time }
    case 'weekly': return rule.kind === 'weekly' ? rule : { kind: 'weekly', weekdays: [1], time }
    case 'monthly': return rule.kind === 'monthly' ? rule : { kind: 'monthly', days: [1], time }
    case 'interval': return rule.kind === 'interval' ? rule : { kind: 'interval', everySeconds: 60 * MIN_INTERVAL_MINUTES }
  }
}

/** RFC 3339 instant → datetime-local/date input value in the local zone. */
function toDateInput(instant: string | undefined): string {
  if (instant === undefined) return ''
  const at = new Date(instant)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/** Local end of the picked calendar day as an RFC 3339 instant. */
function endOfDayInstant(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString()
}
