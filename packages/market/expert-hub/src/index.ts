/**
 * Remote gateway for the expert hub: projects the market's `expert` category
 * onto the `expertHub` Typert wire for trusted clients. The gateway holds no
 * state of its own — every call reads through the mounted market service, so
 * source selection, npm validation, and profile mutations stay owned by one
 * implementation.
 * @module @deepseek-ai/dsh-expert-hub
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-expert-publish'
import type { ExpertPublisher } from '@deepseek-ai/dsh-expert-publish/src/publish.ts'
import type { Market as MarketService, MarketBundleId, MarketEntryRef } from '@deepseek-ai/dsh-market'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import {
  DEFAULT_EXPERT_HUB_ORIGIN, fetchExpertPlaza, installExpertModule, publishLocalExpert, uploadableExpertIds,
  installedExpertVersions,
} from './online.ts'
import type {
  ExpertHubBundleId,
  ExpertHubCatalog,
  ExpertHubCatalogItem,
  ExpertHubEntryId,
  ExpertHubInstallOutcome,
  ExpertHubRemoveOutcome,
  ExpertHubSourceId,
  ExpertModuleResult,
  ExpertPlazaPage,
  ExpertUploadable,
} from './types.ts'

/** Gateway key the sign-in writes. Upload calls token-api as that user. */
const GATEWAY_KEY = credentialRef('DEEPAGENS_API_KEY')

/** Optional origin override. Omitted, the public gateway is used. */
export interface Config {
  /** token-api origin, without a path. */
  origin?: string
}

/** Schemastery configuration. */
export const Config: z<Config> = z.object({
  origin: z.string(),
})

export type * from './types.ts'

/** Market category the expert hub admits. */
const EXPERT_CATEGORY = 'expert'

/**
 * Remote-only expert-hub gateway. The Context key `expertHub` names this
 * service registration; the wire namespace is also `expertHub`.
 */
export class ExpertHubGateway extends TypertRemoteService {
  static inject = ['market']
  static Config = Config

  private readonly origin: string

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'expertHub', { namespace: 'expertHub' })
    const origin = config.origin?.trim()
    this.origin = (origin === undefined || origin === '' ? DEFAULT_EXPERT_HUB_ORIGIN : origin).replace(/\/+$/, '')
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
   *
   * The wire name is `uninstall`, not `remove`: the Remote client's namespace
   * service carries its own `remove` helper, and a method of that name is
   * rejected as conflicting with its namespace service.
   * @param request - the bundle id (npm package name) to remove.
   * @returns the discriminated remove outcome naming the removed package.
   */
  @Remote('uninstall')
  async remove(request: { bundleId: ExpertHubBundleId }): Promise<ExpertHubRemoveOutcome> {
    return this.market.uninstall(request.bundleId as MarketBundleId)
  }

  /**
   * List published online experts and mark the versions already saved here.
   * @returns the plaza page. A transport failure keeps the cards empty and names the reason.
   */
  @Remote('plaza')
  async plaza(): Promise<ExpertPlazaPage> {
    const listed = await fetchExpertPlaza(this.origin)
    if (!listed.ok) return { cards: [], message: listed.message }
    const versions = await this.savedVersions()
    return {
      cards: listed.cards.map((card) => {
        const installed = versions.get(card.slug)
        return installed === undefined ? card : { ...card, installedVersion: installed }
      }),
    }
  }

  /**
   * Roster ids whose local file this account may upload.
   * @returns those ids. An absent publisher is an empty list.
   */
  @Remote('uploadable')
  async uploadable(): Promise<ExpertUploadable> {
    const publisher = this.publisher()
    if (publisher === undefined) return { ids: [] }
    return { ids: await uploadableExpertIds(publisher.root) }
  }

  /**
   * Upload one local expert as the signed-in user.
   * @param request - the roster id.
   * @returns the public slug and version, or why it stopped.
   */
  @Remote('publishModule')
  async publishModule(request: { id: string }): Promise<ExpertModuleResult> {
    const token = await this.gatewayToken()
    if (token === undefined) return { ok: false, message: '登录后才能上传专家' }
    const publisher = this.publisher()
    if (publisher === undefined) return { ok: false, message: '本机专家目录还没有准备好' }
    return publishLocalExpert(this.origin, token, publisher, request.id)
  }

  /**
   * Download one plaza expert and register it for hire.
   * @param request - the public slug.
   * @returns the installed slug and version, or why it stopped.
   */
  @Remote('installModule')
  async installModule(request: { slug: string }): Promise<ExpertModuleResult> {
    const publisher = this.publisher()
    if (publisher === undefined) return { ok: false, message: '本机专家目录还没有准备好' }
    return installExpertModule(this.origin, publisher, request.slug)
  }

  private publisher(): ExpertPublisher | undefined {
    return this.ctx.get('expertPublisher')
  }

  private async gatewayToken(): Promise<string | undefined> {
    const credentials = this.ctx.get('credentials')
    if (credentials === undefined) return undefined
    const resolved = await credentials.resolve(GATEWAY_KEY)
    return resolved?.value
  }

  private async savedVersions(): Promise<ReadonlyMap<string, string>> {
    const publisher = this.publisher()
    if (publisher === undefined) return new Map()
    return installedExpertVersions(publisher.root)
  }
}

export default ExpertHubGateway
