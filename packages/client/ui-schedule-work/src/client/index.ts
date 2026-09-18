/**
 * Scheduled-work management plugin, browser half. Two registrations: the
 * global panel row in the sidebar rail (id `schedule-work`) and the matching
 * keyed `main` entry rendering the management page. Data arrives through the
 * Host's scheduleWork Remote face. Export discipline: packages/client/AGENTS.md.
 */
import type { Context } from '@deepseek-ai/cordis'
import { createElement } from 'react'
// Type-only: pulls the Remote namespaces (ctx.remote.scheduleWork).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the useWorkspaces standard-prop merge.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the layout Context merge (ctx.layout) and the main slot.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the sidebar slot declaration this entry registers into.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { IconAlarmClockOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ScheduleWorkTaskInput } from '@deepseek-ai/dsh-schedule-work/types'
import { en, zh, type ScheduleWorkKey } from './locales.ts'
import { ScheduleWorkPage } from './ScheduleWorkPage.tsx'

export type { ScheduleWorkKey } from './locales.ts'
export type { ScheduleWorkInjected, ScheduleWorkPageProps } from './ScheduleWorkPage.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Scheduled-work page and dialog copy. */
    scheduleWork: ScheduleWorkKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'scheduleWork'

/** The sidebar row id and the matching keyed main-panel key. */
export const PANEL_ID = 'schedule-work'

/** Panel row order: after the conversation-reserved first position, before future rows. */
const PANEL_ORDER = 60

/**
 * Required services (cordis fiber inject). The target slots are declared by
 * ui-sidebar and ui-layout applies, whose activation order relative to this
 * one is NOT constrained: apply therefore depends on each declaration
 * through `slots.inject()` instead of assuming order.
 */
export const inject = ['slots', 'locale', 'remote', 'remote.scheduleWork']

/**
 * Register the sidebar panel row and the management page once their slot
 * declarations are on the ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-schedule-work: dictionaries')

  // The panel row's label re-reads on every sidebar projection, so the
  // localized name follows the active locale without re-registration.
  const navLabel = (): string => {
    const dictionary = ctx.locale.getSnapshot().active === 'en' ? en : zh
    return dictionary['nav.label']
  }

  type CallResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
  const call = async <T>(operation: string, run: () => Promise<CallResult<T>>): Promise<T> => {
    const result = await run()
    if (!result.ok) throw new Error(`${operation} failed: ${result.error.code}: ${result.error.message}`)
    return result.value
  }

  const pageInjected = () => ({
    load: async () => call('scheduleWork.list', () => ctx.remote.scheduleWork.list()).then(value => value.tasks),
    listRuns: async (taskId?: string) => call(
      'scheduleWork.listRuns',
      () => ctx.remote.scheduleWork.listRuns(taskId === undefined ? {} : { taskId }),
    ).then(value => value.runs),
    create: async (input: ScheduleWorkTaskInput) =>
      call('scheduleWork.create', () => ctx.remote.scheduleWork.create(input)),
    update: async (id: string, patch: Partial<ScheduleWorkTaskInput>) =>
      call('scheduleWork.update', () => ctx.remote.scheduleWork.update({ id, patch })),
    remove: async (ids: readonly string[]) =>
      call('scheduleWork.removeTasks', () => ctx.remote.scheduleWork.removeTasks({ ids })).then(value => value.removed),
  })

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    {
      name: 'sidebar.panellist',
      id: PANEL_ID,
      order: PANEL_ORDER,
      label: navLabel,
      locale: NS,
    },
    // Icon-only cell: the sidebar shell owns the row button and its label.
    ({ size }: { size: number; active: boolean }) => createElement(IconAlarmClockOutline16, { size }),
  ))

  ctx.slots.inject('main', () => ctx.slots.register(
    {
      name: 'main',
      key: PANEL_ID,
      inject: pageInjected,
      locale: NS,
    },
    ScheduleWorkPage,
  ))
}
