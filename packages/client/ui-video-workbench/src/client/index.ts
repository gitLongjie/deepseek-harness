/**
 * Video workbench plugin, browser half. Two registrations over the layout's
 * global-panel mechanism: the sidebar rail row (id `video-workbench`) and the
 * matching keyed `main` entry rendering the project catalog. Data arrives from
 * the host plugin's read-only routes over the h3-video output directory; the
 * types are spelled here because a client package must not depend on a Host
 * package.
 */

import type { Context } from '@deepseek-ai/cordis'
import { createElement } from 'react'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the layout Context merge (ctx.layout) and the main slot.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the sidebar slot declaration this entry registers into.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { IconPlayOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { en, NS, zh, type VideoWorkbenchKey } from './locales.ts'
import { WORKBENCH_PROJECTS_PATH } from './endpoints.ts'
import { VideoWorkbenchPage, type VideoWorkbenchInjected, type VideoWorkbenchSummary } from './VideoWorkbenchPage.tsx'

export type { VideoWorkbenchKey } from './locales.ts'
export type {
  VideoWorkbenchInjected,
  VideoWorkbenchPageProps,
  VideoWorkbenchProject,
  VideoWorkbenchSegmentRow,
  VideoWorkbenchSummary,
} from './VideoWorkbenchPage.tsx'
export { workbenchFileUrl, WORKBENCH_PROJECTS_PATH } from './endpoints.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Video workbench page copy. */
    videoWorkbench: VideoWorkbenchKey
  }
}

/** Dictionary namespace owned by this plugin. */
export { NS } from './locales.ts'

/** The sidebar row id and the matching keyed main-panel key. */
export const PANEL_ID = 'video-workbench'

/** Panel row order: beside the scheduled-work row, before future rows. */
const PANEL_ORDER = 70

/**
 * Required services (cordis fiber inject). The target slots are declared by
 * ui-sidebar and ui-layout applies, whose activation order relative to this
 * one is NOT constrained: apply therefore depends on each declaration
 * through `slots.inject()` instead of assuming order.
 */
export const inject = ['slots', 'locale'] as const

/**
 * Register the sidebar panel row and the workbench page once their slot
 * declarations are on the ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-video-workbench: dictionaries')

  const injected: VideoWorkbenchInjected = {
    loadSummary: async () => {
      const response = await fetch(WORKBENCH_PROJECTS_PATH, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`video workbench listing failed with HTTP ${response.status}`)
      return await response.json() as VideoWorkbenchSummary
    },
  }

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    {
      name: 'sidebar.panellist',
      id: PANEL_ID,
      order: PANEL_ORDER,
      label: en.title,
      locale: NS,
    },
    // Icon-only cell: the sidebar shell owns the row button and its label.
    ({ size }: { size: number; active: boolean }) => createElement(IconPlayOutline16, { size }),
  ))

  ctx.slots.inject('main', () => ctx.slots.register(
    {
      name: 'main',
      key: PANEL_ID,
      inject: () => injected,
      locale: NS,
    },
    VideoWorkbenchPage,
  ))
}
