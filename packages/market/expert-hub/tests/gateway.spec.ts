import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  CredentialProvider,
  type CredentialInfo, type CredentialKey, type CredentialRecord, type CredentialRecordEntry,
  type CredentialRecordInfo, type CredentialRef, type ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import type {
  Market, MarketBundleId, MarketCatalogEntry, MarketCatalogPage, MarketEntryId, MarketSourceId,
} from '@deepseek-ai/dsh-market'
import { publishExpert, type ExpertPublisher } from '@deepseek-ai/dsh-expert-publish/src/publish.ts'
import ExpertHubGateway from '../src/index.ts'
import type { ShippedExpert } from '../src/shipped.ts'
import type { ExpertHubBundleId, ExpertHubEntryId, ExpertHubSourceId } from '../src/types.ts'

const SOURCE_ID = 'src-1' as MarketSourceId
const ENTRY_ID = 'expert/geo-admin' as MarketEntryId
const BUNDLE_ID = '@xmanrui/expert-geo-admin' as MarketBundleId
const ENTRY: MarketCatalogEntry = {
  sourceId: SOURCE_ID,
  entryId: ENTRY_ID,
  name: 'GEO Admin',
  summary: 'GEO content admin',
  categories: ['expert'],
  keywords: ['geo'],
  npmPackage: '@xmanrui/expert-geo-admin',
  publisher: 'xmanrui',
  repository: 'https://github.com/xmanrui/expert-geo-admin',
  latestVersion: '0.1.0',
}
const MINIMAL: MarketCatalogEntry = {
  sourceId: SOURCE_ID,
  entryId: 'expert/minimal' as MarketEntryId,
  name: 'Minimal Expert',
  summary: '',
  categories: ['expert'],
  keywords: [],
}
const OTHER: MarketCatalogEntry = {
  sourceId: SOURCE_ID,
  entryId: 'tools/todo' as MarketEntryId,
  name: 'todo kit',
  summary: 'Todos',
  categories: ['tools'],
  keywords: [],
  npmPackage: 'dsh-plugin-todo-kit',
}
const PAGE: MarketCatalogPage = { entries: [ENTRY, MINIMAL, OTHER], nextCursor: null, total: 3 }

function harness(): { gateway: ExpertHubGateway; market: Market } {
  const ctx = new Context()
  const market = {
    browse: vi.fn(async () => PAGE),
    install: vi.fn(async () => ({
      ok: true as const,
      packageName: '@xmanrui/expert-geo-admin',
      version: '0.1.0',
      restartRequired: true,
    })),
    uninstall: vi.fn(async () => ({
      ok: true as const,
      packageName: '@xmanrui/expert-geo-admin',
      restartRequired: true,
    })),
  }
  ctx.provide('market', market as unknown as Market)
  return { gateway: new ExpertHubGateway(ctx), market: market as unknown as Market }
}

describe('expert hub gateway projection', () => {
  it('refuses an upload when nobody is signed in and the publisher is absent', async () => {
    const { gateway } = harness()
    await expect(gateway.publishModule({ id: 'geo-prelaunch' })).resolves.toEqual({
      ok: false,
      message: '登录后才能上传专家',
    })
    await expect(gateway.installModule({ slug: 'u7-geo-prelaunch' })).resolves.toEqual({
      ok: false,
      message: '本机专家目录还没有准备好',
    })
    await expect(gateway.uploadable()).resolves.toEqual({ ids: [] })
  })

  it('binds the expertHub wire namespace under its own service key', () => {
    const { gateway } = harness()
    expect(gateway.typertRemote.serviceKey).toBe('expertHub')
    expect(gateway.typertRemote.namespace).toBe('expertHub')
    expect((gateway as unknown as { name: string }).name).toBe('expertHub')
  })

  it('projects the expert-category catalog and drops non-expert rows', async () => {
    const { gateway, market } = harness()
    await expect(gateway.catalog()).resolves.toEqual([
      {
        id: ENTRY_ID,
        sourceId: SOURCE_ID,
        name: 'GEO Admin',
        description: 'GEO content admin',
        subtitle: 'xmanrui',
        category: 'expert',
        tags: ['geo'],
        npmPackage: '@xmanrui/expert-geo-admin',
        repository: 'https://github.com/xmanrui/expert-geo-admin',
      },
      {
        id: 'expert/minimal',
        sourceId: SOURCE_ID,
        name: 'Minimal Expert',
        category: 'expert',
      },
    ])
    expect(market.browse).toHaveBeenCalledWith({ category: 'expert', limit: 200 })
  })

  it('projects install and remove through the market service', async () => {
    const { gateway, market } = harness()
    await expect(gateway.install({
      sourceId: SOURCE_ID as ExpertHubSourceId,
      id: ENTRY_ID as ExpertHubEntryId,
    })).resolves.toEqual({
      ok: true,
      packageName: '@xmanrui/expert-geo-admin',
      version: '0.1.0',
      restartRequired: true,
    })
    expect(market.install).toHaveBeenCalledWith({ sourceId: SOURCE_ID, entryId: ENTRY_ID })
    await expect(gateway.remove({ bundleId: BUNDLE_ID as ExpertHubBundleId })).resolves.toEqual({
      ok: true,
      packageName: '@xmanrui/expert-geo-admin',
      restartRequired: true,
    })
    expect(market.uninstall).toHaveBeenCalledWith(BUNDLE_ID)
  })

  it('reads a configured origin and the signed-in gateway key', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', async (input: string | URL) => {
      seen.push(String(input))
      return new Response('nope', { status: 500 })
    })
    const blank = new ExpertHubGateway(new Context(), { origin: '   ' })
    await blank.plaza()
    const custom = new ExpertHubGateway(new Context(), { origin: 'https://example.test/' })
    await custom.plaza()
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: true, data: { items: [] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    await expect(blank.plaza()).resolves.toEqual({ cards: [] })
    expect(seen).toEqual([
      'https://claw.deepagens.com/api/expert-hub/items?kind=expert&pageSize=100',
      'https://example.test/api/expert-hub/items?kind=expert&pageSize=100',
    ])
    vi.unstubAllGlobals()

    const ctx = new Context()
    new TokenCredentials(ctx, undefined)
    const unsigned = new ExpertHubGateway(ctx)
    await expect(unsigned.publishModule({ id: 'geo-optimizer' })).resolves.toEqual({
      ok: false,
      message: '登录后才能上传专家',
    })
    const signedIn = new Context()
    new TokenCredentials(signedIn, 'token')
    const gateway = new ExpertHubGateway(signedIn)
    await expect(gateway.publishModule({ id: 'geo-optimizer' })).resolves.toEqual({
      ok: false,
      message: '本机专家目录还没有准备好',
    })
  })
})

/**
 * Credential stub over the abstract provider: only `resolve` carries the test
 * token; every other member stays an inert typed empty. Constructing it
 * registers the row as the context's `credentials` service.
 */
class TokenCredentials extends CredentialProvider {
  constructor(ctx: Context, private readonly token: string | undefined) {
    super(ctx)
  }

  override resolve(_ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    return Promise.resolve(this.token === undefined ? undefined : { value: this.token, source: 'test' })
  }

  override describe(_ref: CredentialRef): Promise<CredentialInfo> {
    return Promise.resolve({ configured: this.token !== undefined, writable: false })
  }

  override set(): Promise<void> { return Promise.resolve() }
  override unset(): Promise<void> { return Promise.resolve() }
  override readRecord(): Promise<CredentialRecord | undefined> { return Promise.resolve(undefined) }
  override describeRecord(): Promise<CredentialRecordInfo> {
    return Promise.resolve({ configured: false, writable: false })
  }
  override listRecords(): Promise<readonly CredentialRecordEntry[]> { return Promise.resolve([]) }
  override modifyRecord(
    _key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> { return mutate(undefined) }
  override deleteRecord(): Promise<void> { return Promise.resolve() }
}

const SHIPPED: ShippedExpert = {
  id: 'geo-optimizer',
  name: 'GEO 优化专家',
  description: '诊断可见度。',
  persona: '你是顾问。',
  category: 'marketing',
  subtitle: '官方',
  icon: '🔍',
  tags: ['GEO'],
  quickPrompts: ['先诊断'],
  skillMarkdown: '---\nname: 报价\n---\n',
  skillNames: ['报价'],
}

class SignedGateway extends ExpertHubGateway {
  token: string | undefined = 'token'
  shipped: readonly ShippedExpert[] = []

  protected override gatewayToken(): Promise<string | undefined> {
    return Promise.resolve(this.token)
  }

  protected override shippedExperts(): Promise<readonly ShippedExpert[]> {
    return Promise.resolve(this.shipped)
  }
}

describe('shipped and saved expert uploads', () => {
  const directories: string[] = []
  afterEach(async () => {
    vi.unstubAllGlobals()
    for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
  })

  function signed(): SignedGateway {
    return new SignedGateway(new Context())
  }

  it('lists a shipped expert and uploads it', async () => {
    const gateway = signed()
    gateway.shipped = [SHIPPED, {
      ...SHIPPED,
      id: 'blank',
      description: '',
      persona: '  ',
      skillNames: [],
      skillMarkdown: '',
    }]
    await expect(gateway.uploadable()).resolves.toEqual({ ids: ['geo-optimizer', 'blank'] })
    await expect(gateway.detail({ id: 'geo-optimizer' })).resolves.toMatchObject({ persona: '你是顾问。', skills: ['报价'] })
    await expect(gateway.detail({ id: 'blank' })).resolves.toEqual({ id: 'blank', name: 'GEO 优化专家' })

    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { slug: 'u7-geo-optimizer', version: '1.0.0' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchImpl)
    await expect(gateway.publishModule({ id: 'geo-optimizer' })).resolves.toEqual({
      ok: true, slug: 'u7-geo-optimizer', version: '1.0.0',
    })
    await expect(gateway.publishModule({ id: 'geo-optimizer' })).resolves.toEqual({
      ok: true, slug: 'u7-geo-optimizer', version: '1.0.0',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: false,
      message: '拒绝',
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    await expect(gateway.publishModule({ id: 'geo-optimizer' })).resolves.toEqual({ ok: false, message: '拒绝' })
  })

  it('refuses a signed-in upload when the id is neither saved nor shipped', async () => {
    const gateway = signed()
    await expect(gateway.publishModule({ id: 'missing' })).resolves.toEqual({
      ok: false,
      message: '本机专家目录还没有准备好',
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    await expect(gateway.detail({ id: 'missing' })).resolves.toEqual({ id: 'missing', name: 'missing' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        name: '广场专家',
        description: '',
        persona: '人设',
        version: '1.0.0',
        skill_markdown: 'name: 报价\nname: 报价\nname:\n# 标题\n',
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    await expect(gateway.detail({ id: 'u7-geo' })).resolves.toMatchObject({ persona: '人设', skills: ['报价'] })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { name: '广场专家', description: '', persona: '人设', version: '1.0.0', skill_markdown: '#   \n# 标题\n' },
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    await expect(gateway.detail({ id: 'u7-heading' })).resolves.toMatchObject({ skills: ['标题'] })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { name: '广场专家', description: '说明', persona: '人设', version: '1.0.0', skill_markdown: '正文' },
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    await expect(gateway.detail({ id: 'u7-plain' })).resolves.toEqual({
      id: 'u7-plain', name: '广场专家', description: '说明', persona: '人设',
    })
  })

  it('reads a saved expert and uploads that file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'expert-hub-gateway-'))
    directories.push(directory)
    const publisher: ExpertPublisher = {
      root: directory,
      owned: new Map(),
      async register() { return async () => {} },
      async hasId() { return false },
    }
    await publishExpert(publisher, {
      id: 'mine', name: '我的专家', description: '描述', persona: '人设正文',
      version: '1.0.0', remoteSlug: 'mine',
    })
    // The publisher rides the context the gateway is constructed over:
    // Service protects `ctx`, so the provide happens before construction.
    const gatewayCtx = new Context()
    gatewayCtx.provide('expertPublisher', publisher)
    const gateway = new SignedGateway(gatewayCtx)
    await expect(gateway.detail({ id: 'mine' })).resolves.toMatchObject({ persona: '人设正文' })
    await expect(gateway.uploadable()).resolves.toEqual({ ids: ['mine'] })
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 500 }))
    await expect(gateway.detail({ id: 'missing' })).resolves.toEqual({ id: 'missing', name: 'missing' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { slug: 'u1-mine', version: '1.0.0' },
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    await expect(gateway.publishModule({ id: 'mine' })).resolves.toEqual({ ok: true, slug: 'u1-mine', version: '1.0.0' })
    await expect(gateway.publishModule({ id: 'missing' })).resolves.toEqual({
      ok: false,
      message: '这个专家还没有保存在本机，不能上传',
    })
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
      success: true,
      data: {
        items: [
          { id: 'u1-mine', name: '我的专家', version: '2.0.0' },
          { id: 'other', name: '其他', version: '1.0.0' },
        ],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await expect(gateway.plaza()).resolves.toEqual({
      cards: [
        { slug: 'u1-mine', name: '我的专家', version: '2.0.0', installedVersion: '1.0.0' },
        { slug: 'other', name: '其他', version: '1.0.0' },
      ],
    })
    await expect(gateway.versions()).resolves.toEqual({
      entries: [{ id: 'mine', version: '1.0.0' }],
    })
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    await expect(gateway.versions()).resolves.toEqual({
      entries: [{ id: 'mine', version: '1.0.0' }],
    })
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
      success: true,
      data: { name: '下载', description: '说明', persona: '人设', version: '1.0.0' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await expect(gateway.installModule({ slug: 'u7-download' })).resolves.toEqual({
      ok: true, slug: 'u7-download', version: '1.0.0',
    })
  })

  it('marks a published shipped expert on the plaza and on my experts', async () => {
    const gateway = signed()
    gateway.shipped = [SHIPPED]
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const url = String(input)
      const mine = url.endsWith('/api/expert-hub/mine')
      return new Response(JSON.stringify({
        success: true,
        data: mine
          ? { items: [{ slug: 'u7-geo-optimizer', version: '1.0.0', owner_id: 7 }, { slug: 'u7-gone', version: '9.0.0', owner_id: 7 }] }
          : { items: [{ id: 'u7-geo-optimizer', name: 'GEO 优化专家', version: '1.0.0' }, { id: 'u7-gone', name: '已删', version: '9.0.0' }] },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    await expect(gateway.plaza()).resolves.toEqual({
      cards: [
        { slug: 'u7-geo-optimizer', name: 'GEO 优化专家', version: '1.0.0', ownedVersion: '1.0.0' },
        { slug: 'u7-gone', name: '已删', version: '9.0.0' },
      ],
    })
    await expect(gateway.versions()).resolves.toEqual({
      entries: [{ id: 'geo-optimizer', version: '1.0.0', remoteVersion: '1.0.0' }],
    })
  })
})
