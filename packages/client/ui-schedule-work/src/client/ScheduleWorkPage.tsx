/**
 * The scheduled-work management page: the task catalog with status filter,
 * search, refresh, batch management, and the add/edit dialog, plus the run
 * records tab. All data arrives through the injected scheduleWork Remote
 * face; this component holds only presentation and interaction state.
 * @module
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ScheduleWorkRunRecord, ScheduleWorkTaskInput, ScheduleWorkTaskView } from '@deepseek-ai/dsh-schedule-work/types'
import { IconAlarmClockOutline16, Button, Input, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import { formatDateTime, formatTime, ruleSummary, taskStatus } from './task-format.ts'
import type { WorkspaceOption } from './TaskEditor.tsx'
import { TaskEditor } from './TaskEditor.tsx'
import css from './ScheduleWorkPage.module.css'

/**
 * Services injected by the plugin entry: one method per scheduleWork Remote
 * operation. Members are flattened into the page props by the slot runtime.
 */
export interface ScheduleWorkInjected {
  /** Load every task view, newest first. */
  load: () => Promise<readonly ScheduleWorkTaskView[]>
  /** Load run records, newest first; optional task filter. */
  listRuns: (taskId?: string) => Promise<readonly ScheduleWorkRunRecord[]>
  /** Create a task from editor input. */
  create: (input: ScheduleWorkTaskInput) => Promise<ScheduleWorkTaskView>
  /** Edit one task. */
  update: (id: string, patch: Partial<ScheduleWorkTaskInput>) => Promise<ScheduleWorkTaskView>
  /** Remove tasks; returns how many were removed. */
  remove: (ids: readonly string[]) => Promise<number>
}

/** Full page props: main-slot runtime share (with the global useWorkspaces hook), the injected face, and the locale seat. */
export type ScheduleWorkPageProps =
  & PropsRuntime<'main'>
  & ScheduleWorkInjected
  & PropsLocale<typeof NS>

/** Which catalog tab is showing. */
type Tab = 'tasks' | 'runs'
/** Status filter of the task tab. */
type StatusFilter = 'all' | 'active' | 'paused'
/** Dialog state: closed, creating, or editing one task. */
type EditorState = { mode: 'create' } | { mode: 'edit'; task: ScheduleWorkTaskView } | null

/** The scheduled-work management page. */
export function ScheduleWorkPage({ load, listRuns, create, update, remove, useWorkspaces, t }: ScheduleWorkPageProps) {
  const [tab, setTab] = useState<Tab>('tasks')
  const [tasks, setTasks] = useState<readonly ScheduleWorkTaskView[] | null>(null)
  const [runs, setRuns] = useState<readonly ScheduleWorkRunRecord[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [batchMode, setBatchMode] = useState(false)
  const [selected, setSelected] = useState<readonly string[]>([])
  const [editor, setEditor] = useState<EditorState>(null)
  const [submitError, setSubmitError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const workspaceItems = useWorkspaces(snapshot => snapshot.items)
  const workspaces: readonly WorkspaceOption[] = workspaceItems.map(workspace => ({
    id: workspace.workspaceId,
    title: workspace.title,
  }))

  const reload = useCallback(async (): Promise<void> => {
    try {
      setLoadFailed(false)
      const [nextTasks, nextRuns] = await Promise.all([load(), listRuns()])
      setTasks(nextTasks)
      setRuns(nextRuns)
    } catch {
      setLoadFailed(true)
    }
  }, [load, listRuns])

  useEffect(() => { void reload() }, [reload])

  const taskName = useCallback((taskId: string): string =>
    tasks?.find(task => task.id === taskId)?.name ?? taskId, [tasks])

  const visibleTasks = useMemo(() => {
    if (tasks === null) return []
    const query = search.trim().toLowerCase()
    return tasks.filter((task) => {
      if (filter === 'active' && taskStatus(task) !== 'active') return false
      if (filter === 'paused' && taskStatus(task) !== 'paused') return false
      if (query !== '') {
        const haystack = `${task.name}\n${task.prompt}`.toLowerCase()
        if (!haystack.includes(query)) return false
      }
      return true
    })
  }, [tasks, filter, search])

  const toggleSelected = (id: string): void => {
    setSelected(current => current.includes(id)
      ? current.filter(value => value !== id)
      : [...current, id])
  }

  const runBatch = async (action: 'pause' | 'resume' | 'delete'): Promise<void> => {
    if (selected.length === 0 || busy) return
    setBusy(true)
    try {
      if (action === 'delete') {
        await remove(selected)
      } else {
        for (const id of selected) {
          await update(id, { enabled: action === 'resume' })
        }
      }
      setSelected([])
      setBatchMode(false)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const toggleEnabled = async (task: ScheduleWorkTaskView): Promise<void> => {
    setBusy(true)
    try {
      await update(task.id, { enabled: !task.enabled })
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const deleteTask = async (task: ScheduleWorkTaskView): Promise<void> => {
    setBusy(true)
    try {
      await remove([task.id])
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const submitEditor = async (input: ScheduleWorkTaskInput): Promise<void> => {
    setSubmitError(undefined)
    try {
      if (editor?.mode === 'edit') await update(editor.task.id, input)
      else await create(input)
      setEditor(null)
      await reload()
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className={css.page}>
      <header className={css.toolbar}>
        <nav className={css.tabs} aria-label={t('nav.label')}>
          <button
            type="button"
            className={tab === 'tasks' ? `${css.tab} ${css.tabOn}` : css.tab}
            aria-current={tab === 'tasks' ? 'page' : undefined}
            onClick={() => { setTab('tasks') }}
          >
            {t('tab.tasks')}
          </button>
          <button
            type="button"
            className={tab === 'runs' ? `${css.tab} ${css.tabOn}` : css.tab}
            aria-current={tab === 'runs' ? 'page' : undefined}
            onClick={() => { setTab('runs') }}
          >
            {t('tab.runs')}
          </button>
        </nav>
        <div className={css.toolbarControls}>
          {tab === 'tasks' && (
            <select
              className={css.filterSelect}
              aria-label={t('filter.all')}
              value={filter}
              onChange={(event) => { setFilter(event.currentTarget.value as StatusFilter) }}
            >
              <option value="all">{t('filter.all')}</option>
              <option value="active">{t('filter.active')}</option>
              <option value="paused">{t('filter.paused')}</option>
            </select>
          )}
          <Input
            type="search"
            className={css.search ?? ''}
            placeholder={t('search.placeholder')}
            value={search}
            onChange={(event) => { setSearch(event.currentTarget.value) }}
          />
          <Button size="sm" onClick={() => { void reload() }} aria-label={t('action.refresh')}>
            {t('action.refresh')}
          </Button>
          {tab === 'tasks' && (
            <Button
              size="sm"
              onClick={() => {
                setBatchMode(current => !current)
                setSelected([])
              }}
            >
              {batchMode ? t('action.batchExit') : t('action.batch')}
            </Button>
          )}
          {tab === 'tasks' && (
            <Button size="sm" variant="primary" onClick={() => { setSubmitError(undefined); setEditor({ mode: 'create' }) }}>
              {t('action.add')}
            </Button>
          )}
        </div>
      </header>

      {batchMode && tab === 'tasks' && (
        <div className={css.batchBar}>
          <span>{t('batch.selected', { count: selected.length })}</span>
          <Button size="sm" disabled={selected.length === 0 || busy} onClick={() => { void runBatch('pause') }}>
            {t('action.pause')}
          </Button>
          <Button size="sm" disabled={selected.length === 0 || busy} onClick={() => { void runBatch('resume') }}>
            {t('action.resume')}
          </Button>
          <Button size="sm" variant="outline" disabled={selected.length === 0 || busy} onClick={() => { void runBatch('delete') }}>
            {t('action.delete')}
          </Button>
        </div>
      )}

      {loadFailed && (
        <div className={css.errorState}>
          <p>{t('error.load')}</p>
          <Button size="sm" onClick={() => { void reload() }}>{t('action.retry')}</Button>
        </div>
      )}

      {tab === 'tasks' && tasks !== null && !loadFailed && (
        visibleTasks.length === 0
          ? <EmptyState label={tasks.length === 0 ? t('empty.tasks') : t('empty.tasksFiltered')} />
          : (
            <ul className={css.list}>
              {visibleTasks.map((task) => {
                const status = taskStatus(task)
                const statusLabel = t(status === 'active' ? 'status.active' : status === 'paused' ? 'status.paused' : 'status.ended')
                return (
                  <li key={task.id} className={css.row}>
                    {batchMode && (
                      <input
                        type="checkbox"
                        className={css.checkbox}
                        aria-label={task.name}
                        checked={selected.includes(task.id)}
                        onChange={() => { toggleSelected(task.id) }}
                      />
                    )}
                    <div className={css.rowBody}>
                      <div className={css.rowTitleLine}>
                        <span className={css.rowTitle}>{task.name}</span>
                        <span className={css.rowMeta}>{ruleSummary(task.rule, t)}</span>
                        {task.nextRunAt !== null && task.enabled && (
                          <span className={css.rowMeta}>{t('summary.next', { datetime: formatDateTime(task.nextRunAt) })}</span>
                        )}
                        <span className={`${css.status} ${css[status]}`}>
                          <StateDot state={status === 'active' ? 'ongoing' : 'idle'} />
                          {statusLabel}
                        </span>
                      </div>
                      {task.prompt !== task.name && <p className={css.rowPrompt}>{task.prompt}</p>}
                    </div>
                    {!batchMode && (
                      <div className={css.rowActions}>
                        <Button size="sm" onClick={() => { setSubmitError(undefined); setEditor({ mode: 'edit', task }) }}>
                          {t('action.edit')}
                        </Button>
                        <Button size="sm" disabled={busy} onClick={() => { void toggleEnabled(task) }}>
                          {task.enabled ? t('action.pause') : t('action.resume')}
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => { void deleteTask(task) }}>
                          {t('action.delete')}
                        </Button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )
      )}

      {tab === 'runs' && runs !== null && !loadFailed && (
        runs.length === 0
          ? <EmptyState label={t('empty.runs')} />
          : (
            <ul className={css.list}>
              {runs.map((run) => {
                const statusLabel = t(`run.status.${run.status}`)
                return (
                  <li key={run.id} className={css.row}>
                    <span className={`${css.runDot} ${css[run.status]}`}>
                      <StateDot state={run.status === 'succeeded' ? 'done' : run.status === 'failed' ? 'error' : 'ongoing'} />
                    </span>
                    <div className={css.rowBody}>
                      <div className={css.rowTitleLine}>
                        <span className={css.rowTitle}>{taskName(run.taskId)}</span>
                        <span className={css.rowMeta}>{formatDateTime(run.startedAt)} · {formatTime(run.finishedAt ?? run.startedAt)}</span>
                        <span className={`${css.status} ${css[run.status === 'succeeded' ? 'active' : run.status === 'failed' ? 'ended' : 'paused']}`}>
                          {statusLabel}
                        </span>
                      </div>
                      {run.error !== undefined && <p className={css.runError}>{run.error}</p>}
                    </div>
                  </li>
                )
              })}
            </ul>
          )
      )}

      {editor !== null && (
        <TaskEditor
          mode={editor.mode}
          initial={editor.mode === 'edit' ? editor.task : undefined}
          workspaces={workspaces}
          t={t}
          submitError={submitError}
          onCancel={() => { setEditor(null) }}
          onSubmit={submitEditor}
        />
      )}
    </div>
  )
}

/** Shared empty-state body. */
function EmptyState({ label }: { label: string }) {
  return (
    <div className={css.empty}>
      <IconAlarmClockOutline16 size={48} />
      <p>{label}</p>
    </div>
  )
}
