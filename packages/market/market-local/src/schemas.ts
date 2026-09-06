/**
 * Untrusted catalog payload schemas and their normalization into
 * {@link MarketCatalogEntry} values. Every payload crosses a wire boundary, so
 * parsing is strict: unknown provider fields are dropped, identities and URLs
 * are re-validated here, and a page that fails validation fails the read
 * instead of entering the cache.
 * @module @deepseek-ai/dsh-market-local/schemas
 */

import { z } from 'zod'
import type { MarketAttribution, MarketCatalogEntry, MarketEntryId, MarketSource, MarketSourceId, MarketSourceKind } from '@deepseek-ai/dsh-market'

/** Source-local entry identity grammar (modeled on the community market provider contract). */
const ENTRY_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/
/** Provider-declared display text: control characters, bidi overrides, and invisibles are rejected. */
const PLAIN_TEXT = /^[^\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]*$/

const httpsDisplayUrl = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' && url.username === '' && url.password === ''
    } catch {
      return false
    }
  }, 'must be an absolute https:// URL without user info')

const plainText = (max: number): z.ZodType<string> =>
  z.string().max(max).refine(value => PLAIN_TEXT.test(value), 'must not contain control or invisible characters')

/**
 * Render a zod failure as one line of all issue messages, so callers embed the
 * complete diagnostics in their own error text.
 * @param error - the failed zod result's error.
 * @returns the joined issue messages.
 */
export function describeZodIssues(error: z.ZodError): string {
  return error.issues.map(issue => issue.message).join('; ')
}

/** One standard catalog source manifest (`catalog` kind). */
export const catalogSourceManifestSchema = z.object({
  schemaVersion: z.literal('1'),
  name: plainText(120),
  description: plainText(500).optional(),
  homepage: httpsDisplayUrl.optional(),
  attribution: z.object({ name: plainText(120), url: httpsDisplayUrl }).optional(),
  transport: z.object({
    kind: z.literal('https-json'),
    endpoint: httpsDisplayUrl,
    method: z.literal('GET'),
  }),
  query: z
    .object({
      supported: z.array(z.enum(['q', 'category', 'cursor', 'limit'])),
      defaultLimit: z.number().int().min(1).max(200),
      maxLimit: z.number().int().min(1).max(200),
    })
    .optional(),
})

export type CatalogSourceManifest = z.infer<typeof catalogSourceManifestSchema>

const catalogItemSchema = z
  .object({
    id: z.string().max(160).regex(ENTRY_ID),
    name: plainText(160).optional(),
    displayName: plainText(160).optional(),
    summary: plainText(500).optional(),
    description: plainText(4000).optional(),
    homepage: httpsDisplayUrl.optional(),
    latestVersion: plainText(64).optional(),
    license: plainText(64).optional(),
    categories: z.array(plainText(64)).max(12).optional(),
    keywords: z.array(plainText(64)).max(24).optional(),
    repository: z.object({ url: httpsDisplayUrl, subdirectory: z.string().max(240).optional() }).optional(),
    package: z.object({ registry: z.literal('npm'), name: z.string().max(214) }).optional(),
    publisher: z.object({ name: plainText(120) }).optional(),
  })
  .refine(item => item.repository !== undefined || item.package !== undefined, 'needs a repository or a package')

/** One standard provider page (`catalog` kind endpoint response). */
export const catalogProviderPageSchema = z.object({
  schemaVersion: z.literal('1'),
  items: z.array(catalogItemSchema).max(200),
  page: z
    .object({
      nextCursor: z.string().min(1).max(2048).optional(),
      total: z.number().int().min(0).optional(),
    })
    .optional(),
})

const storeV1InstallMethodSchema = z.object({
  kind: z.string(),
  spec: z.string().max(214).optional(),
  code: z.string().max(64).optional(),
  revision: z.string().max(64).nullable().optional(),
})

/** One DSH 1024Store `/api/v1/plugins` projection page (`store-v1` kind). */
export const storeV1CatalogSchema = z.object({
  packages: z.array(
    z
      .object({
        id: z.string().max(240).regex(ENTRY_ID),
        name: z.string().max(160),
        owner: z.string().max(120).optional(),
        url: z.string().max(2048).optional(),
        category: z.string().max(64).optional(),
        description: z.object({ en: z.string().optional(), zh: z.string().optional() }).optional(),
        installMethods: z.array(storeV1InstallMethodSchema).max(12).optional(),
        stars: z.number().optional(),
      })
      .refine(item => item.description?.en !== undefined || item.description?.zh !== undefined || item.url !== undefined),
  ),
  meta: z
    .object({
      total: z.number().int().min(0).optional(),
      catalogTotal: z.number().int().min(0).optional(),
    })
    .optional(),
})

export type StoreV1Catalog = z.infer<typeof storeV1CatalogSchema>

/** The npm registry `latest` document fields the installability check reads. */
export const registryLatestSchema = z.object({
  name: z.string(),
  version: z.string(),
  dsh: z
    .object({
      bundle: z.object({ patch: z.string() }).passthrough(),
    })
    .passthrough()
    .optional(),
})

export type RegistryLatest = z.infer<typeof registryLatestSchema>

/** The persisted market source registry document. */
export const storedSourcesSchema = z.object({
  schema: z.literal(1),
  selected: z.string().max(64).nullable(),
  sources: z
    .array(
      z.object({
        id: z.string().max(64).regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/),
        name: plainText(120),
        kind: z.enum(['catalog', 'store-v1']),
        url: httpsDisplayUrl,
        attribution: z.object({ name: plainText(120), url: httpsDisplayUrl }).optional(),
      }),
    )
    .max(16),
})

export type StoredSources = z.infer<typeof storedSourcesSchema>

/**
 * The source registry in its public face: the persisted document is plain
 * JSON, so the owning boundary rebrands ids and drops the wire-optional
 * `undefined` from attribution in one cast after schema validation.
 */
export interface StoredSourcesFile {
  readonly schema: 1
  readonly selected: string | null
  readonly sources: readonly MarketSource[]
}

/**
 * The one npm package identity a store-v1 entry contributes. Only the
 * structured, published-package npm method counts — deprecated aliases and
 * GitHub specs never do — and an entry naming several distinct packages
 * contributes none: the identity must be unambiguous.
 */
export function storeV1NpmIdentity(entry: z.infer<typeof storeV1CatalogSchema>['packages'][number]): {
  npmPackage?: string
  latestVersion?: string
} {
  const specs = new Set<string>()
  let revision: string | undefined
  for (const method of entry.installMethods ?? []) {
    if (method.kind !== 'npm' || method.code !== 'published_package' || method.spec === undefined) continue
    specs.add(method.spec)
    revision ??= method.revision ?? undefined
  }
  if (specs.size !== 1) return {}
  // The schema allows an empty spec string; an empty identity is no identity.
  const [npmPackage = ''] = specs
  if (npmPackage === '') return {}
  return revision === undefined ? { npmPackage } : { npmPackage, latestVersion: revision }
}

/** Attach the source context to one normalized entry body. */
function entry(
  sourceId: string,
  entryId: string,
  body: Omit<MarketCatalogEntry, 'sourceId' | 'entryId'>,
): MarketCatalogEntry {
  return { sourceId: sourceId as MarketSourceId, entryId: entryId as MarketEntryId, ...body }
}

/**
 * Normalize one standard provider-page item.
 * @param sourceId - the owning source's identity.
 * @param item - the validated provider item.
 * @returns the normalized entry, or undefined when the item is incomplete (no name and no package).
 */
export function normalizeCatalogItem(
  sourceId: string,
  item: z.infer<typeof catalogItemSchema>,
): MarketCatalogEntry | undefined {
  const name = item.displayName ?? item.name
  if (name === undefined) return undefined
  return entry(sourceId, item.id, {
    name,
    summary: item.summary ?? '',
    ...(item.description !== undefined ? { description: item.description } : {}),
    categories: item.categories ?? [],
    keywords: item.keywords ?? [],
    ...(item.repository !== undefined ? { repository: item.repository.url } : {}),
    ...(item.homepage !== undefined ? { homepage: item.homepage } : {}),
    ...(item.package?.registry === 'npm' ? { npmPackage: item.package.name } : {}),
    ...(item.latestVersion !== undefined ? { latestVersion: item.latestVersion } : {}),
    ...(item.license !== undefined ? { license: item.license } : {}),
    ...(item.publisher !== undefined ? { publisher: item.publisher.name } : {}),
  })
}

/**
 * Normalize one store-v1 projection entry.
 * @param sourceId - the owning source's identity.
 * @param item - the validated store entry.
 * @returns the normalized entry.
 */
export function normalizeStoreV1Item(
  sourceId: string,
  item: z.infer<typeof storeV1CatalogSchema>['packages'][number],
): MarketCatalogEntry {
  const zh = item.description?.zh
  const en = item.description?.en
  const summary = zh ?? en ?? ''
  return entry(sourceId, item.id, {
    name: item.name,
    summary,
    ...(en !== undefined && en !== summary ? { description: en } : {}),
    categories: item.category === undefined ? [] : [item.category],
    keywords: [],
    ...(isHttps(item.url) ? { repository: item.url } : {}),
    ...storeV1NpmIdentity(item),
    ...(item.owner !== undefined ? { publisher: item.owner } : {}),
  })
}

function isHttps(raw: string | undefined): raw is string {
  if (raw === undefined) return false
  try {
    return new URL(raw).protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Attribution shown for the built-in default source. Declared here because the
 * seed is a product choice, not deployment configuration.
 */
export const DEFAULT_SOURCE_ATTRIBUTION: MarketAttribution = {
  name: 'DSH 1024Store',
  url: 'https://deepseek1024.com/',
}

/** Kinds a source URL can speak, mirrored from {@link MarketSourceKind}. */
export const SOURCE_KINDS: readonly MarketSourceKind[] = ['catalog', 'store-v1']
