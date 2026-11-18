/**
 * Wire-facing expert-hub types. These are the gateway's own declarations, not
 * re-exports of the market Service Definition: the Typert type graph walks this
 * package's files, so every catalog row the client sees is declared here.
 * @module @deepseek-ai/dsh-expert-hub/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Market source identity the hub install path forwards unchanged. */
export type ExpertHubSourceId = Branded<'MarketSourceId'>

/** Market entry identity the hub install path forwards unchanged. */
export type ExpertHubEntryId = Branded<'MarketEntryId'>

/** Installed expert bundle identity: the npm package name of one profile dependency. */
export type ExpertHubBundleId = Branded<'MarketBundleId'>

/**
 * One installable expert row from the market's `expert` category.
 *
 * The expert page merges these rows with the agent-preset roster: a row whose
 * `id` is not already on the roster appears as a hireable/installable card.
 */
export interface ExpertHubCatalogItem {
  /** Store-local entry id; also the card id the expert page merges on. */
  readonly id: ExpertHubEntryId
  /** Market source that listed the entry; required for install. */
  readonly sourceId: ExpertHubSourceId
  /** Display name. */
  readonly name: string
  /** One-line summary shown as the card description when present. */
  readonly description?: string
  /** Publisher or owner attribution under the name. */
  readonly subtitle?: string
  /** Market category id; always includes `expert` for hub rows. */
  readonly category?: string
  /** Retrieval tags shown on the card. */
  readonly tags?: readonly string[]
  /** npm package name the install path resolves, when the source declares one. */
  readonly npmPackage?: string
  /** Repository URL, when the source declares one. */
  readonly repository?: string
}

/** Catalog of installable experts: a list the expert page can `.filter` / `.map`. */
export type ExpertHubCatalog = readonly ExpertHubCatalogItem[]

/** Successful install or remove. */
export interface ExpertHubOperationSuccess {
  readonly ok: true
  readonly packageName: string
  /** True when the bundle layer activates on host restart. */
  readonly restartRequired: boolean
}

/** Successful install, carrying the exact registry version that was installed. */
export interface ExpertHubInstallSuccess extends ExpertHubOperationSuccess {
  readonly version: string
}

/** Failed install or remove, with the bounded pnpm output tail. */
export interface ExpertHubOperationFailure {
  readonly ok: false
  readonly message: string
  readonly outputTail: string | null
}

export type ExpertHubInstallOutcome = ExpertHubInstallSuccess | ExpertHubOperationFailure

export type ExpertHubRemoveOutcome = ExpertHubOperationSuccess | ExpertHubOperationFailure
