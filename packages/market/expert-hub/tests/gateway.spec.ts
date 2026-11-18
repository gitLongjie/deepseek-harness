import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type {
  Market, MarketBundleId, MarketCatalogEntry, MarketCatalogPage, MarketEntryId, MarketSourceId,
} from '@deepseek-ai/dsh-market'
import ExpertHubGateway from '../src/index.ts'
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
})
