/**
 * Expert-page navigation: the page state for the expert browser shown in the
 * conversation area, and the policy that closes it. The page is ephemeral —
 * it never survives a reload, and any Session navigation (open,
 * archive-clear, New Session) or global-panel selection (the scheduled-work
 * page) closes it, because the Session surface and the global panels always
 * win the conversation area. Mirrors the knowledge page's navigation
 * service: the two pages stand each other down on open — the sidebar entries
 * switch the conversation area, they never stack — and ui-conversation still
 * renders the expert page ahead of the knowledge one should both ever stand
 * (defense only).
 * @module @deepseek-ai/dsh-client-ui-expert/client/navigation
 */
import { Context, Service } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
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
  /**
   * Open the expert page (the market over the deployment's presets). Any
   * global panel and the knowledge page stand down first: the sidebar
   * entries switch the conversation area, they never stack.
   */
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
   * @param layout - panel actions, so opening the page leaves any global panel.
   */
  constructor(
    ctx: Context,
    private readonly sessions: ISessions,
    private readonly layout: ILayout,
  ) {
    super(ctx, 'uiExpert')
    this.page = createExpertPageStore().create()
    ctx.effect(() => this.watchSessionNavigation(), 'ui-expert: page session policy')
    ctx.effect(() => this.watchPanelSelection(), 'ui-expert: page panel policy')
  }

  /** The page-state observable bound as the conversation area's `useExpertView` hook. */
  get view(): StoreInstance<ExpertPageState, ExpertPageActions> {
    return this.page
  }

  openPage(): void {
    // The page lives in the conversation area, so a global panel (the
    // scheduled-work page) covering the column must stand down first.
    this.layout.selectPanel(null)
    // The knowledge page shares this area, and the sidebar entries switch it,
    // so the sibling stands down and the two pages never stack. Optional
    // lookup: ui-knowledge-base is an optional mount, the same per-use rule
    // ui-conversation applies to its view source.
    ;(this.ctx.get('uiKnowledge') as unknown as { closePage(): void } | undefined)?.closePage()
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

  /**
   * Any global-panel selection — the scheduled-work page — closes the page,
   * so its nav row never stays lit beside the panel row that replaced it.
   * Returning to the Conversation (null) leaves the page as it is. The body
   * mirrors the knowledge page's policy (ui-knowledge-base navigation.ts):
   * the two pages close for the same reason, under the same layout fact.
   * @returns the subscription disposer.
   */
  private watchPanelSelection(): () => void {
    return this.layout.onPanelSelection((panelId) => {
      if (panelId !== null) this.closePage()
    })
  }
}
