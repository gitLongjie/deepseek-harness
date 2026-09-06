# Plugin Market

English | [中文](market.zh.md)

The plugin market discovers installable plugins through user-configured catalog sources, validates each candidate against the npm registry, and installs it into a managed profile. The types live in [`packages/market/market/src/types.ts`](../../packages/market/market/src/types.ts); `dsh-market-local` owns the catalog, registry, and pnpm execution; the `dsh market` CLI, the host Remote gateway, and the web settings tab are consumers.

## Identities

`MarketSourceId`, `MarketEntryId`, and `MarketBundleId` are [branded ids](core.md#branded-ids). Catalog entries carry their source-local `entryId` only, so every entry-scoped operation takes a `MarketEntryRef` pair. Display text is provider content: the normalizer rejects control and bidirectional-override characters before an entry reaches a consumer, and clients submit opaque ids back rather than names.

## Sources

The user-owned source registry lives at `<dsh home>/market/sources.json` and is read per operation, so the service, the CLI, and the GUI share one state. A fresh home seeds the built-in DSH 1024Store source preselected. The transport kind is a closed union: `catalog` speaks the standard dsh catalog endpoint with server-side `q`/`category`/`cursor`/`limit` paging, and `store-v1` speaks the DSH 1024Store bounded projection whose whole installable list is fetched once per cache lifetime and filtered client-side.

```ts type-equiv
/** Catalog transport a source speaks. The union is closed; providers switch with `assertNever`. */
type MarketSourceKind =
  | /** Standard dsh catalog endpoint: server-side `q`/`category`/`cursor`/`limit` over catalog pages. */ 'catalog'
  | /** DSH 1024Store `/api/v1/plugins` projection: one bounded installable list, filtered client-side. */ 'store-v1'
```

```ts type-equiv
/** One configured catalog source in the user-owned source registry. */
interface MarketSource {
  readonly id: MarketSourceId
  /** Display name; a standard source manifest owns its own, an input names it up front. */
  readonly name: string
  readonly kind: MarketSourceKind
  /** Absolute HTTPS URL of the manifest (standard) or directory endpoint (store-v1). */
  readonly url: string
  readonly attribution?: MarketAttribution
}
```

A standard source's manifest pins its own endpoint, which must stay on the manifest origin and end in `/v1/plugins`, and declares which query parameters it supports and its page limits. Provider payloads are validated and normalized before they enter the observed-entry cache, which caps one source at the configured `maxCatalogEntries` and serves reads through a time-to-live.

## Entries and browsing

```ts type-equiv
/** One normalized catalog entry projected to consumers; provider payload fields never leak. */
interface MarketCatalogEntry {
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
```

`browse` returns one `MarketCatalogPage` whose `nextCursor` is opaque and whose `total` is null when the source reports none. `entryDetail` resolves an entry cache-first and, for standard sources, searches by the id when the cache has not observed it; `undefined` means the source does not list the id and is never an error.

## Installability and install

The npm registry is the sole version authority. Installability requires exactly one declared npm package whose registry `latest` manifest carries the same name at an exact stable release and declares `dsh.bundle.patch`; every failed requirement names itself in `reasons`. Installing runs the profile package manager with that exact version and reconciles `dsh.profile.bundles`, so a market install behaves like `dsh plugin add` and activates on the next host start.

```ts type-equiv
/**
 * Whether one entry may be installed right now. `installable` requires exactly
 * one declared npm package whose registry `latest` manifest resolves to the
 * same name at an exact stable version and declares `dsh.bundle.patch`; every
 * failed requirement names itself in `reasons`.
 */
interface MarketInstallability {
  readonly installable: boolean
  readonly npmPackage: string | null
  readonly resolvedVersion: string | null
  readonly reasons: readonly string[]
}
```

The installed view reads the profile manifest as the only truth, so plugins installed through the CLI, another market, or this one all appear. Dependencies come first and carry their manifest spec; installation-owned template layers are listed read-only and refuse uninstall.

```ts type-equiv
/** One plugin dependency of the managed profile, as the installed view shows it. */
interface MarketInstalledPlugin {
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
```

```ts type-equiv
/** Successful install: the exact npm version pnpm added to the profile. */
interface MarketInstallSuccess {
  readonly ok: true
  readonly packageName: string
  readonly version: string
  /** True while bundle layers activate only on the next host start. */
  readonly restartRequired: boolean
}
```

Install and uninstall return discriminated outcomes; the failure variant carries a bounded captured process-output tail for diagnostics. A timed-out child owns the verdict even when it later reports a zero exit code.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmarket--market-abstract-seam"></a>

### `ctx.market` — `Market` (abstract seam)

The market capability. All identity arguments are host-validated: clients submit opaque ids and the service resolves every package name, version, and command itself. Catalog data is untrusted provider content; only entries this service normalized can install, and the npm registry is the sole version authority at install time.

```ts cordis-catalog
/**
 * List the configured sources in registry order.
 * @returns the configured sources in registry order.
 */
abstract listSources(): Promise<readonly MarketSource[]>

/**
 * The selected source's id, or null when no source is selected.
 * @returns the selected source id, or null when nothing is selected.
 */
abstract selectedSource(): Promise<MarketSourceId | null>

/**
 * Select the source subsequent browsing reads. Selection is durable,
 * user-owned state.
 * @param id - the source to select; must be configured.
 */
abstract selectSource(id: MarketSourceId): Promise<void>

/**
 * Register a new source and select nothing (selection changes only through
 * {@link selectSource}).
 * @param input - the source's display name, transport kind, and HTTPS URL.
 * @returns the registered source with its assigned identity.
 */
abstract addSource(input: MarketSourceInput): Promise<MarketSource>

/**
 * Remove a configured source. Removing the selected source clears the
 * selection and drops that source's cached catalog.
 * @param id - the source to remove.
 */
abstract removeSource(id: MarketSourceId): Promise<void>

/**
 * Read one page from the selected source. Server-side sources translate the
 * query into their endpoint call; bounded-projection sources filter their
 * cached list client-side. Failures name the source and stage.
 * @param query - free-text query, category filter, cursor, and page size.
 * @returns one page of normalized entries with an opaque next cursor.
 */
abstract browse(query: MarketBrowseQuery): Promise<MarketCatalogPage>

/**
 * Resolve one entry through its source: cache-first, with a catalog source
 * searched for the id when the cache has not observed it. Undefined means
 * the source does not list the id — never an error, so callers can probe.
 * @param ref - the source and entry to resolve.
 * @returns the observed entry, or undefined when the source does not know it.
 */
abstract entryDetail(ref: MarketEntryRef): Promise<MarketCatalogEntry | undefined>

/**
 * Validate one entry's installability against the npm registry: exactly one
 * declared npm package, whose registry `latest` manifest carries the same
 * name, an exact stable version, and a `dsh.bundle.patch` declaration.
 * @param ref - the source and entry to validate.
 * @returns the installability verdict with one reason per unmet requirement.
 */
abstract installability(ref: MarketEntryRef): Promise<MarketInstallability>

/**
 * Install one entry into the managed profile: validate installability, then
 * run the profile package manager with the exact resolved version and
 * reconcile `dsh.profile.bundles`. The new layer activates on the next host
 * start.
 * @param ref - the source and entry to install.
 * @returns the discriminated install outcome with the exact added version on success.
 */
abstract install(ref: MarketEntryRef): Promise<MarketInstallOutcome>

/**
 * List the managed profile's direct plugin dependencies with their bundle
 * state. Every install route appears — this market, another market, or the
 * CLI — because the profile manifest is the only truth read.
 * @returns the profile's plugin dependencies, dependencies first.
 */
abstract installed(): Promise<readonly MarketInstalledPlugin[]>

/**
 * Uninstall one dependency-managed plugin from the managed profile. The
 * bundle id is revalidated against the live profile manifest; installation
 * owned template layers refuse.
 * @param bundleId - the opaque handle from a previous {@link installed} read.
 * @returns the discriminated uninstall outcome naming the removed package.
 */
abstract uninstall(bundleId: MarketBundleId): Promise<MarketUninstallOutcome>
```

Source: [`packages/market/market/src/index.ts`](../../packages/market/market/src/index.ts)
<!-- END GENERATED cordis-surface -->
