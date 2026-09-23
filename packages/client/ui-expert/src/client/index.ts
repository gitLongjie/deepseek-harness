/**
 * Expert-center plugin, browser half. Two registrations plus one navigation
 * service: ExpertNav fills the sidebar shell's `sidebar.experts` hole (the
 * entry row), ExpertBrowser fills ui-conversation's `conversation.expert.browser`
 * hole (the full page: the expert market as hireable expert cards), and
 * `UiExpertService` owns the page state and its close-on-session policy.
 * The market's sole source is the experts the deployment ships — roster rows
 * that publish card metadata, delivered by the download channel as installed
 * expert packages; mode presets publish no card metadata and cannot present
 * here. Hiring crosses packages through the uiAgentPreset staging service and
 * uiWorkspace's startSession.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the Remote namespaces (ctx.remote.agentPresets).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: the shipped roster row shape the market admits experts from.
import type { AgentPresetRow } from '@deepseek-ai/dsh-agent-presets/types'
// The expert marker the market admits by — the same predicate the mode
// surfaces exclude by, so the two rules cannot drift. The display fold is
// the shared inline-safe home a client bundle may inline.
import { isExpertPreset } from '@deepseek-ai/dsh-agent-presets/display'
// Type-only: pulls the uiAgentPreset and uiWorkspace service merges.
import type {} from '@deepseek-ai/dsh-client-ui-agent-preset/client'
// Type-only: pulls the uiWorkspace service merges.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: pulls the Session root standard-props merge.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { UiExpertService } from './navigation.ts'
import type { ExpertRecord } from './contract/slots.ts'
import { ExpertBrowser } from './ExpertBrowser.tsx'
import { ExpertNav } from './ExpertNav.tsx'
import { en, zh, type ExpertKey } from './locales.ts'

export type { ExpertKey } from './locales.ts'
export type { ExpertBrowserProps, ExpertNavProps, ExpertRecord } from './contract/slots.ts'
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
  'slots', 'locale', 'remote', 'remote.agentPresets', 'sessions', 'layout', 'uiWorkspace', 'uiAgentPreset',
]

/** Project one shipped roster row onto the market's card record. */
function recordOf(preset: AgentPresetRow): ExpertRecord {
  return {
    id: preset.id,
    name: preset.name ?? preset.id,
    ...(preset.description !== undefined ? { description: preset.description } : {}),
    ...(preset.category !== undefined ? { category: preset.category } : {}),
    ...(preset.tags !== undefined ? { tags: preset.tags } : {}),
    ...(preset.quickPrompts !== undefined ? { quickPrompts: preset.quickPrompts } : {}),
    ...(preset.icon !== undefined && preset.icon !== '' ? { icon: preset.icon } : {}),
    // A row the host reported broken stays on the page: the market is the
    // only surface that advertises it, so the card carries the health
    // verdict instead of silently omitting an expert the deployment ships.
    ...(preset.broken !== undefined ? { broken: preset.broken } : {}),
  }
}

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
  const uiExpert = new UiExpertService(ctx, sessions, ctx.layout)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-expert: dictionaries')

  const navInjected = () => ({
    openPage: () => { uiExpert.openPage() },
    closePage: () => { uiExpert.closePage() },
    hooks: { view: uiExpert.view },
  })

  const pageInjected = () => ({
    load: async (): Promise<{ experts: readonly ExpertRecord[] }> => {
      // The market's only source is the roster: rows the shared expert
      // predicate admits — the same marker the mode surfaces exclude by, so
      // a preset presents here or as a mode, never both. A refused or absent
      // roster read degrades to an empty market; the page never fails on the
      // market read.
      const shipped = await ctx.remote.agentPresets.list().then(
        (result): readonly ExpertRecord[] => (result.ok
          ? result.value.presets.filter(isExpertPreset).map(recordOf)
          : []),
        (): readonly ExpertRecord[] => [],
      )
      return { experts: shipped }
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
