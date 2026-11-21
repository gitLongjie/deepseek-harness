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
import type { ExpertPublisher } from '@deepseek-ai/dsh-expert-publish/publish'
import type { Market as MarketService, MarketBundleId, MarketEntryRef } from '@deepseek-ai/dsh-market'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import { listPublishedExperts, readPublishedExpert } from '@deepseek-ai/dsh-expert-publish/publish'
import {
  DEFAULT_EXPERT_HUB_ORIGIN, fetchExpertPlaza, installExpertModule, publishExpertDocument, publishLocalExpert,
  readRemoteExpert, uploadableExpertIds, installedExpertVersions, versionRows,
  fetchOwnedExpertModules, type OwnedExpertModule,
} from './online.ts'
import { collectShippedExperts, type ShippedExpert } from './shipped.ts'
import type {
  ExpertHubBundleId,
  ExpertHubCatalog,
  ExpertHubCatalogItem,
  ExpertHubEntryId,
  ExpertHubInstallOutcome,
  ExpertHubRemoveOutcome,
  ExpertHubSourceId,
  ExpertDetail,
  ExpertModuleResult,
  ExpertPlazaPage,
  ExpertUploadable,
  ExpertVersionPage,
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
  private readonly shippedVersions = new Map<string, string>()

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
    const owned = await this.ownedBySlug()
    return {
      cards: listed.cards.map((card) => {
        const installed = versions.get(card.slug)
        const ownedVersion = owned.get(card.slug)
        return {
          ...card,
          ...(installed === undefined ? {} : { installedVersion: installed }),
          ...(ownedVersion === undefined ? {} : { ownedVersion }),
        }
      }),
    }
  }

  /**
   * Versions saved on this machine. A plaza install also carries the published
   * version, so the card can offer an update when that version is higher.
   * @returns those rows. A plaza read that fails still returns the saved versions.
   */
  @Remote('versions')
  async versions(): Promise<ExpertVersionPage> {
    const publisher = this.publisher()
    const stored = publisher === undefined ? [] : await listPublishedExperts(publisher.root)
    const listed = await fetchExpertPlaza(this.origin)
    const remote = new Map<string, string>()
    if (listed.ok) {
      for (const card of listed.cards) remote.set(card.slug, card.version)
    }
    const entries = versionRows(stored, remote, this.shippedVersions)
    const present = await this.presentLocalIds()
    for (const module of await this.ownedModules()) {
      if (!present.has(module.localId)) continue
      const index = entries.findIndex(entry => entry.id === module.localId)
      if (index < 0) {
        entries.push({ id: module.localId, version: module.version, remoteVersion: module.version })
        continue
      }
      const current = entries[index]
      if (current === undefined || current.remoteVersion !== undefined) continue
      entries[index] = { ...current, remoteVersion: module.version }
    }
    return { entries }
  }

  /**
   * Plaza slugs this account published from a local expert that is still here.
   * @returns slug to published version. An unsigned session or a failed read is empty.
   */
  private async ownedBySlug(): Promise<ReadonlyMap<string, string>> {
    const present = await this.presentLocalIds()
    const versions = new Map<string, string>()
    for (const module of await this.ownedModules()) {
      if (present.has(module.localId)) versions.set(module.slug, module.version)
    }
    return versions
  }

  /**
   * Modules this account published. A missing token or a failed read is empty.
   * @returns those modules.
   */
  private async ownedModules(): Promise<readonly OwnedExpertModule[]> {
    const token = await this.gatewayToken()
    if (token === undefined) return []
    const listed = await fetchOwnedExpertModules(this.origin, token)
    return listed.ok ? listed.modules : []
  }

  /**
   * Roster ids that already have a local expert: a saved file or a shipped preset.
   * @returns those ids.
   */
  private async presentLocalIds(): Promise<ReadonlySet<string>> {
    const ids = new Set<string>()
    const publisher = this.publisher()
    if (publisher !== undefined) {
      for (const expert of await listPublishedExperts(publisher.root)) ids.add(expert.id)
    }
    for (const expert of await this.shippedExperts()) ids.add(expert.id)
    return ids
  }

  /**
   * Roster ids this account may upload: saved cards, and shipped presets outside `.agent-presets`.
   * @returns those ids. An absent publisher omits the saved cards.
   */
  @Remote('uploadable')
  async uploadable(): Promise<ExpertUploadable> {
    const publisher = this.publisher()
    const stored = publisher === undefined ? [] : await uploadableExpertIds(publisher.root)
    const shippedPromise = this.shippedExperts()
    const shipped = await shippedPromise
    return { ids: [...new Set([...stored, ...shipped.map(expert => expert.id)])] }
  }

  private async shippedById(id: string): Promise<ShippedExpert | undefined> {
    const experts = await this.shippedExperts()
    return experts.find(expert => expert.id === id)
  }

  /**
   * Persona and skill titles for one card.
   * @param request - roster id or plaza slug.
   * @returns the detail. A missing expert returns the id as the name.
   */
  @Remote('detail')
  async detail(request: { id: string }): Promise<ExpertDetail> {
    const publisher = this.publisher()
    if (publisher !== undefined) {
      const stored = await readPublishedExpert(publisher.root, request.id)
      if (stored !== undefined) {
        return detailOf(stored.id, stored.name, stored.description, stored.persona, skillTitles(stored.skillMarkdown))
      }
    }
    const shipped = await this.shippedById(request.id)
    if (shipped !== undefined) {
      return detailOf(shipped.id, shipped.name, shipped.description, shipped.persona, shipped.skillNames)
    }
    const remote = await readRemoteExpert(this.origin, request.id)
    if (remote !== undefined) {
      return detailOf(remote.slug, remote.name, remote.description, remote.persona, skillTitles(remote.skillMarkdown))
    }
    return { id: request.id, name: request.id }
  }

  /**
   * Upload one local expert as the signed-in user.
   * A card saved by this account uploads from its file. A shipped preset uploads from its directory.
   * Plaza installs and package copies under `.agent-presets` do not upload.
   * @param request - the roster id.
   * @returns the public slug and version, or why it stopped.
   */
  @Remote('publishModule')
  async publishModule(request: { id: string }): Promise<ExpertModuleResult> {
    const token = await this.gatewayToken()
    if (token === undefined) return { ok: false, message: '登录后才能上传专家' }
    const publisher = this.publisher()
    if (publisher !== undefined) {
      const stored = await readPublishedExpert(publisher.root, request.id)
      if (stored !== undefined) return publishLocalExpert(this.origin, token, publisher, request.id)
    }
    const shipped = await this.shippedById(request.id)
    if (shipped === undefined) {
      return { ok: false, message: publisher === undefined ? '本机专家目录还没有准备好' : '这个专家还没有保存在本机，不能上传' }
    }
    const version = this.shippedVersions.get(request.id) ?? '1.0.0'
    const result = await publishExpertDocument(this.origin, token, {
      id: shipped.id,
      name: shipped.name,
      description: shipped.description,
      persona: shipped.persona,
      skillMarkdown: shipped.skillMarkdown,
      category: shipped.category,
      subtitle: shipped.subtitle,
      icon: shipped.icon,
      tags: shipped.tags,
      quickPrompts: shipped.quickPrompts,
      version,
    })
    if (result.ok) this.shippedVersions.set(request.id, result.version)
    return result
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

  /**
   * Shipped experts whose directories this process recorded.
   * @returns experts that can be uploaded. An absent roster is an empty list.
   */
  protected shippedExperts(): Promise<readonly ShippedExpert[]> {
    return collectShippedExperts(this.ctx.get('agentPresets'))
  }

  private publisher(): ExpertPublisher | undefined {
    return this.ctx.get('expertPublisher')
  }

  /**
   * Signed-in gateway key, when credentials hold one.
   * @returns the key, or undefined when nobody is signed in.
   */
  protected gatewayToken(): Promise<string | undefined> {
    return this.readGatewayToken()
  }

  private async readGatewayToken(): Promise<string | undefined> {
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

function detailOf(
  id: string,
  name: string,
  description: string,
  persona: string,
  skills: readonly string[],
): ExpertDetail {
  return {
    id,
    name,
    ...(description === '' ? {} : { description }),
    ...(persona.trim() === '' ? {} : { persona }),
    ...(skills.length === 0 ? {} : { skills }),
  }
}

function skillTitles(markdown: string): string[] {
  const named = titlesOn(markdown, 'name:')
  if (named.length > 0) return named
  return titlesOn(markdown, '# ')
}

function titlesOn(markdown: string, prefix: 'name:' | '# '): string[] {
  const titles: string[] = []
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith(prefix)) continue
    const title = line.slice(prefix.length).trim()
    if (title !== '' && !titles.includes(title)) titles.push(title)
  }
  return titles
}
