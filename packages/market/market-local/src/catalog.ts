/**
 * Catalog source reads: manifest discovery, page fetching, client-side
 * filtering, and the per-source observed-entry cache that install decisions
 * resolve against. Server-side sources translate a browse into one bounded
 * endpoint call; bounded-projection sources fetch their whole list once per
 * cache lifetime and filter here.
 * @module @deepseek-ai/dsh-market-local/catalog
 */

import type { MarketBrowseQuery, MarketCatalogEntry, MarketCatalogPage, MarketSource } from '@deepseek-ai/dsh-market'
import {
  catalogProviderPageSchema,
  catalogSourceManifestSchema,
  describeZodIssues,
  normalizeCatalogItem,
  normalizeStoreV1Item,
  storeV1CatalogSchema,
  type CatalogSourceManifest,
} from './schemas.ts'
import { fetchJsonBounded } from './http.ts'

/** Transport and cache bounds, resolved from the owning plugin's Config. */
export interface CatalogBounds {
  readonly timeoutMs: number
  readonly maxBytes: number
  readonly maxCatalogEntries: number
  readonly cacheTtlMs: number
}

/** Default page size for sources that support server-side limits. */
const DEFAULT_PAGE_LIMIT = 50

/** Hard cap on one page's size regardless of what a source advertises. */
const MAX_PAGE_LIMIT = 200

interface SourceCache {
  fetchedAt: number
  /** catalog kind: the validated manifest pinning the endpoint and query caps. */
  manifest?: CatalogSourceManifest
  /** Observed entries by id: the whole list for store-v1, browsed pages for catalog. */
  entries: Map<string, MarketCatalogEntry>
  /** store-v1: entry ids in source order for stable pagination; empty for catalog. */
  orderedIds: string[]
}

/** One catalog read rejected before or during normalization. */
export class CatalogError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CatalogError'
  }
}

/**
 * Per-source catalog cache. One instance lives for the market service's
 * lifetime; the CLI builds a short-lived one per invocation. The cache is the
 * only place entries come from: install decisions resolve identities against
 * what this service itself observed, never against a caller-supplied name.
 */
export class CatalogCache {
  private readonly sources = new Map<string, SourceCache>()

  /** The current observed-entry count for one source (diagnostics and tests). */
  size(sourceId: string): number {
    return this.sources.get(sourceId)?.entries.size ?? 0
  }

  /** Drop one source's cache entirely. */
  drop(sourceId: string): void {
    this.sources.delete(sourceId)
  }

  /** Return the observed entry for a source without fetching. */
  observed(sourceId: string, entryId: string): MarketCatalogEntry | undefined {
    return this.sources.get(sourceId)?.entries.get(entryId)
  }

  /**
   * Guarantee a fresh cache for the source, refetching when the cache is cold
   * or older than the TTL.
   * @param source - the source to cache.
   * @param bounds - the transport and cache bounds.
   * @returns the source's current cache.
   */
  async ensure(source: MarketSource, bounds: CatalogBounds): Promise<SourceCache> {
    const cached = this.sources.get(source.id)
    if (cached !== undefined && Date.now() - cached.fetchedAt < bounds.cacheTtlMs) return cached
    if (source.kind === 'store-v1') {
      const cache = await fetchStoreV1(source, bounds)
      this.sources.set(source.id, cache)
      return cache
    }
    if (source.kind === 'catalog') {
      const cache = await fetchManifest(source, bounds)
      this.sources.set(source.id, cache)
      return cache
    }
    assertNever(source.kind)
  }

  /**
   * Resolve one entry to install identity, fetching through the source's own
   * query when the cache has not observed it yet: a catalog source is searched
   * for the id, a bounded-projection source refreshes its list.
   * @param source - the source to resolve against.
   * @param entryId - the source-local entry id.
   * @param bounds - the transport and cache bounds.
   * @returns the observed entry, or undefined when the source does not know the id.
   */
  async ensureEntryObserved(source: MarketSource, entryId: string, bounds: CatalogBounds): Promise<MarketCatalogEntry | undefined> {
    await this.ensure(source, bounds)
    const hit = this.observed(source.id, entryId)
    if (hit !== undefined || source.kind !== 'catalog') return hit
    await this.browse(source, { query: entryId, limit: MAX_PAGE_LIMIT }, bounds)
    return this.observed(source.id, entryId)
  }

  /**
   * Read one page from the source, translating the query per source kind.
   * @param source - the source to browse.
   * @param query - free-text query, category, cursor, and page size.
   * @param bounds - the transport and cache bounds.
   * @throws CatalogError when the source read or its payload validation fails.
   */
  async browse(source: MarketSource, query: MarketBrowseQuery, bounds: CatalogBounds): Promise<MarketCatalogPage> {
    const cache = await this.ensure(source, bounds)
    if (source.kind === 'store-v1') return browseStoreV1(cache, query)
    if (source.kind === 'catalog') return this.browseCatalog(cache, source, query, bounds)
    assertNever(source.kind)
  }

  private async browseCatalog(
    cache: SourceCache,
    source: MarketSource,
    query: MarketBrowseQuery,
    bounds: CatalogBounds,
  ): Promise<MarketCatalogPage> {
    const manifest = cache.manifest
    if (manifest === undefined) throw new CatalogError(`source ${source.id} has no manifest`)
    const supported = manifest.query?.supported ?? ['q', 'category', 'cursor', 'limit']
    const maxLimit = manifest.query?.maxLimit ?? DEFAULT_PAGE_LIMIT
    const defaultLimit = manifest.query?.defaultLimit ?? DEFAULT_PAGE_LIMIT
    const endpoint = new URL(manifest.transport.endpoint)
    if (query.query !== undefined && supported.includes('q')) endpoint.searchParams.set('q', query.query)
    if (query.category !== undefined && supported.includes('category')) endpoint.searchParams.set('category', query.category)
    if (query.cursor !== undefined && supported.includes('cursor')) endpoint.searchParams.set('cursor', query.cursor)
    if (supported.includes('limit')) {
      endpoint.searchParams.set('limit', String(clampLimit(query.limit, defaultLimit, maxLimit)))
    }
    let payload: unknown
    try {
      payload = await fetchJsonBounded(endpoint.href, { timeoutMs: bounds.timeoutMs, maxBytes: bounds.maxBytes })
    } catch (error) {
      throw new CatalogError(`source ${source.name} page read failed: ${describe(error)}`)
    }
    const parsed = catalogProviderPageSchema.safeParse(payload)
    if (!parsed.success) throw new CatalogError(`source ${source.name} returned an invalid provider page: ${describeZodIssues(parsed.error)}`)
    for (const item of parsed.data.items) {
      if (cache.entries.size >= bounds.maxCatalogEntries) break
      const normalized = normalizeCatalogItem(source.id, item)
      if (normalized !== undefined) cache.entries.set(normalized.entryId, normalized)
    }
    return {
      entries: parsed.data.items
        .map(item => normalizeCatalogItem(source.id, item))
        .filter((item): item is MarketCatalogEntry => item !== undefined),
      nextCursor: parsed.data.page?.nextCursor ?? null,
      total: parsed.data.page?.total ?? null,
    }
  }
}

function clampLimit(requested: number | undefined, defaultLimit: number, maxLimit: number): number {
  const base = requested ?? defaultLimit
  return Math.max(1, Math.min(base, maxLimit, MAX_PAGE_LIMIT))
}

async function fetchManifest(source: MarketSource, bounds: CatalogBounds): Promise<SourceCache> {
  let payload: unknown
  try {
    payload = await fetchJsonBounded(source.url, { timeoutMs: bounds.timeoutMs, maxBytes: bounds.maxBytes })
  } catch (error) {
    throw new CatalogError(`source ${source.name} manifest read failed: ${describe(error)}`)
  }
  const parsed = catalogSourceManifestSchema.safeParse(payload)
  if (!parsed.success) throw new CatalogError(`source ${source.name} returned an invalid manifest: ${describeZodIssues(parsed.error)}`)
  const manifest = parsed.data
  // The manifest schema guarantees an absolute https:// endpoint and the
  // manifest fetch guarantees the source URL parses, so new URL cannot throw here.
  if (new URL(manifest.transport.endpoint).origin !== new URL(source.url).origin) {
    throw new CatalogError(`source ${source.name} endpoint ${manifest.transport.endpoint} leaves the manifest origin`)
  }
  if (!manifest.transport.endpoint.endsWith('/v1/plugins')) {
    throw new CatalogError(`source ${source.name} endpoint must end in /v1/plugins`)
  }
  return { fetchedAt: Date.now(), manifest, entries: new Map(), orderedIds: [] }
}

async function fetchStoreV1(source: MarketSource, bounds: CatalogBounds): Promise<SourceCache> {
  let payload: unknown
  try {
    payload = await fetchJsonBounded(source.url, { timeoutMs: bounds.timeoutMs, maxBytes: bounds.maxBytes })
  } catch (error) {
    throw new CatalogError(`source ${source.name} catalog read failed: ${describe(error)}`)
  }
  const parsed = storeV1CatalogSchema.safeParse(payload)
  if (!parsed.success) throw new CatalogError(`source ${source.name} returned an invalid catalog: ${describeZodIssues(parsed.error)}`)
  if (parsed.data.packages.length > bounds.maxCatalogEntries) {
    throw new CatalogError(
      `source ${source.name} lists ${parsed.data.packages.length} entries, above the ${bounds.maxCatalogEntries}-entry limit`,
    )
  }
  const entries = new Map<string, MarketCatalogEntry>()
  const orderedIds: string[] = []
  for (const item of parsed.data.packages) {
    const normalized = normalizeStoreV1Item(source.id, item)
    if (!entries.has(normalized.entryId)) orderedIds.push(normalized.entryId)
    entries.set(normalized.entryId, normalized)
  }
  return { fetchedAt: Date.now(), entries, orderedIds }
}

function browseStoreV1(cache: SourceCache, query: MarketBrowseQuery): MarketCatalogPage {
  const ids = cache.orderedIds
  const needle = query.query?.toLowerCase()
  const matching = ids
    .map(id => cache.entries.get(id))
    .filter((entry): entry is MarketCatalogEntry => entry !== undefined)
    .filter(entry => (query.category === undefined || entry.categories.includes(query.category))
      && (needle === undefined
        || entry.name.toLowerCase().includes(needle)
        || entry.summary.toLowerCase().includes(needle)
        || (entry.npmPackage ?? '').toLowerCase().includes(needle)
        || (entry.publisher ?? '').toLowerCase().includes(needle)
        || entry.entryId.toLowerCase().includes(needle)))
  const limit = clampLimit(query.limit, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT)
  const offset = query.cursor === undefined ? 0 : Number.parseInt(query.cursor, 10)
  const start = Number.isInteger(offset) && offset >= 0 ? offset : 0
  const next = start + limit
  return {
    entries: matching.slice(start, next),
    nextCursor: next < matching.length ? String(next) : null,
    total: matching.length,
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Exhaustiveness helper for the closed source-kind union. */
function assertNever(value: never): never {
  throw new Error(`unreachable variant: ${String(value)}`)
}
