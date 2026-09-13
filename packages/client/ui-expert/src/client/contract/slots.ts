/**
 * ui-expert contract: two occupants of host-declared holes plus the page's
 * reactive source. `ExpertNav` fills the sidebar shell's `sidebar.experts`
 * hole (the entry row); `ExpertBrowser` fills ui-conversation's
 * `conversation.expert.browser` hole (the full page: the expert market
 * presented as hireable expert cards). Market rows arrive through this
 * package's own inject factory; actions arrive through the navigation and
 * staging services. Export discipline: packages/client/AGENTS.md.
 */
import type { PropsHooks, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the roster row shape this package renders.
import type { AgentPresetRoster } from '@deepseek-ai/dsh-agent-presets/types'
// Type-only: pull the owner SlotMap merges into programs that resolve the
// runtime shares below (the browser hole is declared by ui-conversation).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the Session root standard-hook merge (GlobalStandardProps).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { ExpertPageState } from '../navigation.ts'

/** One roster row exactly as the host reports it. */
export type ExpertRow = AgentPresetRoster['presets'][number]

/**
 * The page-state reactive source the nav row binds: the open flag only. The
 * page itself renders while open and holds no page-level reactive state.
 */
export type ExpertViewInjected = {
  hooks: {
    view: {
      getSnapshot(): ExpertPageState
      subscribe(listener: () => void): () => void
    }
  }
}

/** Component-side view of the page-state source: the bound selector hook. */
export type ExpertViewHooks = PropsHooks<ExpertViewInjected['hooks']>

/** Nav-row-private injected share: the row toggles the expert page. */
export type ExpertNavInjected = {
  /** Open the expert page in the conversation area. */
  openPage: () => void
  /** Close the expert page; the session surface stands again. */
  closePage: () => void
}

/** Full nav-row props: shell owner share + page-state hook + injected action + the locale seat. */
export type ExpertNavProps =
  PropsRuntime<'sidebar.experts'>
  & ExpertNavInjected
  & ExpertViewHooks
  & PropsLocale<'expert'>

/** Page-private injected share: the market read and the hire action. */
export type ExpertBrowserInjected = {
  /**
   * Read the expert market's rows.
   * @returns the rows in display order; an empty list renders the page's
   *   empty state.
   */
  load: () => Promise<{ presets: readonly ExpertRow[] }>
  /**
   * Hire one expert: stage its preset for the NEXT session and start that
   * session. Closes the page; the session surface takes the conversation
   * area back.
   * @param id - the preset id the card's hire action forwards.
   */
  hire: (id: string) => void
}

/** Full page props: owner share + injected actions + the locale seat. */
export type ExpertBrowserProps =
  PropsRuntime<'conversation.expert.browser'>
  & ExpertBrowserInjected
  & PropsLocale<'expert'>
