import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Market, MarketBundleId, MarketCatalogEntry, MarketCatalogPage, MarketEntryRef, MarketInstallability, MarketSource, MarketSourceId } from '@deepseek-ai/dsh-market'
import MarketGateway from '../src/index.ts'

// Test fixtures cast the wire strings into the branded identities once, at the
// fixture assembly point; every call site below uses these constants.
const SOURCE_ID = 'src-1' as MarketSourceId
const ENTRY_ID = 'todo-kit' as MarketCatalogEntry['entryId']
const BUNDLE_ID = 'dsh-plugin-todo-kit' as MarketBundleId
const SOURCE = {
  id: SOURCE_ID,
  name: 'Store',
  kind: 'store-v1',
  url: 'https://store.example.com/api/v1/plugins',
} as MarketSource
const ENTRY: MarketCatalogEntry = {
  sourceId: SOURCE_ID,
  entryId: ENTRY_ID,
  name: 'todo kit',
  summary: 'Todos',
  categories: ['tools'],
  keywords: [],
  npmPackage: 'dsh-plugin-todo-kit',
  latestVersion: '1.2.3',
}
const PAGE: MarketCatalogPage = { entries: [ENTRY], nextCursor: null, total: 1 }
const INSTALLABLE: MarketInstallability = { installable: true, npmPackage: 'dsh-plugin-todo-kit', resolvedVersion: '1.2.3', reasons: [] }

function harness(): { gateway: MarketGateway; market: Market } {
  const ctx = new Context()
  const market = {
    listSources: vi.fn(async () => [SOURCE]),
    selectedSource: vi.fn(async () => SOURCE_ID),
    selectSource: vi.fn(async () => {}),
    addSource: vi.fn(async () => SOURCE),
    removeSource: vi.fn(async () => {}),
    browse: vi.fn(async () => PAGE),
    entryDetail: vi.fn(async () => ENTRY),
    installability: vi.fn(async () => INSTALLABLE),
    install: vi.fn(async () => ({ ok: true, packageName: 'dsh-plugin-todo-kit', version: '1.2.3', restartRequired: true })),
    installed: vi.fn(async () => []),
    uninstall: vi.fn(async () => ({ ok: true, packageName: 'dsh-plugin-todo-kit', restartRequired: true })),
  }
  ctx.provide('market', market as unknown as Market)
  return { gateway: new MarketGateway(ctx), market: market as unknown as Market }
}

describe('market gateway projection', () => {
  it('binds the market wire namespace under its own service key and the injected service', () => {
    const { gateway } = harness()
    expect(gateway.typertRemote.serviceKey).toBe('marketGateway')
    expect(gateway.typertRemote.namespace).toBe('market')
    expect((gateway as unknown as { name: string }).name).toBe('marketGateway')
  })

  it('projects source reads and selection', async () => {
    const { gateway, market } = harness()
    await expect(gateway.listSources()).resolves.toEqual({ sources: [SOURCE] })
    await expect(gateway.selectedSource()).resolves.toEqual({ sourceId: SOURCE_ID })
    await gateway.selectSource({ sourceId: SOURCE_ID })
    expect(market.selectSource).toHaveBeenCalledWith(SOURCE_ID)
    await expect(gateway.addSource({ input: { name: 'Store', kind: 'store-v1', url: SOURCE.url } }))
      .resolves.toEqual({ source: SOURCE })
    await gateway.removeSource({ sourceId: SOURCE_ID })
    expect(market.removeSource).toHaveBeenCalledWith(SOURCE_ID)
  })

  it('projects browse, installability, install, installed, and uninstall', async () => {
    const { gateway, market } = harness()
    const ref: MarketEntryRef = { sourceId: SOURCE_ID, entryId: ENTRY_ID }
    await expect(gateway.browse({ query: { limit: 20 } })).resolves.toEqual(PAGE)
    expect(market.browse).toHaveBeenCalledWith({ limit: 20 })
    await expect(gateway.installability({ ref })).resolves.toEqual(INSTALLABLE)
    await expect(gateway.install({ ref })).resolves.toEqual({
      ok: true, packageName: 'dsh-plugin-todo-kit', version: '1.2.3', restartRequired: true,
    })
    await expect(gateway.installed()).resolves.toEqual({ plugins: [] })
    await expect(gateway.uninstall({ bundleId: BUNDLE_ID })).resolves.toEqual({
      ok: true, packageName: 'dsh-plugin-todo-kit', restartRequired: true,
    })
    expect(market.uninstall).toHaveBeenCalledWith(BUNDLE_ID)
  })

  it('wraps entryDetail as found and not-found outcomes', async () => {
    const { gateway, market } = harness()
    const ref: MarketEntryRef = { sourceId: SOURCE_ID, entryId: ENTRY_ID }
    await expect(gateway.entryDetail({ ref })).resolves.toEqual({ found: true, entry: ENTRY })

    vi.mocked(market.entryDetail).mockResolvedValueOnce(undefined)
    await expect(gateway.entryDetail({ ref })).resolves.toEqual({ found: false })
  })
})
