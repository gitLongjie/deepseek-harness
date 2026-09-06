/**
 * Remote gateway for the plugin market: projects the `market` Service
 * Definition onto the Typert wire for trusted clients. The gateway holds no
 * state of its own — every call reads through the mounted market service, so
 * the host's observed-entry cache, npm validation, and profile mutations stay
 * owned by one implementation.
 * @module @deepseek-ai/dsh-market-gateway
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Market as MarketService } from '@deepseek-ai/dsh-market'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
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

/**
 * Remote-only market gateway. The Context key `marketGateway` names this
 * service registration (distinct from the `market` Service Definition's key);
 * the wire namespace stays `market`.
 */
export class MarketGateway extends TypertRemoteService {
  static inject = ['market']

  constructor(ctx: Context) {
    super(ctx, 'marketGateway', { namespace: 'market' })
  }

  /** The mounted market Service Provider instance, guaranteed by `static inject`. */
  private get market(): MarketService {
    return this.ctx.market
  }

  /**
   * List the configured sources in registry order.
   * @returns the configured sources in registry order.
   */
  @Remote('listSources')
  async listSources(): Promise<{ sources: readonly MarketSource[] }> {
    return { sources: await this.market.listSources() }
  }

  /**
   * Read the current source selection.
   * @returns the selected source id, or null when nothing is selected.
   */
  @Remote('selectedSource')
  async selectedSource(): Promise<{ sourceId: MarketSourceId | null }> {
    return { sourceId: await this.market.selectedSource() }
  }

  /**
   * Select the source subsequent browsing reads.
   * @param request - the source id to select; must be configured.
   */
  @Remote('selectSource')
  async selectSource(request: { sourceId: MarketSourceId }): Promise<void> {
    await this.market.selectSource(request.sourceId)
  }

  /**
   * Register a new source. Selection changes only through {@link selectSource}.
   * @param request - the source's display name, transport kind, and HTTPS URL.
   * @returns the registered source with its assigned identity.
   */
  @Remote('addSource')
  async addSource(request: { input: MarketSourceInput }): Promise<{ source: MarketSource }> {
    return { source: await this.market.addSource(request.input) }
  }

  /**
   * Remove a configured source; removing the selected source clears the
   * selection and drops its cached catalog.
   * @param request - the source id to remove.
   */
  @Remote('removeSource')
  async removeSource(request: { sourceId: MarketSourceId }): Promise<void> {
    await this.market.removeSource(request.sourceId)
  }

  /**
   * Read one page from the selected source.
   * @param request - free-text query, category, cursor, and page size.
   * @returns one page of normalized entries with an opaque next cursor.
   */
  @Remote('browse')
  async browse(request: { query: MarketBrowseQuery }): Promise<MarketCatalogPage> {
    return this.market.browse(request.query)
  }

  /**
   * Resolve one entry through its source; undefined means the source does not
   * list the id.
   * @param request - the source-local identity to resolve.
   * @returns the observed entry under `found: true`, or `found: false`.
   */
  @Remote('entryDetail')
  async entryDetail(request: { ref: MarketEntryRef }): Promise<{ found: true; entry: MarketCatalogEntry } | { found: false }> {
    const entry = await this.market.entryDetail(request.ref)
    return entry === undefined ? { found: false } : { found: true, entry }
  }

  /**
   * Validate one entry against the npm registry without installing.
   * @param request - the source-local identity to validate.
   * @returns the installability verdict with one reason per unmet requirement.
   */
  @Remote('installability')
  async installability(request: { ref: MarketEntryRef }): Promise<MarketInstallability> {
    return this.market.installability(request.ref)
  }

  /**
   * Validate and install one entry into the managed profile.
   *
   * The wire name is `installEntry`, not `install`: the Remote client's
   * namespace service carries its own `install` helper, and a method of that
   * name is rejected as conflicting with its namespace service.
   * @param request - the source-local identity to install.
   * @returns the discriminated install outcome with the exact added version on success.
   */
  @Remote('installEntry')
  async install(request: { ref: MarketEntryRef }): Promise<MarketInstallOutcome> {
    return this.market.install(request.ref)
  }

  /**
   * Read the installed-plugin view of the managed profile.
   * @returns the profile's plugin dependencies, dependencies first.
   */
  @Remote('installed')
  async installed(): Promise<{ plugins: readonly MarketInstalledPlugin[] }> {
    return { plugins: await this.market.installed() }
  }

  /**
   * Remove one dependency-managed plugin from the managed profile.
   * @param request - the bundle id (npm package name) to remove.
   * @returns the discriminated uninstall outcome naming the removed package.
   */
  @Remote('uninstall')
  async uninstall(request: { bundleId: MarketBundleId }): Promise<MarketUninstallOutcome> {
    return this.market.uninstall(request.bundleId)
  }
}

export default MarketGateway
