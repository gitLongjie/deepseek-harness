/**
 * Remote gateway for the expert hub: projects the market's `expert` category
 * onto the `expertHub` Typert wire for trusted clients. The gateway holds no
 * state of its own — every call reads through the mounted market service, so
 * source selection, npm validation, and profile mutations stay owned by one
 * implementation.
 * @module @deepseek-ai/dsh-expert-hub
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Market as MarketService, MarketBundleId, MarketEntryRef } from '@deepseek-ai/dsh-market'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import type {
  ExpertHubBundleId,
  ExpertHubCatalog,
  ExpertHubCatalogItem,
  ExpertHubEntryId,
  ExpertHubInstallOutcome,
  ExpertHubRemoveOutcome,
  ExpertHubSourceId,
} from './types.ts'

export type * from './types.ts'

/** Market category the expert hub admits. */
const EXPERT_CATEGORY = 'expert'

/**
 * Remote-only expert-hub gateway. The Context key `expertHub` names this
 * service registration; the wire namespace is also `expertHub`.
 */
export class ExpertHubGateway extends TypertRemoteService {
  static inject = ['market']

  constructor(ctx: Context) {
    super(ctx, 'expertHub', { namespace: 'expertHub' })
  }

  /** The mounted market Service Provider instance, guaranteed by `static inject`. */
  private get market(): MarketService {
    return this.ctx.market
  }

  /**
   * List installable experts from the selected market source's `expert` category.
   * @returns the catalog rows in the source's own order.
   */
  @Remote('catalog')
  async catalog(): Promise<ExpertHubCatalog> {
    const page = await this.market.browse({ category: EXPERT_CATEGORY, limit: 200 })
    return page.entries
      .filter(entry => entry.categories.includes(EXPERT_CATEGORY))
      .map((entry): ExpertHubCatalogItem => ({
        id: entry.entryId as ExpertHubEntryId,
        sourceId: entry.sourceId as ExpertHubSourceId,
        name: entry.name,
        ...(entry.summary !== '' ? { description: entry.summary } : {}),
        ...(entry.publisher !== undefined ? { subtitle: entry.publisher } : {}),
        category: EXPERT_CATEGORY,
        ...(entry.keywords.length > 0 ? { tags: entry.keywords } : {}),
        ...(entry.npmPackage !== undefined ? { npmPackage: entry.npmPackage } : {}),
        ...(entry.repository !== undefined ? { repository: entry.repository } : {}),
      }))
  }

  /**
   * Install one expert catalog entry into the managed profile.
   *
   * The wire name is `installEntry`, not `install`: the Remote client's
   * namespace service carries its own `install` helper, and a method of that
   * name is rejected as conflicting with its namespace service.
   * @param request - the source-local identity of the entry to install.
   * @returns the discriminated install outcome with the exact added version on success.
   */
  @Remote('installEntry')
  async install(request: { sourceId: ExpertHubSourceId; id: ExpertHubEntryId }): Promise<ExpertHubInstallOutcome> {
    const ref: MarketEntryRef = { sourceId: request.sourceId, entryId: request.id }
    return this.market.install(ref)
  }

  /**
   * Remove one installed expert bundle from the managed profile.
   * @param request - the bundle id (npm package name) to remove.
   * @returns the discriminated remove outcome naming the removed package.
   */
  @Remote('remove')
  async remove(request: { bundleId: ExpertHubBundleId }): Promise<ExpertHubRemoveOutcome> {
    return this.market.uninstall(request.bundleId as MarketBundleId)
  }
}

export default ExpertHubGateway
