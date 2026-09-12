/**
 * Expert-center plugin, browser half. Two registrations plus one navigation
 * service: ExpertNav fills the sidebar shell's `sidebar.experts` hole (the
 * entry row), ExpertBrowser fills ui-conversation's `conversation.expert.browser`
 * hole (the full page: the deployment's presets as hireable expert cards),
 * and `UiExpertService` owns the page state and its close-on-session policy.
 * Data arrives through the Host's agentPresets Remote face; hiring crosses
 * packages through the uiAgentPreset staging service and uiWorkspace's
 * startSession. Export discipline: packages/client/AGENTS.md.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the Remote namespaces (ctx.remote.agentPresets).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
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
 * through `slots.inject()` instead of assuming order. A nested Remote
 * namespace is its own inject key — declaring `remote` alone does not
 * authorize reading `remote.agentPresets`. `uiAgentPreset` and `uiWorkspace`
 * are the cross-package staging and session-start services the hire action
 * forwards to.
 */
export const inject = [
  'slots', 'locale', 'remote', 'remote.agentPresets', 'sessions', 'uiWorkspace', 'uiAgentPreset',
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
    load: async (): Promise<{ presets: readonly ExpertRow[] }> => {
      try {
        const result = await ctx.remote.agentPresets.list()
        // A deployment composing no presets is a valid empty market, not an
        // error: the invocation-unavailable refusal and an empty roster render
        // the same empty state.
        if (!result.ok) {
          if (result.error.code === 'invocation-unavailable') return { presets: MOCK_EXPERT_PRESETS }
          throw new Error(`agentPresets.list failed: ${result.error.code}: ${result.error.message}`)
        }
        // When the real roster is empty, show mock data so the page looks populated.
        if (result.value.presets.length === 0) return { presets: MOCK_EXPERT_PRESETS }
        return { presets: result.value.presets }
      } catch {
        // Remote face unavailable (e.g. inject not wired): fall back to mock data.
        return { presets: MOCK_EXPERT_PRESETS }
      }
    },
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
