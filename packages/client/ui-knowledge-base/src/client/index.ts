/**
 * Knowledge-base plugin, browser half. Two registrations plus one navigation
 * service: KnowledgeNav fills the sidebar shell's `sidebar.knowledge` hole
 * (the entry row), KnowledgeLibrary fills ui-conversation's
 * `conversation.knowledge.browser` hole (the full page: base list beside the
 * document browser), and `UiKnowledgeService` owns the page state and its
 * close-on-session policy. Data arrives through the Host's knowledgeBase
 * Remote face. Export discipline: packages/client/AGENTS.md.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the Controller service merges.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the Remote namespaces (ctx.remote.knowledgeBase).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the Session root standard-props merge.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { UiKnowledgeService } from './navigation.ts'
import type { KnowledgeBaseRow } from './contract/slots.ts'
import {
  KnowledgeLibrary,
} from './KnowledgeLibrary.tsx'
import { KnowledgeNav } from './KnowledgeNav.tsx'
import { en, zh, type KnowledgeKey } from './locales.ts'

export type { KnowledgeKey } from './locales.ts'
export type {
  KnowledgeBaseRow, KnowledgeDocumentRow, KnowledgeLibraryProps, KnowledgeNavProps,
} from './contract/slots.ts'
export type { UiKnowledge } from './navigation.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Knowledge-base section and page copy. */
    knowledge: KnowledgeKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'knowledge'

/**
 * Required services (cordis fiber inject). The target slots are declared by
 * the ui-sidebar and ui-conversation applies, whose activation order relative
 * to this one is NOT constrained: apply therefore depends on each declaration
 * through `slots.inject()` instead of assuming order.
 */
export const inject = ['slots', 'locale', 'remote', 'remote.knowledgeBase', 'uiWorkspace', 'sessions']

/**
 * Register the nav row and the page once their slot declarations are on the
 * ledger. The inject factories return plain callbacks; wire failures surface
 * as thrown errors the components render as their retry states.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  const workspaceNavigation = ctx.get('uiWorkspace') as unknown as { startSession(workspaceId?: unknown): void }
  const sessions = ctx.get('sessions') as ISessions
  const uiKnowledge = new UiKnowledgeService(ctx, sessions)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-knowledge-base: dictionaries')

  type CallResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
  const call = async <T>(namespace: string, operation: () => Promise<CallResult<T>>): Promise<T> => {
    const result = await operation()
    if (!result.ok) throw new Error(`${namespace} failed: ${result.error.code}: ${result.error.message}`)
    return result.value
  }

  const navInjected = () => ({
    openPage: () => { uiKnowledge.openPage() },
    closePage: () => { uiKnowledge.closePage() },
    hooks: { view: uiKnowledge.view },
  })

  const pageInjected = () => ({
    load: async () => {
      // A describe failure degrades to a hidden manage action; only a list
      // failure turns the page into its retry state.
      const [list, describe] = await Promise.all([
        call('knowledgeBase.list', () => ctx.remote.knowledgeBase.list()),
        call('knowledgeBase.describe', () => ctx.remote.knowledgeBase.describe()).catch(() => ({ webUiUrl: null })),
      ])
      return { bases: list.bases, webUiUrl: describe.webUiUrl }
    },
    listDocuments: async (baseId: string, keyword?: string) => {
      const page = await call('knowledgeBase.listDocuments', () => ctx.remote.knowledgeBase.listDocuments({
        baseId: baseId as never,
        ...(keyword === undefined || keyword === '' ? {} : { query: { keyword } }),
      }))
      return { documents: page.documents, total: page.total }
    },
    startSession: () => {
      // The session watcher in UiKnowledgeService closes the page on the
      // resulting navigation; the explicit close keeps the intent local.
      uiKnowledge.closePage()
      workspaceNavigation.startSession()
    },
    closeBase: () => { uiKnowledge.closeBase() },
    openBase: (base: KnowledgeBaseRow) => { uiKnowledge.openBase(base) },
    hooks: { view: uiKnowledge.view },
  })

  ctx.slots.inject('sidebar.knowledge', () => ctx.slots.register(
    {
      name: 'sidebar.knowledge',
      inject: navInjected,
      locale: NS,
    },
    KnowledgeNav,
  ))
  ctx.slots.inject('conversation.knowledge.browser', () => ctx.slots.register(
    {
      name: 'conversation.knowledge.browser',
      inject: pageInjected,
      locale: NS,
    },
    KnowledgeLibrary,
  ))
}
