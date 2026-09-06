import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MarketSource } from '@deepseek-ai/dsh-market'
import { CatalogCache, CatalogError } from '../src/catalog.ts'

afterEach(() => { vi.unstubAllGlobals() })

const BOUNDS = { timeoutMs: 1_000, maxBytes: 1_000_000, maxCatalogEntries: 3, cacheTtlMs: 60_000 }

function storeSource(url = 'https://store.example.com/api/v1/plugins'): MarketSource {
  return { id: 'src-1', name: 'Store', kind: 'store-v1', url } as MarketSource
}

function catalogSource(url = 'https://catalog.example.com/v1/plugins'): MarketSource {
  return { id: 'src-2', name: 'Catalog', kind: 'catalog', url } as MarketSource
}

function storeBody(packages: Record<string, unknown>[]): unknown {
  return { packages, meta: { total: packages.length, catalogTotal: 99 } }
}

function storeEntry(id: string, name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    name,
    owner: 'community',
    url: `https://github.com/example/${id}`,
    category: 'tools',
    description: { en: `${name} description`, zh: `${name} 摘要` },
    installMethods: [{ kind: 'npm', code: 'published_package', spec: `pkg-${id}`, revision: '1.0.0' }],
    ...extra,
  }
}

const MANIFEST = {
  schemaVersion: '1',
  name: 'Catalog',
  transport: { kind: 'https-json', endpoint: 'https://catalog.example.com/v1/plugins', method: 'GET' },
  query: { supported: ['q', 'category', 'cursor', 'limit'], defaultLimit: 2, maxLimit: 5 },
}

describe('store-v1 sources', () => {
  it('fetches once per cache lifetime and observes the full list', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(storeBody([storeEntry('a', 'Alpha'), storeEntry('b', 'Beta')])), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const cache = new CatalogCache()
    await cache.ensure(storeSource(), BOUNDS)
    await cache.ensure(storeSource(), BOUNDS)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(cache.size('src-1')).toBe(2)
    expect(cache.observed('src-1', 'a')?.npmPackage).toBe('pkg-a')
    expect(cache.observed('src-1', 'ghost')).toBeUndefined()
  })

  it('refetches after the TTL passes', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(storeBody([storeEntry('a', 'Alpha')])), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const cache = new CatalogCache()
    await cache.ensure(storeSource(), { ...BOUNDS, cacheTtlMs: 0 })
    await cache.ensure(storeSource(), { ...BOUNDS, cacheTtlMs: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('filters client-side across name, summary, package, publisher, and id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(storeBody([
      storeEntry('todo', 'Todo kit'),
      storeEntry('notes', 'Notes kit', { description: { en: 'keeps notes' }, owner: 'archivist', installMethods: [{ kind: 'npm', code: 'published_package', spec: 'pkg-todo' }] }),
      storeEntry('web', 'Web kit', { category: 'web' }),
    ])), { status: 200 })))
    const cache = new CatalogCache()
    const source = storeSource()

    const all = await cache.browse(source, { limit: 50 }, BOUNDS)
    expect(all.entries).toHaveLength(3)
    expect(all.total).toBe(3)
    expect(all.nextCursor).toBeNull()

    expect((await cache.browse(source, { query: 'todo' }, BOUNDS)).entries.map(entry => entry.entryId)).toEqual(['todo', 'notes'])
    expect((await cache.browse(source, { query: 'archivist' }, BOUNDS)).entries.map(entry => entry.entryId)).toEqual(['notes'])
    expect((await cache.browse(source, { query: 'keeps' }, BOUNDS)).entries.map(entry => entry.entryId)).toEqual(['notes'])
    expect((await cache.browse(source, { query: 'WEB' }, BOUNDS)).entries.map(entry => entry.entryId)).toEqual(['web'])
    expect((await cache.browse(source, { category: 'web' }, BOUNDS)).entries.map(entry => entry.entryId)).toEqual(['web'])
    expect((await cache.browse(source, { query: 'nothing-matches' }, BOUNDS)).entries).toHaveLength(0)
  })

  it('pages with numeric cursors and clamps the page size', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(storeBody([
      storeEntry('a', 'A'), storeEntry('b', 'B'), storeEntry('c', 'C'), storeEntry('d', 'D'),
    ])), { status: 200 })))
    const cache = new CatalogCache()
    const source = storeSource()
    const bounds = { ...BOUNDS, maxCatalogEntries: 10 }

    const page1 = await cache.browse(source, { limit: 3 }, bounds)
    expect(page1.entries.map(entry => entry.entryId)).toEqual(['a', 'b', 'c'])
    expect(page1.nextCursor).toBe('3')

    const page2 = await cache.browse(source, { limit: 3, cursor: page1.nextCursor ?? '' }, bounds)
    expect(page2.entries.map(entry => entry.entryId)).toEqual(['d'])
    expect(page2.nextCursor).toBeNull()

    const fromGarbage = await cache.browse(source, { limit: 3, cursor: 'not-a-number' }, bounds)
    expect(fromGarbage.entries.map(entry => entry.entryId)).toEqual(['a', 'b', 'c'])
    const fromNegative = await cache.browse(source, { limit: 3, cursor: '-5' }, bounds)
    expect(fromNegative.entries.map(entry => entry.entryId)).toEqual(['a', 'b', 'c'])
    const clamped = await cache.browse(source, { limit: 10_000 }, bounds)
    expect(clamped.entries).toHaveLength(4)
  })

  it('fails loud on transport failures, malformed payloads, and oversized lists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const cache = new CatalogCache()
    await expect(cache.ensure(storeSource(), BOUNDS)).rejects.toThrow(/catalog read failed/)

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ packages: 'nope' }), { status: 200 })))
    await expect(cache.ensure(storeSource(), BOUNDS)).rejects.toThrow(/invalid catalog/)

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(storeBody([
      storeEntry('a', 'A'), storeEntry('b', 'B'), storeEntry('c', 'C'), storeEntry('d', 'D'),
    ])), { status: 200 })))
    await expect(cache.ensure(storeSource(), BOUNDS)).rejects.toThrow(/above the 3-entry limit/)
  })

  it('drops one source and keeps others', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(storeBody([storeEntry('a', 'A')])), { status: 200 })))
    const cache = new CatalogCache()
    await cache.ensure(storeSource(), BOUNDS)
    cache.drop('src-1')
    expect(cache.size('src-1')).toBe(0)
    expect(cache.observed('src-1', 'a')).toBeUndefined()
  })

  it('deduplicates repeated entry ids within one page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      packages: [storeEntry('a', 'Alpha'), storeEntry('a', 'Alpha again')],
    }), { status: 200 })))
    const cache = new CatalogCache()
    const page = await cache.browse(storeSource(), { limit: 50 }, BOUNDS)
    expect(page.entries).toHaveLength(1)
    expect(page.entries[0]?.name).toBe('Alpha again')
    expect(cache.size('src-1')).toBe(1)
  })

  it('describes a non-Error stream rejection through its string form', async () => {
    const hostile = {
      ok: true,
      status: 200,
      headers: new Headers(),
      body: { getReader: () => ({ read: () => Promise.reject('boom'), cancel: async () => {} }) },
    } as unknown as Response
    vi.stubGlobal('fetch', vi.fn(async () => hostile))
    const cache = new CatalogCache()
    await expect(cache.browse(storeSource(), { limit: 50 }, BOUNDS)).rejects.toThrow(/catalog read failed: boom/)
  })

  it('rejects a forged source kind through the exhaustiveness helper', async () => {
    const cache = new CatalogCache()
    const forged = { id: 'x', name: 'X', kind: 'rogue', url: 'https://x.example.com/' } as unknown as MarketSource
    await expect(cache.ensure(forged, BOUNDS)).rejects.toThrow(/unreachable variant/)
    // With a fresh cache under the same id, ensure short-circuits and the
    // dispatch itself reaches the exhaustiveness helper.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(storeBody([storeEntry('a', 'A')])), { status: 200 })))
    await cache.ensure({ id: 'x', name: 'X', kind: 'store-v1', url: 'https://x.example.com/api/v1/plugins' } as MarketSource, BOUNDS)
    await expect(cache.browse(forged, {}, BOUNDS)).rejects.toThrow(/unreachable variant/)
  })
})

describe('catalog sources', () => {
  it('validates the manifest, pins the endpoint, and passes supported query params', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(MANIFEST), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ schemaVersion: '1', items: [], page: {} }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const cache = new CatalogCache()
    const source = catalogSource()

    await cache.ensure(source, BOUNDS)
    expect(cache.size('src-2')).toBe(0)
    await cache.browse(source, { query: 'todo', category: 'tools', cursor: 'c1', limit: 99 }, BOUNDS)
    const requested = new URL((fetchMock.mock.calls[1]![0] as URL))
    expect(requested.pathname).toBe('/v1/plugins')
    expect(requested.searchParams.get('q')).toBe('todo')
    expect(requested.searchParams.get('category')).toBe('tools')
    expect(requested.searchParams.get('cursor')).toBe('c1')
    // The client limit is clamped to the manifest's maxLimit.
    expect(requested.searchParams.get('limit')).toBe('5')
  })

  it('omits params the source does not support and applies the manifest default limit', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...MANIFEST,
        query: { supported: ['q'], defaultLimit: 2, maxLimit: 5 },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ schemaVersion: '1', items: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...MANIFEST,
        query: { supported: ['q', 'limit'], defaultLimit: 2, maxLimit: 5 },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ schemaVersion: '1', items: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const cache = new CatalogCache()

    // `limit` is unsupported: no parameter is sent, whatever the query asks.
    await cache.browse(catalogSource(), { query: 'todo', category: 'tools', cursor: 'c1', limit: 4 }, BOUNDS)
    const requested = new URL(fetchMock.mock.calls[1]![0] as URL)
    expect(requested.searchParams.get('q')).toBe('todo')
    expect(requested.searchParams.get('category')).toBeNull()
    expect(requested.searchParams.get('cursor')).toBeNull()
    expect(requested.searchParams.get('limit')).toBeNull()

    // `limit` is supported and the query omits it: the manifest default applies.
    await new CatalogCache().browse(catalogSource(), { query: 'todo' }, BOUNDS)
    const second = new URL(fetchMock.mock.calls[3]![0] as URL)
    expect(second.searchParams.get('limit')).toBe('2')
  })

  it('normalizes and observes page items and passes the page cursor through', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(MANIFEST), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        schemaVersion: '1',
        items: [{ id: 'p/1', name: 'One', package: { registry: 'npm', name: 'pkg-one' } }],
        page: { nextCursor: 'next', total: 12 },
      }), { status: 200 })))
    const cache = new CatalogCache()
    const source = catalogSource()
    const page = await cache.browse(source, {}, BOUNDS)
    expect(page.entries).toHaveLength(1)
    expect(page.nextCursor).toBe('next')
    expect(page.total).toBe(12)
    expect(cache.size('src-2')).toBe(1)
  })

  it('stops observing once the entry cap is reached but still returns pages', async () => {
    const items = Array.from({ length: 5 }, (_, index) => ({ id: `p/${index}`, name: `N${index}`, package: { registry: 'npm', name: `pkg-${index}` } }))
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(MANIFEST), { status: 200 }))
      .mockResolvedValue(new Response(JSON.stringify({ schemaVersion: '1', items, page: { total: 5 } }), { status: 200 })))
    const cache = new CatalogCache()
    const page = await cache.browse(catalogSource(), {}, BOUNDS)
    expect(page.entries).toHaveLength(5)
    expect(cache.size('src-2')).toBe(3)
  })

  it('searches for an unobserved entry id before giving up', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(MANIFEST), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        schemaVersion: '1',
        items: [{ id: 'p/1', name: 'One', package: { registry: 'npm', name: 'pkg-one' } }],
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const cache = new CatalogCache()
    const found = await cache.ensureEntryObserved(catalogSource(), 'p/1', BOUNDS)
    expect(found?.npmPackage).toBe('pkg-one')
    // The id probe rides the source's own q parameter.
    expect(new URL(fetchMock.mock.calls[1]![0] as URL).searchParams.get('q')).toBe('p/1')

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ schemaVersion: '1', items: [] }), { status: 200 }))
    const missing = await cache.ensureEntryObserved(catalogSource(), 'p/ghost', BOUNDS)
    expect(missing).toBeUndefined()
  })

  it('returns cached entries for a store source without a second fetch', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(storeBody([storeEntry('a', 'Alpha')])), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const cache = new CatalogCache()
    const found = await cache.ensureEntryObserved(storeSource(), 'a', BOUNDS)
    expect(found?.npmPackage).toBe('pkg-a')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails loud on a malformed manifest, off-origin endpoints, and a wrong endpoint path', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ schemaVersion: 'nope' }), { status: 200 })))
    const cache = new CatalogCache()
    await expect(cache.ensure(catalogSource(), BOUNDS)).rejects.toThrow(/invalid manifest/)

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ...MANIFEST,
      transport: { kind: 'https-json', endpoint: 'https://elsewhere.example.com/v1/plugins', method: 'GET' },
    }), { status: 200 })))
    await expect(cache.ensure(catalogSource(), BOUNDS)).rejects.toThrow(/leaves the manifest origin/)

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ...MANIFEST,
      transport: { kind: 'https-json', endpoint: 'https://catalog.example.com/v2/plugins', method: 'GET' },
    }), { status: 200 })))
    await expect(cache.ensure(catalogSource(), BOUNDS)).rejects.toThrow(/must end in \/v1\/plugins/)

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(cache.ensure(catalogSource(), BOUNDS)).rejects.toThrow(/manifest read failed/)
  })

  it('falls back to full parameter support and the default page size when the manifest omits query', async () => {
    const { query: _omitted, ...withoutQuery } = MANIFEST
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(withoutQuery), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ schemaVersion: '1', items: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await new CatalogCache().browse(catalogSource(), { query: 'todo', limit: 999 }, BOUNDS)
    const requested = new URL(fetchMock.mock.calls[1]![0] as URL)
    expect(requested.searchParams.get('q')).toBe('todo')
    expect(requested.searchParams.get('limit')).toBe('50')
  })

  it('fails loud when the page read fails and when a page item carries no usable name', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(MANIFEST), { status: 200 }))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(new CatalogCache().browse(catalogSource(), {}, BOUNDS)).rejects.toThrow(/page read failed/)

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(MANIFEST), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        schemaVersion: '1',
        items: [
          { id: 'p/1', name: 'One', package: { registry: 'npm', name: 'pkg-one' } },
          { id: 'p/2', package: { registry: 'npm', name: 'pkg-two' } },
        ],
      }), { status: 200 })))
    const page = await new CatalogCache().browse(catalogSource(), {}, BOUNDS)
    expect(page.entries.map(entry => entry.entryId)).toEqual(['p/1'])
  })

  it('fails loud on a malformed provider page and a missing cache entry', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(MANIFEST), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ schemaVersion: '1', items: 'nope' }), { status: 200 })))
    const cache = new CatalogCache()
    await expect(cache.browse(catalogSource(), {}, BOUNDS)).rejects.toThrow(/invalid provider page/)

    // A cache state lost its manifest between ensure and browse names the inconsistency.
    await cache.ensure(catalogSource(), BOUNDS)
    const stolen = cache as unknown as {
      sources: Map<string, { manifest?: unknown; entries: Map<string, unknown>; orderedIds: string[]; fetchedAt: number }>
    }
    stolen.sources.set('src-2', { entries: new Map(), orderedIds: [], fetchedAt: Date.now() })
    await expect(cache.browse(catalogSource(), {}, BOUNDS)).rejects.toBeInstanceOf(CatalogError)
    await expect(cache.browse(catalogSource(), {}, BOUNDS)).rejects.toThrow(/no manifest/)
  })
})
