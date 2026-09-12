/**
 * Expert-page navigation: the page state for the expert browser shown in the
 * conversation area, and the policy that closes it. The page is ephemeral —
 * it never survives a reload, and any Session navigation (open,
 * archive-clear, New Session) closes it, because the Session surface always
 * wins the conversation area. Mirrors the knowledge page's navigation
 * service; the two pages are independent, and ui-conversation renders the
 * expert page ahead of the knowledge one should both ever stand.
 * @module @deepseek-ai/dsh-client-ui-expert/client/navigation
 */
import { Context, Service } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { defineStore, type StoreInstance } from '@deepseek-ai/dsh-client-store'

/** Expert-page state published to the conversation area. */
export type ExpertPageState = {
  /** Whether the expert page replaces the session surface. */
  open: boolean
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type ExpertPageActions = {
  setOpen: (draft: ExpertPageState, open: boolean) => void
}

/**
 * Create the expert-page store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createExpertPageStore(): {
  create(): StoreInstance<ExpertPageState, ExpertPageActions>
} {
  const handle = defineStore({
    init: (): ExpertPageState => ({ open: false }),
    actions: {
      setOpen: (d, open: boolean) => { d.open = open },
    },
  })
  return { create: () => handle.create() }
}

/** Cross-surface expert-page navigation capability. */
export interface UiExpert {
  /** Open the expert page (the market over the deployment's presets). */
  openPage(): void
  /** Close the expert page; the session surface (hero or session) stands again. */
  closePage(): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Cross-surface expert-page navigation capability. */
    uiExpert: UiExpert
  }
}

/** Implements expert-page navigation and its session policy. */
export class UiExpertService extends Service implements UiExpert {
  private readonly page: StoreInstance<ExpertPageState, ExpertPageActions>

  /**
   * @param ctx - Client root Context.
   * @param sessions - pure Session Controller, for the close-on-navigation policy.
   */
  constructor(
    ctx: Context,
    private readonly sessions: ISessions,
  ) {
    super(ctx, 'uiExpert')
    this.page = createExpertPageStore().create()
    ctx.effect(() => this.watchSessionNavigation(), 'ui-expert: page session policy')
  }

  /** The page-state observable bound as the conversation area's `useExpertView` hook. */
  get view(): StoreInstance<ExpertPageState, ExpertPageActions> {
    return this.page
  }

  openPage(): void {
    this.page.actions.setOpen(true)
  }

  closePage(): void {
    this.page.actions.setOpen(false)
  }

  /**
   * Any current-Session change — open, archive-clear, or New Session — closes
   * the page, so the Session surface is never found hidden under it. The body
   * deliberately mirrors the knowledge page's policy (ui-knowledge-base
   * navigation.ts): the two pages close for the same reason, under the same
   * session-list fact, and sharing a helper across feature plugins would
   * couple them for fifteen lines.
   * @returns the subscription disposer.
   */
  /* jscpd:ignore-start */
  private watchSessionNavigation(): () => void {
    let last = this.sessions.list.getSnapshot().current
    const dispose = this.sessions.list.subscribe(() => {
      const current = this.sessions.list.getSnapshot().current
      if (current === last) return
      last = current
      this.closePage()
    })
    return dispose
  }
  /* jscpd:ignore-end */
}
