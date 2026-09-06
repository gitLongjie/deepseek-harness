/**
 * Plugin market Service Definition: catalog discovery over user-configured
 * sources, npm-identity installability, and profile plugin install and
 * uninstall. The concrete local provider lives in
 * `@deepseek-ai/dsh-market-local`; consumers are the `dsh market` CLI surface,
 * the host Remote gateway, and the web market settings tab.
 * @module @deepseek-ai/dsh-market
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  MarketBrowseQuery,
  MarketBundleId,
  MarketCatalogEntry,
  MarketCatalogPage,
  MarketEntryRef,
  MarketInstallability,
  MarketInstallOutcome,
  MarketInstalledPlugin,
  MarketSource,
  MarketSourceId,
  MarketSourceInput,
  MarketUninstallOutcome,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The plugin market service; mounted by a Service Provider such as `dsh-market-local`. */
    market: Market
  }
}

/**
 * The market capability. All identity arguments are host-validated: clients
 * submit opaque ids and the service resolves every package name, version, and
 * command itself. Catalog data is untrusted provider content; only entries
 * this service normalized can install, and the npm registry is the sole
 * version authority at install time.
 */
export abstract class Market extends Service {
  constructor(ctx: Context) {
    super(ctx, 'market')
  }

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
}

export default Market
