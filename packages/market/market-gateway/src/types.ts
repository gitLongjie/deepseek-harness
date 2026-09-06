/**
 * Wire-facing market types. These are the gateway's own declarations, not
 * re-exports of the Service Definition package: the Typert type graph walks
 * this package's files, so every identity, entry, and outcome the client sees
 * is declared here with the same brand keys the Service Definition uses.
 * @module @deepseek-ai/dsh-market-gateway/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Source identity as configured in the host's source registry. */
export type MarketSourceId = Branded<'MarketSourceId'>

/** Source-local identity of one catalog entry. */
export type MarketEntryId = Branded<'MarketEntryId'>

/** Installed-plugin identity: the npm package name of one profile dependency. */
export type MarketBundleId = Branded<'MarketBundleId'>

/** Catalog transport a source speaks. */
export type MarketSourceKind = 'catalog' | 'store-v1'

/** Source attribution shown wherever a source is named. */
export interface MarketAttribution {
  readonly name: string
  readonly url: string
}

/** One configured market source. */
export interface MarketSource {
  readonly id: MarketSourceId
  readonly name: string
  readonly kind: MarketSourceKind
  readonly url: string
  readonly attribution?: MarketAttribution
}

/** Registration request for a new market source. */
export interface MarketSourceInput {
  readonly name: string
  readonly kind: MarketSourceKind
  readonly url: string
}

/** One normalized catalog entry as the host observed it from its source. */
export interface MarketCatalogEntry {
  readonly sourceId: MarketSourceId
  readonly entryId: MarketEntryId
  readonly name: string
  readonly summary: string
  readonly description?: string
  readonly categories: readonly string[]
  readonly keywords: readonly string[]
  readonly repository?: string
  readonly homepage?: string
  readonly npmPackage?: string
  /** Source-declared version, informational only — never the install version. */
  readonly latestVersion?: string
  readonly license?: string
  readonly publisher?: string
}

/** Client browse request: free-text query, category, cursor, and page size. */
export interface MarketBrowseQuery {
  readonly query?: string
  readonly category?: string
  readonly cursor?: string
  readonly limit?: number
}

/** One page of catalog results. */
export interface MarketCatalogPage {
  readonly entries: readonly MarketCatalogEntry[]
  readonly nextCursor: string | null
  readonly total: number | null
}

/** Source-local identity a client submits for entry operations. */
export interface MarketEntryRef {
  readonly sourceId: MarketSourceId
  readonly entryId: MarketEntryId
}

/** Result of the npm-registry installability validation. */
export interface MarketInstallability {
  readonly installable: boolean
  readonly npmPackage: string | null
  readonly resolvedVersion: string | null
  readonly reasons: readonly string[]
}

/** One installed plugin row of the managed profile. */
export interface MarketInstalledPlugin {
  readonly bundleId: MarketBundleId
  readonly packageName: string
  readonly version: string | null
  readonly spec: string | null
  readonly isBundleLayer: boolean
  readonly removable: boolean
}

/** Successful install or uninstall. */
export interface MarketOperationSuccess {
  readonly ok: true
  readonly packageName: string
  /** True for installs and uninstalls: the bundle layer activates on host restart. */
  readonly restartRequired: boolean
}

/** Successful install, carrying the exact registry version that was installed. */
export interface MarketInstallSuccess extends MarketOperationSuccess {
  readonly version: string
}

/** Failed install or uninstall, with the bounded pnpm output tail. */
export interface MarketOperationFailure {
  readonly ok: false
  readonly message: string
  readonly outputTail: string | null
}

export type MarketInstallOutcome = MarketInstallSuccess | MarketOperationFailure

export type MarketUninstallOutcome = MarketOperationSuccess | MarketOperationFailure
