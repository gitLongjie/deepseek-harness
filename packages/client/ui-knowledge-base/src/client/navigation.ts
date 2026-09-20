/**
 * Cross-surface knowledge navigation: the knowledge-library page (base list
 * beside the document browser) shown in the conversation area, and the policy
 * that closes it. The page is ephemeral — it never survives a reload, and any
 * Session navigation (open, archive-clear, New Session) or global-panel
 * selection (the scheduled-work page) closes it, because the Session surface
 * and the global panels always win the conversation area.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import { defineStore, type StoreInstance } from '@deepseek-ai/dsh-client-store'
import type { KnowledgeBaseRow } from './contract/slots.ts'

/** Knowledge-page state published to the conversation area. */
export type KnowledgePageState = {
  /** Whether the knowledge page replaces the session surface. */
  open: boolean
  /** The base whose documents the page's browser pane shows, or undefined while none is picked. */
  base: KnowledgeBaseRow | undefined
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type KnowledgePageActions = {
  setOpen: (draft: KnowledgePageState, open: boolean) => void
  setBase: (draft: KnowledgePageState, base: KnowledgeBaseRow | undefined) => void
}

/**
 * Create the knowledge-page store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createKnowledgePageStore(): {
  create(): StoreInstance<KnowledgePageState, KnowledgePageActions>
} {
  const handle = defineStore({
    init: (): KnowledgePageState => ({ open: false, base: undefined }),
    actions: {
      setOpen: (d, open: boolean) => { d.open = open },
      setBase: (d, base: KnowledgeBaseRow | undefined) => { d.base = base },
    },
  })
  return { create: () => handle.create() }
}

/** Cross-surface knowledge-page navigation capability. */
export interface UiKnowledge {
  /**
   * Open the knowledge page (base list beside the document browser). Any
   * global panel and the expert page stand down first: the sidebar entries
   * switch the conversation area, they never stack.
   */
  openPage(): void
  /** Close the knowledge page; the session surface (hero or session) stands again. */
  closePage(): void
  /** Return from a base's documents to the base list (the page stays open). */
  closeBase(): void
  /**
   * Show one base's documents in the page's browser pane.
   * @param base - the base row to browse.
   */
  openBase(base: KnowledgeBaseRow): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Cross-surface knowledge-page navigation capability. */
    uiKnowledge: UiKnowledge
  }
}

/** Implements knowledge-page navigation and its session policy. */
export class UiKnowledgeService extends Service implements UiKnowledge {
  private readonly page: StoreInstance<KnowledgePageState, KnowledgePageActions>

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
    super(ctx, 'uiKnowledge')
    this.page = createKnowledgePageStore().create()
    ctx.effect(() => this.watchSessionNavigation(), 'ui-knowledge-base: page session policy')
    ctx.effect(() => this.watchPanelSelection(), 'ui-knowledge-base: page panel policy')
  }

  /** The page-state observable bound as the conversation area's `useKnowledgePage` hook. */
  get view(): StoreInstance<KnowledgePageState, KnowledgePageActions> {
    return this.page
  }

  openPage(): void {
    // The page lives in the conversation area, so a global panel (the
    // scheduled-work page) covering the column must stand down first.
    this.layout.selectPanel(null)
    // The expert page shares this area, and the sidebar entries switch it, so
    // the sibling stands down and the two pages never stack. Optional lookup:
    // ui-expert is an optional mount, the same per-use rule ui-conversation
    // applies to its view source.
    ;(this.ctx.get('uiExpert') as unknown as { closePage(): void } | undefined)?.closePage()
    this.page.actions.setOpen(true)
  }

  closePage(): void {
    this.page.actions.setOpen(false)
    this.page.actions.setBase(undefined)
  }

  closeBase(): void {
    this.page.actions.setBase(undefined)
  }

  openBase(base: KnowledgeBaseRow): void {
    this.page.actions.setOpen(true)
    this.page.actions.setBase(base)
  }

  /**
   * Any current-Session change — open, archive-clear, or New Session — closes
   * the page, so the Session surface is never found hidden under it.
   * @returns the subscription disposer.
   */
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

  /**
   * Any global-panel selection — the scheduled-work page — closes the page,
   * so its nav row never stays lit beside the panel row that replaced it.
   * Returning to the Conversation (null) leaves the page as it is.
   * @returns the subscription disposer.
   */
  private watchPanelSelection(): () => void {
    return this.layout.onPanelSelection((panelId) => {
      if (panelId !== null) this.closePage()
    })
  }
}
