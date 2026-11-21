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

/** One online expert module listed by the plaza or by the signed-in account. */
export interface ExpertModuleCard {
  /** Public slug other clients download. */
  readonly slug: string
  /** Display name. */
  readonly name: string
  /** One-line description. */
  readonly description?: string
  /** Category id. */
  readonly category?: string
  /** Retrieval tags. */
  readonly tags?: readonly string[]
  /** Published semver. */
  readonly version: string
  /** Account name stamped by the server. */
  readonly author?: string
  /** Version saved on this machine, when the slug is already installed. */
  readonly installedVersion?: string
  /**
   * Version this account already published from a local expert that is still
   * on the roster. The plaza card does not offer a second download.
   */
  readonly ownedVersion?: string
}

/** Result of uploading or installing one module. */
export type ExpertModuleResult =
  | { readonly ok: true; readonly slug: string; readonly version: string }
  | { readonly ok: false; readonly message: string }

/** Roster ids that have a local expert file this account may upload. */
export interface ExpertUploadable {
  readonly ids: readonly string[]
}

/** One saved expert version, with the plaza version when that copy can be updated. */
export interface ExpertVersionRow {
  /** Roster id. */
  readonly id: string
  /** Version saved on this machine. */
  readonly version: string
  /**
   * Published plaza version. Present for a plaza install whose slug is listed.
   * A higher value is the update the card offers.
   */
  readonly remoteVersion?: string
}

/** Saved versions for the expert page. */
export interface ExpertVersionPage {
  readonly entries: readonly ExpertVersionRow[]
}

/** Persona and skill names for one expert card's detail view. */
export interface ExpertDetail {
  /** Roster id or plaza slug. */
  readonly id: string
  /** Display name. */
  readonly name: string
  /** Card description, when the host or the module has one. */
  readonly description?: string
  /** System prompt. */
  readonly persona?: string
  /** Skill titles packaged with the expert. */
  readonly skills?: readonly string[]
}

/** Plaza read: cards, plus a message when the catalog could not be reached. */
export interface ExpertPlazaPage {
  readonly cards: readonly ExpertModuleCard[]
  readonly message?: string
}
