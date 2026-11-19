/**
 * Scheduled-work dictionaries. The sidebar row and management page are not
 * mounted: Automation tasks is the left-sidebar scheduling entry, and a second
 * 定时工作 row under More conflicts with it. Export discipline: packages/client/AGENTS.md.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { en, zh, type ScheduleWorkKey } from './locales.ts'

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

/** Required services (cordis fiber inject). */
export const inject = ['locale']

/**
 * Register the scheduled-work dictionaries. No sidebar row and no main page.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-schedule-work: dictionaries')
}
