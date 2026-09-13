/**
 * Expert-center plugin, browser half. Two registrations plus one navigation
 * service: ExpertNav fills the sidebar shell's `sidebar.experts` hole (the
 * entry row), ExpertBrowser fills ui-conversation's `conversation.expert.browser`
 * hole (the full page: the expert market as hireable expert cards), and
 * `UiExpertService` owns the page state and its close-on-session policy.
 * The market's content is this package's own curated roster — the deployment's
 * agent-preset list stays in the preset surfaces, so mode presets never
 * present here as hireable experts. Hiring crosses packages through the
 * uiAgentPreset staging service and uiWorkspace's startSession. Export
 * discipline: packages/client/AGENTS.md.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the uiAgentPreset and uiWorkspace service merges.
import type {} from '@deepseek-ai/dsh-client-ui-agent-preset/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: pulls the Session root standard-props merge.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { UiExpertService } from './navigation.ts'
import type { ExpertRow } from './contract/slots.ts'
import { ExpertBrowser } from './ExpertBrowser.tsx'
import { ExpertNav } from './ExpertNav.tsx'
import { en, zh, type ExpertKey } from './locales.ts'
import { MOCK_EXPERT_PRESETS } from './mock-data.ts'

export type { ExpertKey } from './locales.ts'
export type { ExpertBrowserProps, ExpertNavProps, ExpertRow } from './contract/slots.ts'
export type { UiExpert } from './navigation.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Expert section and page copy. */
    expert: ExpertKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'expert'

/**
 * Required services (cordis fiber inject). The target slots are declared by
 * the ui-sidebar and ui-conversation applies, whose activation order relative
 * to this one is NOT constrained: apply therefore depends on each declaration
 * through `slots.inject()` instead of assuming order. `uiAgentPreset` and
 * `uiWorkspace` are the cross-package staging and session-start services the
 * hire action forwards to.
 */
export const inject = [
  'slots', 'locale', 'sessions', 'uiWorkspace', 'uiAgentPreset',
]

/**
 * Register the nav row and the page once their slot declarations are on the
 * ledger. The inject factories return plain callbacks; wire failures surface
 * as thrown errors the components render as their retry states.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  const sessions = ctx.get('sessions') as ISessions
  const uiWorkspace = ctx.get('uiWorkspace') as unknown as { startSession(workspaceId?: unknown): void }
  const uiAgentPreset = ctx.get('uiAgentPreset') as unknown as { stageNextSessionPreset(id: string): void }
  const uiExpert = new UiExpertService(ctx, sessions)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-expert: dictionaries')

  const navInjected = () => ({
    openPage: () => { uiExpert.openPage() },
    closePage: () => { uiExpert.closePage() },
    hooks: { view: uiExpert.view },
  })

  const pageInjected = () => ({
    // The market's content is this package's curated demo roster, never the
    // deployment's agent-preset list: mode presets (标准模式 and peers) belong
    // to the preset surfaces, and this page must not present them as
    // hireable experts.
    load: async (): Promise<{ presets: readonly ExpertRow[] }> => ({ presets: MOCK_EXPERT_PRESETS }),
    hire: (id: string) => {
      // The explicit close keeps the intent local; the service's own session
      // watcher would close the page on the resulting navigation anyway.
      uiExpert.closePage()
      // Stage BEFORE starting, mirroring the settings section's conversational
      // authoring entry: the still-current session would refuse a swap, so the
      // pick must be waiting when the flow creates or reuses the blank one.
      uiAgentPreset.stageNextSessionPreset(id)
      uiWorkspace.startSession()
    },
  })

  ctx.slots.inject('sidebar.experts', () => ctx.slots.register(
    {
      name: 'sidebar.experts',
      inject: navInjected,
      locale: NS,
    },
    ExpertNav,
  ))
  ctx.slots.inject('conversation.expert.browser', () => ctx.slots.register(
    {
      name: 'conversation.expert.browser',
      inject: pageInjected,
      locale: NS,
    },
    ExpertBrowser,
  ))
}
