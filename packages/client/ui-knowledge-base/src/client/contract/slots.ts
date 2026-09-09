/**
 * ui-knowledge-base contract: two occupants of host-declared holes plus their
 * per-entry reactive sources. `KnowledgeNav` fills the sidebar shell's
 * `sidebar.knowledge` hole (the entry row); `KnowledgeLibrary` fills
 * ui-conversation's `conversation.knowledge.browser` hole (the full page:
 * base list beside the document browser). Business data and actions arrive
 * through this package's own inject factories over the Host's knowledgeBase
 * Remote face and the navigation service. Export discipline:
 * packages/client/AGENTS.md.
 */
import type { PropsHooks, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pull the owner SlotMap merges into programs that resolve the
// runtime share below (the browser hole is declared by ui-conversation).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the Session root standard-hook merge (GlobalStandardProps).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { KnowledgePageState } from '../navigation.ts'

/**
 * One knowledge base as this package renders it: the structural wire shape of
 * a `knowledgeBase.list` entry. Ids stay opaque strings here; branded wire
 * identities are the gateway's declaration.
 */
export interface KnowledgeBaseRow {
  readonly id: string
  readonly name: string
  readonly description?: string
}

/**
 * One document of a knowledge base as this package renders it: the structural
 * wire shape of a `knowledgeBase.listDocuments` entry. Ids stay opaque strings
 * here; branded wire identities are the gateway's declaration.
 */
export interface KnowledgeDocumentRow {
  readonly id: string
  /** Display title; the backend's file name when it stores no title. */
  readonly title: string
  /** Entry kind; absent when the backend does not classify the entry. */
  readonly kind?: 'file' | 'url' | 'manual'
  /** Lowercase file extension (`pdf`, `docx`); absent for non-file entries. */
  readonly fileType?: string
  /** File size in bytes, when the backend reports one. */
  readonly fileSize?: number
  /** Last update timestamp (ISO 8601), when the backend reports one. */
  readonly updatedAt?: string
}

/**
 * The page-state reactive source both occupants bind: open flag plus the
 * base whose documents the browser pane shows.
 */
export type KnowledgeViewInjected = {
  hooks: {
    view: {
      getSnapshot(): KnowledgePageState
      subscribe(listener: () => void): () => void
    }
  }
}

/** Component-side view of the page-state source: the bound selector hook. */
export type KnowledgeViewHooks = PropsHooks<KnowledgeViewInjected['hooks']>

/**
 * Nav-row-private injected share: the row toggles the knowledge page; the
 * deployment console opens through the page's manage action instead.
 */
export type KnowledgeNavInjected = {
  /** Open the knowledge page in the conversation area. */
  openPage: () => void
  /** Close the knowledge page; the session surface stands again. */
  closePage: () => void
}

/** Full nav-row props: shell owner share + page-state hook + injected action + the locale seat. */
export type KnowledgeNavProps =
  PropsRuntime<'sidebar.knowledge'>
  & KnowledgeNavInjected
  & KnowledgeViewHooks
  & PropsLocale<'knowledge'>

/**
 * Page-private injected share: the two data reads and the actions the page's
 * panes drive.
 */
export type KnowledgePageInjected = {
  /** List the bases the deployment credential can see, plus the console URL (null when unconfigured). */
  load: () => Promise<{ bases: readonly KnowledgeBaseRow[]; webUiUrl: string | null }>
  /**
   * List one base's documents, optionally keyword-filtered by the backend.
   * @param baseId - the structural base id of the selected base.
   * @param keyword - backend-matched filter over titles and content; empty
   *   means unfiltered.
   */
  listDocuments: (baseId: string, keyword?: string) => Promise<{
    documents: readonly KnowledgeDocumentRow[]
    total: number
  }>
  /** Start a New Session (the browser pane's ask action); closes the page. */
  startSession: () => void
  /** Return from a base's documents to the base list. */
  closeBase: () => void
  /** Select a base in the list; its documents fill the browser pane. */
  openBase: (base: KnowledgeBaseRow) => void
}

/** Full page props: owner share + page-state hook + injected actions + the locale seat. */
export type KnowledgeLibraryProps =
  PropsRuntime<'conversation.knowledge.browser'>
  & KnowledgePageInjected
  & KnowledgeViewHooks
  & PropsLocale<'knowledge'>
