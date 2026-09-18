// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ClockTime, ScheduleWorkRunId, ScheduleWorkRunRecord,
  ScheduleWorkTaskId, ScheduleWorkTaskView,
} from '@deepseek-ai/dsh-schedule-work/types'
import type {} from '../src/client/index.ts'
import { ScheduleWorkPage, type ScheduleWorkInjected } from '../src/client/ScheduleWorkPage.tsx'
import { ruleSummary, taskStatus } from '../src/client/task-format.ts'
import { en, zh, NS } from '../src/client/locales.ts'

/** Fixture-edge brandings; the wire brands have no runtime representation. */
const taskId = (value: string): ScheduleWorkTaskId => value as ScheduleWorkTaskId
const runId = (value: string): ScheduleWorkRunId => value as ScheduleWorkRunId
const clock = (value: string): ClockTime => value as ClockTime

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(Date.parse('2026-09-19T08:00:00Z'))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function taskView(overrides: Partial<ScheduleWorkTaskView> = {}): ScheduleWorkTaskView {
  return {
    id: taskId('schedule-work-task-1'),
    name: '资讯总结',
    prompt: '总结昨日重点资讯',
    fullAccess: false,
    rule: { kind: 'daily', time: clock('09:00') },
    enabled: true,
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z',
    nextRunAt: '2026-09-20T01:00:00.000Z',
    ...overrides,
  }
}

function runRecord(overrides: Partial<ScheduleWorkRunRecord> = {}): ScheduleWorkRunRecord {
  return {
    id: runId('schedule-work-run-1'),
    taskId: taskId('schedule-work-task-1'),
    sessionId: 'session-1' as ScheduleWorkRunRecord['sessionId'],
    startedAt: '2026-09-19T01:00:00.000Z',
    finishedAt: '2026-09-19T01:04:00.000Z',
    status: 'succeeded',
    ...overrides,
  }
}

function injected(overrides: Partial<ScheduleWorkInjected> = {}): ScheduleWorkInjected {
  return {
    load: vi.fn(async () => [taskView()]),
    listRuns: vi.fn(async () => []),
    create: vi.fn(async () => taskView()),
    update: vi.fn(async () => taskView()),
    remove: vi.fn(async () => 1),
    ...overrides,
  }
}

function props(scheduleWork: ScheduleWorkInjected, dictionary: typeof zh | typeof en = en) {
  const useWorkspaces = (select: (value: unknown) => unknown): unknown =>
    select({
      items: [
        { id: 'workspace-1', title: '项目新手指引' },
        { id: 'workspace-2', title: '市场观察' },
      ],
    })
  return { ...scheduleWork, useWorkspaces, t: makeTranslate(dictionary) } as unknown as Parameters<typeof ScheduleWorkPage>[0]
}

describe('ScheduleWorkPage tasks tab', () => {
  it('loads and renders the task catalog with summary, status, and next run', async () => {
    const scheduleWork = injected()
    render(<ScheduleWorkPage {...props(scheduleWork)} />)
    await waitFor(() => { expect(screen.getByText('资讯总结')).toBeDefined() })
    expect(screen.getByText('Daily 09:00')).toBeDefined()
    const row = screen.getByText('资讯总结').closest('li')
    expect(within(row!).getByText('Active')).toBeDefined()
    expect(scheduleWork.load).toHaveBeenCalledOnce()
  })

  it('shows the empty state when no tasks exist and the filtered state otherwise', async () => {
    const scheduleWork = injected({ load: vi.fn(async () => []) })
    const view = render(<ScheduleWorkPage {...props(scheduleWork)} />)
    await waitFor(() => { expect(screen.getByText('No scheduled tasks')).toBeDefined() })

    view.unmount()
    const populated = injected({ load: vi.fn(async () => [taskView()]) })
    const second = render(<ScheduleWorkPage {...props(populated)} />)
    await waitFor(() => { expect(screen.getByText('资讯总结')).toBeDefined() })
    fireEvent.change(screen.getByPlaceholderText('Search tasks or runs'), { target: { value: 'nothing-matches' } })
    expect(screen.getByText('No matching tasks')).toBeDefined()
    second.unmount()
  })

  it('filters by status and searches name and prompt', async () => {
    const tasks = [
      taskView(),
      taskView({
        id: taskId('schedule-work-task-2'),
        name: '周报归档',
        prompt: '归档本周周报',
        enabled: false,
        nextRunAt: null,
      }),
    ]
    const scheduleWork = injected({ load: vi.fn(async () => tasks) })
    render(<ScheduleWorkPage {...props(scheduleWork)} />)
    await waitFor(() => { expect(screen.getByText('周报归档')).toBeDefined() })

    fireEvent.change(screen.getByPlaceholderText('Search tasks or runs'), { target: { value: '周报' } })
    expect(screen.queryByText('资讯总结')).toBeNull()
    expect(screen.getByText('周报归档')).toBeDefined()

    fireEvent.change(screen.getByPlaceholderText('Search tasks or runs'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('All'), { target: { value: 'paused' } })
    expect(screen.queryByText('资讯总结')).toBeNull()
    const row = screen.getByText('周报归档').closest('li')
    expect(row).not.toBeNull()
    expect(within(row!).getAllByText('Paused').length).toBeGreaterThan(0)
  })

  it('pauses and resumes a task from its row action', async () => {
    const scheduleWork = injected()
    render(<ScheduleWorkPage {...props(scheduleWork)} />)
    await waitFor(() => { expect(screen.getByText('资讯总结')).toBeDefined() })
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    await waitFor(() => { expect(scheduleWork.update).toHaveBeenCalledWith('schedule-work-task-1', { enabled: false }) })
  })

  it('deletes a task from its row action', async () => {
    const scheduleWork = injected()
    render(<ScheduleWorkPage {...props(scheduleWork)} />)
    await waitFor(() => { expect(screen.getByText('资讯总结')).toBeDefined() })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => { expect(scheduleWork.remove).toHaveBeenCalledWith(['schedule-work-task-1']) })
  })

  it('batch-manages selected rows', async () => {
    const tasks = [
      taskView(),
      taskView({ id: taskId('schedule-work-task-2'), name: '周报归档', prompt: '归档', enabled: false, nextRunAt: null }),
    ]
    const scheduleWork = injected({ load: vi.fn(async () => tasks) })
    render(<ScheduleWorkPage {...props(scheduleWork)} />)
    await waitFor(() => { expect(screen.getByText('周报归档')).toBeDefined() })

    fireEvent.click(screen.getByRole('button', { name: 'Batch manage' }))
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0]!)
    fireEvent.click(checkboxes[1]!)
    expect(screen.getByText('2 selected')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    await waitFor(() => {
      expect(scheduleWork.update).toHaveBeenCalledWith('schedule-work-task-1', { enabled: false })
      expect(scheduleWork.update).toHaveBeenCalledWith('schedule-work-task-2', { enabled: false })
    })
  })

  it('surfaces the load failure with a retry', async () => {
    const scheduleWork = injected({ load: vi.fn(async () => { throw new Error('down') }) })
    render(<ScheduleWorkPage {...props(scheduleWork)} />)
    await waitFor(() => { expect(screen.getByText('Failed to load. Try again later.')).toBeDefined() })
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined()
  })
})

describe('ScheduleWorkPage editor dialog', () => {
  it('creates a task through the dialog', async () => {
    const scheduleWork = injected()
    render(<ScheduleWorkPage {...props(scheduleWork)} />)
    await waitFor(() => { expect(screen.getByText('资讯总结')).toBeDefined() })

    fireEvent.click(screen.getByRole('button', { name: 'Add task' }))
    const dialog = screen.getByRole('dialog', { name: 'Add scheduled task' })
    fireEvent.change(within(dialog).getByPlaceholderText('Enter a task name'), { target: { value: '每日站会纪要' } })
    fireEvent.change(within(dialog).getByPlaceholderText('Add a prompt'), { target: { value: '整理昨日纪要' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'OK' }))
    await waitFor(() => {
      expect(scheduleWork.create).toHaveBeenCalledWith(expect.objectContaining({
        name: '每日站会纪要',
        prompt: '整理昨日纪要',
        rule: { kind: 'daily', time: clock('09:00') },
        validUntil: null,
      }))
    })
  })

  it('edits the existing task with prefilled fields', async () => {
    const scheduleWork = injected()
    render(<ScheduleWorkPage {...props(scheduleWork)} />)
    await waitFor(() => { expect(screen.getByText('资讯总结')).toBeDefined() })

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit scheduled task' })
    const name = within(dialog).getByPlaceholderText('Enter a task name') as HTMLInputElement
    expect(name.value).toBe('资讯总结')
    fireEvent.change(name, { target: { value: '晨间资讯' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'OK' }))
    await waitFor(() => {
      expect(scheduleWork.update).toHaveBeenCalledWith('schedule-work-task-1', expect.objectContaining({ name: '晨间资讯' }))
    })
  })

  it('renders the workspace options from the global hook', async () => {
    const scheduleWork = injected()
    render(<ScheduleWorkPage {...props(scheduleWork)} />)
    await waitFor(() => { expect(screen.getByText('资讯总结')).toBeDefined() })
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }))
    const dialog = screen.getByRole('dialog', { name: 'Add scheduled task' })
    const options = within(dialog).getAllByRole('option').map(option => option.textContent)
    expect(options).toContain('项目新手指引')
    expect(options).toContain('Default (none)')
  })
})

describe('ScheduleWorkPage runs tab', () => {
  it('renders run records with task names and status', async () => {
    const scheduleWork = injected({
      listRuns: vi.fn(async () => [
        runRecord(),
        runRecord({ id: runId('schedule-work-run-2'), status: 'failed', error: 'agent busy', sessionId: undefined }),
      ]),
    })
    render(<ScheduleWorkPage {...props(scheduleWork)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Run records' }))
    await waitFor(() => { expect(screen.getByText('agent busy')).toBeDefined() })
    expect(screen.getByText('Succeeded')).toBeDefined()
    expect(screen.getByText('Failed')).toBeDefined()
    expect(screen.getAllByText('资讯总结').length).toBeGreaterThan(0)
  })

  it('shows the run-records empty state', async () => {
    const scheduleWork = injected()
    render(<ScheduleWorkPage {...props(scheduleWork)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Run records' }))
    await waitFor(() => { expect(screen.getByText('No run records')).toBeDefined() })
  })
})

describe('task-format', () => {
  const tEn = makeTranslate(en) as unknown as TranslateNS<typeof NS>
  const tZh = makeTranslate(zh) as unknown as TranslateNS<typeof NS>

  it('summarizes every rule kind in both dictionaries', () => {
    expect(ruleSummary({ kind: 'once', at: '2026-09-19T00:32:00Z' }, tEn)).toMatch(/^Once /)
    expect(ruleSummary({ kind: 'daily', time: clock('09:00') }, tZh)).toBe('每天 09:00')
    expect(ruleSummary({ kind: 'weekly', weekdays: [1, 3], time: clock('08:30') }, tZh)).toBe('每周 周一 周三 08:30')
    expect(ruleSummary({ kind: 'weekly', weekdays: [1, 3], time: clock('08:30') }, tEn)).toBe('Weekly on Mon Wed 08:30')
    expect(ruleSummary({ kind: 'monthly', days: [1], time: clock('09:00') }, tZh)).toBe('每月 1 日 09:00')
    expect(ruleSummary({ kind: 'interval', everySeconds: 7_200 }, tEn)).toBe('Every 2 hours')
    expect(ruleSummary({ kind: 'interval', everySeconds: 300 }, tZh)).toBe('每 5 分钟')
  })

  it('derives the display status with paused winning over expiry', () => {
    expect(taskStatus(taskView())).toBe('active')
    expect(taskStatus(taskView({ enabled: false }))).toBe('paused')
    expect(taskStatus(taskView({ enabled: false, nextRunAt: null }))).toBe('paused')
    expect(taskStatus(taskView({ nextRunAt: null }))).toBe('ended')
  })

  it('keeps both dictionaries key-identical', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })
})
