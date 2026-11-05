/**
 * Expert-center plugin, browser half. Two registrations plus one navigation
 * service: ExpertNav fills the sidebar shell's `sidebar.experts` hole (the
 * entry row), ExpertBrowser fills ui-conversation's `conversation.expert.browser`
 * hole (the full page: the expert market as hireable expert cards), and
 * `UiExpertService` owns the page state and its close-on-session policy.
 * The market's sole source is roster rows that publish card metadata. Shipped
 * Standard, PTC, Minimal, and Creator presets publish `category`, so they are
 * experts here beside the other shipped experts. A row with no card metadata
 * stays out. Hiring crosses packages through the uiAgentPreset staging service and
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
import type { AgentPresetRow } from '@deepseek-ai/dsh-agent-preset-registry/types'
// The expert marker the market admits by — the same predicate the mode
// surfaces exclude by, so the two rules cannot drift. The display fold is
// the shared inline-safe home a client bundle may inline.
import { isExpertPreset, presetDisplayText, type BuiltInPresetCopyKey } from '@deepseek-ai/dsh-agent-preset-registry/display'
// Type-only: pulls the uiAgentPreset and uiWorkspace service merges.
import type { UiAgentPreset } from '@deepseek-ai/dsh-client-ui-agent-preset/client'
// Type-only: pulls the uiWorkspace service merges.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: pulls the Session root standard-props merge.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { UiExpertService } from './navigation.ts'
import type { ExpertRecord } from './contract/slots.ts'
import { ExpertBrowser } from './ExpertBrowser.tsx'
import { ExpertNav } from './ExpertNav.tsx'
import { de, en, es, fr, ja, pt, ru, zh, type ExpertKey } from './locales.ts'

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

/**
 * Project one roster row onto the market's card record.
 * Shipped preset ids keep the localized name; a row that publishes its own
 * name keeps that text.
 * @param preset - roster row the market admitted.
 * @param label - locale lookup for shipped preset copy.
 * @returns the card record.
 */
function recordOf(
  preset: AgentPresetRow,
  label: (key: BuiltInPresetCopyKey) => string,
): ExpertRecord {
  const text = presetDisplayText(preset, label)
  return {
    id: preset.id,
    name: text.name,
    // The roster row no longer carries a system/user trust bit, and the
    // preset remote no longer exposes deletion. Keep the card on the shipped
    // side so the remove control stays hidden.
    trust: 'system',
    ...(preset.subtitle !== undefined ? { subtitle: preset.subtitle } : {}),
    ...(preset.avatar !== undefined && preset.avatar !== '' ? { avatar: preset.avatar } : {}),
    ...(text.description !== undefined ? { description: text.description } : {}),
    ...(preset.category !== undefined ? { category: preset.category } : {}),
    ...(preset.tags !== undefined ? { tags: preset.tags } : {}),
    ...(preset.quickPrompts !== undefined ? { quickPrompts: preset.quickPrompts } : {}),
    ...(preset.badge !== undefined ? { badge: preset.badge } : {}),
    isDefault: preset.isDefault,
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
  const uiAgentPreset = ctx.get('uiAgentPreset') as UiAgentPreset
  const uiExpert = new UiExpertService(ctx, sessions, ctx.layout)
  ctx.effect(() => uiAgentPreset.bindExpertPage(() => { uiExpert.openPage() }), 'ui-expert: preset chip opens the page')
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-expert: dictionaries')

  const navInjected = () => ({
    openPage: () => { uiExpert.openPage() },
    closePage: () => { uiExpert.closePage() },
    hooks: { view: uiExpert.view },
  })

  const pageInjected = () => ({
    load: async (): Promise<{ experts: readonly ExpertRecord[] }> => {
      // The market admits rows the shared expert predicate matches, including
      // shipped presets that publish `category`. Names for those ids come from
      // the agent-preset dictionaries. A refused or absent roster read degrades
      // to an empty market; the page never fails on the market read.
      const label = ctx.locale.bind('settings.agentPreset')
      const shipped = await ctx.remote.agentPresets.list().then(
        (result): readonly ExpertRecord[] => (result.ok
          ? result.value.presets.filter(isExpertPreset).map(preset => recordOf(preset, label))
          : []),
        (): readonly ExpertRecord[] => [],
      )
      return { experts: shipped }
    },
    hire: (id: string) => {
      // Stage BEFORE closing the page. A refused stage means nothing will
      // compose the chat this hire promises, so leaving the page standing with
      // the reason is the honest answer — closing first would drop the user
      // into a chat running the deployment default, with nothing to explain it.
      if (!uiAgentPreset.stageNextSessionPreset(id)) {
        return ctx.locale.bind(NS)('card.hireUnavailable')
      }
      // The explicit close keeps the intent local; the service's own session
      // watcher would close the page on the resulting navigation anyway.
      uiExpert.closePage()
      // The pick is already staged, so the flow creates or reuses the blank
      // session and the seat composes it there. Staging first is what makes
      // that possible: the still-current session would refuse a swap.
      uiWorkspace.startSession()
      return undefined
    },
    remove: async (_id: string) => {
      // The preset remote no longer exposes deletion. The card hides this
      // action while every row is treated as shipped.
      return undefined
    },
    makeDefault: (id: string) => uiAgentPreset.makeDefault(id),
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
