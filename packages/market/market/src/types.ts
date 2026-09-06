import type { Branded } from '@deepseek-ai/dsh-brand'

/** Durable identity of one configured catalog source in the market source registry. */
export type MarketSourceId = Branded<'MarketSourceId'>

/** Source-local stable identity of one catalog entry. */
export type MarketEntryId = Branded<'MarketEntryId'>

/** Opaque handle a trusted client echoes back to uninstall one installed plugin. */
export type MarketBundleId = Branded<'MarketBundleId'>

/** Catalog transport a source speaks. The union is closed; providers switch with `assertNever`. */
export type MarketSourceKind =
  | /** Standard dsh catalog endpoint: server-side `q`/`category`/`cursor`/`limit` over catalog pages. */ 'catalog'
  | /** DSH 1024Store `/api/v1/plugins` projection: one bounded installable list, filtered client-side. */ 'store-v1'

/** Attribution a source declares for display next to its entries. */
export interface MarketAttribution {
  readonly name: string
  readonly url: string
}

/** One configured catalog source in the user-owned source registry. */
export interface MarketSource {
  readonly id: MarketSourceId
  /** Display name; a standard source manifest owns its own, an input names it up front. */
  readonly name: string
  readonly kind: MarketSourceKind
  /** Absolute HTTPS URL of the manifest (standard) or directory endpoint (store-v1). */
  readonly url: string
  readonly attribution?: MarketAttribution
}

/** Input that registers a new source; the service assigns the identity. */
export interface MarketSourceInput {
  readonly name: string
  readonly kind: MarketSourceKind
  readonly url: string
}

/** One normalized catalog entry projected to consumers; provider payload fields never leak. */
export interface MarketCatalogEntry {
  readonly sourceId: MarketSourceId
  readonly entryId: MarketEntryId
  /** Display name. */
  readonly name: string
  /** One-line description. */
  readonly summary: string
  /** Longer description beyond the summary. */
  readonly description?: string
  readonly categories: readonly string[]
  readonly keywords: readonly string[]
  /** Repository URL (HTTPS). */
  readonly repository?: string
  /** Homepage URL (HTTPS). */
  readonly homepage?: string
  /**
   * The one npm package identity that can install this entry, when the source
   * declares exactly one. This is a claim: installability is validated against
   * the npm registry, never against this field alone.
   */
  readonly npmPackage?: string
  /** Informational version from the source; the npm registry remains the version authority. */
  readonly latestVersion?: string
  readonly license?: string
  readonly publisher?: string
}

/** Browse request over the selected source. */
export interface MarketBrowseQuery {
  /** Free-text query. */
  readonly query?: string
  /** Exact source category id. */
  readonly category?: string
  /** Opaque cursor from a previous page's `nextCursor`. */
  readonly cursor?: string
  /** Page size; providers clamp to their declared maximum. */
  readonly limit?: number
}

/** One page of catalog results. */
export interface MarketCatalogPage {
  readonly entries: readonly MarketCatalogEntry[]
  /** Cursor for the next page, or null when the source is exhausted. */
  readonly nextCursor: string | null
  /** Total matching entries when the source reports one. */
  readonly total: number | null
}

/** Identity a trusted client submits for entry-scoped operations. */
export interface MarketEntryRef {
  readonly sourceId: MarketSourceId
  readonly entryId: MarketEntryId
}

/**
 * Whether one entry may be installed right now. `installable` requires exactly
 * one declared npm package whose registry `latest` manifest resolves to the
 * same name at an exact stable version and declares `dsh.bundle.patch`; every
 * failed requirement names itself in `reasons`.
 */
export interface MarketInstallability {
  readonly installable: boolean
  readonly npmPackage: string | null
  readonly resolvedVersion: string | null
  readonly reasons: readonly string[]
}

/** One plugin dependency of the managed profile, as the installed view shows it. */
export interface MarketInstalledPlugin {
  /** Opaque uninstall handle; revalidated against the live profile manifest at uninstall time. */
  readonly bundleId: MarketBundleId
  readonly packageName: string
  /** Installed version when the package resolves. */
  readonly version: string | null
  /** The dependency spec recorded in the profile manifest, or null for an installation-owned template layer. */
  readonly spec: string | null
  /** Whether the package joins the profile's `dsh.profile.bundles` layer stack. */
  readonly isBundleLayer: boolean
  /** Whether this service may uninstall it; installation-owned template layers are never removable. */
  readonly removable: boolean
}

/** Successful install: the exact npm version pnpm added to the profile. */
export interface MarketInstallSuccess {
  readonly ok: true
  readonly packageName: string
  readonly version: string
  /** True while bundle layers activate only on the next host start. */
  readonly restartRequired: boolean
}

/** Failed market operation with its bounded process-output tail for diagnostics. */
export interface MarketOperationFailure {
  readonly ok: false
  readonly message: string
  /** Captured stdout/stderr tail, or null when the failure produced no process output. */
  readonly outputTail: string | null
}

/** Install result: the exact added version, or a named failure with its bounded output tail. */
export type MarketInstallOutcome = MarketInstallSuccess | MarketOperationFailure

/** Successful uninstall. */
export interface MarketUninstallSuccess {
  readonly ok: true
  readonly packageName: string
  readonly restartRequired: boolean
}

/** Uninstall result: the removed package name, or a named failure with its bounded output tail. */
export type MarketUninstallOutcome = MarketUninstallSuccess | MarketOperationFailure
