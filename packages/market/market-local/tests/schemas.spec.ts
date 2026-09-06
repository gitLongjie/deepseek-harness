import { describe, expect, it } from 'vitest'
import {
  catalogProviderPageSchema,
  catalogSourceManifestSchema,
  DEFAULT_SOURCE_ATTRIBUTION,
  normalizeCatalogItem,
  normalizeStoreV1Item,
  registryLatestSchema,
  SOURCE_KINDS,
  storeV1CatalogSchema,
  storeV1NpmIdentity,
  storedSourcesSchema,
} from '../src/schemas.ts'

const MANIFEST = {
  schemaVersion: '1',
  name: 'Community catalog',
  description: 'Plugins for dsh',
  homepage: 'https://catalog.example.com/',
  attribution: { name: 'Community', url: 'https://catalog.example.com/' },
  transport: { kind: 'https-json', endpoint: 'https://catalog.example.com/v1/plugins', method: 'GET' },
  query: { supported: ['q', 'cursor'], defaultLimit: 20, maxLimit: 100 },
}

describe('catalogSourceManifestSchema', () => {
  it('accepts a complete manifest', () => {
    const parsed = catalogSourceManifestSchema.safeParse(MANIFEST)
    expect(parsed.success).toBe(true)
  })

  it('rejects wrong versions, non-https endpoints, and out-of-range limits', () => {
    expect(catalogSourceManifestSchema.safeParse({ ...MANIFEST, schemaVersion: '2' }).success).toBe(false)
    expect(catalogSourceManifestSchema.safeParse({
      ...MANIFEST,
      transport: { ...MANIFEST.transport, endpoint: 'http://catalog.example.com/v1/plugins' },
    }).success).toBe(false)
    expect(catalogSourceManifestSchema.safeParse({ ...MANIFEST, query: { ...MANIFEST.query, defaultLimit: 0 } }).success).toBe(false)
    expect(catalogSourceManifestSchema.safeParse({ ...MANIFEST, query: { ...MANIFEST.query, maxLimit: 201 } }).success).toBe(false)
    expect(catalogSourceManifestSchema.safeParse({
      ...MANIFEST,
      query: { ...MANIFEST.query, supported: ['q', 'rogue'] },
    }).success).toBe(false)
    expect(catalogSourceManifestSchema.safeParse({
      ...MANIFEST,
      homepage: 'not a url',
    }).success).toBe(false)
    expect(catalogSourceManifestSchema.safeParse({
      ...MANIFEST,
      name: 'bad\u0007control',
    }).success).toBe(false)
    expect(catalogSourceManifestSchema.safeParse({
      ...MANIFEST,
      transport: { ...MANIFEST.transport, method: 'POST' },
    }).success).toBe(false)
  })
})

describe('catalogProviderPageSchema', () => {
  const item = {
    id: 'store/todo-kit',
    displayName: 'todo kit',
    summary: 'Structured todos',
    description: 'Longer text',
    homepage: 'https://todo.example.com/',
    latestVersion: '2.0.0',
    license: 'MIT',
    categories: ['tools'],
    keywords: ['todo'],
    package: { registry: 'npm', name: 'dsh-plugin-todo-kit' },
    publisher: { name: 'dsh community' },
  }

  it('normalizes an item with an npm package identity', () => {
    const parsed = catalogProviderPageSchema.safeParse({ schemaVersion: '1', items: [item] })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const normalized = normalizeCatalogItem('src-1', parsed.data.items[0]!)
    expect(normalized).toMatchObject({
      sourceId: 'src-1',
      entryId: 'store/todo-kit',
      name: 'todo kit',
      summary: 'Structured todos',
      description: 'Longer text',
      categories: ['tools'],
      keywords: ['todo'],
      homepage: 'https://todo.example.com/',
      npmPackage: 'dsh-plugin-todo-kit',
      latestVersion: '2.0.0',
      license: 'MIT',
      publisher: 'dsh community',
    })
  })

  it('falls back to name and keeps a repository identity instead of a package', () => {
    const parsed = catalogProviderPageSchema.safeParse({
      schemaVersion: '1',
      items: [{ ...item, name: 'fallback name', displayName: undefined, package: undefined, repository: { url: 'https://github.com/example/todo-kit' } }],
      page: { nextCursor: 'next-1', total: 7 },
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const normalized = normalizeCatalogItem('src-1', parsed.data.items[0]!)
    if (normalized === undefined) throw new Error('fixture must normalize')
    expect(normalized).toMatchObject({
      name: 'fallback name',
      repository: 'https://github.com/example/todo-kit',
    })
    expect(normalized.npmPackage).toBeUndefined()
    expect(parsed.data.page?.nextCursor).toBe('next-1')
  })

  it('drops items without a usable identity or a name, and rejects malformed pages', () => {
    expect(normalizeCatalogItem('src-1', {
      id: 'x',
      summary: 'no name and no identity',
      categories: [],
      keywords: [],
    } as never)).toBeUndefined()

    expect(catalogProviderPageSchema.safeParse({ schemaVersion: '1', items: [{ id: 'x' }] }).success).toBe(false)
    expect(catalogProviderPageSchema.safeParse({
      schemaVersion: '1',
      items: [{ ...item, id: 'bad id!' }],
    }).success).toBe(false)
    expect(catalogProviderPageSchema.safeParse({
      schemaVersion: '1',
      items: [{ ...item, id: 'x', description: 'hidden\u202Etext' }],
    }).success).toBe(false)
    expect(catalogProviderPageSchema.safeParse({ schemaVersion: '1', items: Array.from({ length: 201 }, (_, i) => ({ ...item, id: `id-${i}` })) }).success).toBe(false)
  })
})

describe('storeV1CatalogSchema and storeV1NpmIdentity', () => {
  const entry = {
    id: 'todo-kit',
    name: 'todo kit',
    owner: 'dsh-community',
    url: 'https://github.com/example/todo-kit',
    category: 'tools',
    description: { en: 'Todos', zh: '待办' },
    installMethods: [{ kind: 'npm', code: 'published_package', spec: 'dsh-plugin-todo-kit', revision: '1.1.0' }],
  }

  it('accepts a projection page and reads meta totals', () => {
    const parsed = storeV1CatalogSchema.safeParse({ packages: [entry], meta: { total: 1, catalogTotal: 9 } })
    expect(parsed.success).toBe(true)
  })

  it('extracts exactly one published npm identity with its revision', () => {
    const parsed = storeV1CatalogSchema.safeParse({ packages: [entry] })
    if (!parsed.success) throw new Error('fixture must parse')
    expect(storeV1NpmIdentity(parsed.data.packages[0]!)).toEqual({ npmPackage: 'dsh-plugin-todo-kit', latestVersion: '1.1.0' })
  })

  it('contributes no identity for zero or several distinct npm specs, or unkind methods', () => {
    const parsed = storeV1CatalogSchema.safeParse({
      packages: [
        { ...entry, installMethods: [{ kind: 'github', code: 'repository_backlink', spec: 'some/repo' }] },
        { ...entry, id: 'multi', installMethods: [
          { kind: 'npm', code: 'published_package', spec: 'package-a' },
          { kind: 'npm', code: 'published_package', spec: 'package-b' },
        ] },
        { id: 'none', name: 'method-less', description: { en: 'no methods' } },
        { id: 'bare', name: 'bare', description: { en: 'no methods at all' } },
        { ...entry, id: 'deprecated-alias', installMethods: [{ kind: 'npm', code: 'deprecated_alias', spec: 'package-a' }] },
        { ...entry, id: 'empty-spec', installMethods: [{ kind: 'npm', code: 'published_package', spec: '' }] },
      ],
    })
    if (!parsed.success) throw new Error('fixture must parse')
    for (const item of parsed.data.packages) {
      expect(storeV1NpmIdentity(item)).toEqual({})
    }
  })

  it('deduplicates repeated specs of one package', () => {
    const parsed = storeV1CatalogSchema.safeParse({
      packages: [{ ...entry, installMethods: [
        { kind: 'npm', code: 'published_package', spec: 'dsh-plugin-todo-kit', revision: '1.0.0' },
        { kind: 'npm', code: 'published_package', spec: 'dsh-plugin-todo-kit', revision: '1.1.0' },
      ] }],
    })
    if (!parsed.success) throw new Error('fixture must parse')
    expect(storeV1NpmIdentity(parsed.data.packages[0]!)).toEqual({ npmPackage: 'dsh-plugin-todo-kit', latestVersion: '1.0.0' })
  })

  it('normalizes store entries with the Chinese summary preferred', () => {
    const parsed = storeV1CatalogSchema.safeParse({ packages: [entry] })
    if (!parsed.success) throw new Error('fixture must parse')
    const normalized = normalizeStoreV1Item('src-1', parsed.data.packages[0]!)
    expect(normalized).toMatchObject({
      sourceId: 'src-1',
      entryId: 'todo-kit',
      name: 'todo kit',
      summary: '待办',
      description: 'Todos',
      categories: ['tools'],
      repository: 'https://github.com/example/todo-kit',
      npmPackage: 'dsh-plugin-todo-kit',
      latestVersion: '1.1.0',
      publisher: 'dsh-community',
    })
  })

  it('keeps an http repository URL out and falls back to the English summary', () => {
    const parsed = storeV1CatalogSchema.safeParse({
      packages: [{ ...entry, url: 'http://insecure.example.com/repo', description: { en: 'Todos only' } }],
    })
    if (!parsed.success) throw new Error('fixture must parse')
    const normalized = normalizeStoreV1Item('src-1', parsed.data.packages[0]!)
    expect(normalized.repository).toBeUndefined()
    expect(normalized.summary).toBe('Todos only')
    expect(normalized.description).toBeUndefined()
  })

  it('normalizes a minimal entry with defaults for every optional field', () => {
    const parsed = storeV1CatalogSchema.safeParse({
      packages: [{ id: 'minimal', name: 'Minimal', description: { zh: '极简' } }],
    })
    if (!parsed.success) throw new Error('fixture must parse')
    const normalized = normalizeStoreV1Item('src-1', parsed.data.packages[0]!)
    expect(normalized.summary).toBe('极简')
    expect(normalized.description).toBeUndefined()
    expect(normalized.categories).toEqual([])
    expect(normalized.keywords).toEqual([])
    expect(normalized.repository).toBeUndefined()
    expect(normalized.publisher).toBeUndefined()
    expect(normalized.npmPackage).toBeUndefined()
  })

  it('normalizes a description-less entry with an empty summary', () => {
    const parsed = storeV1CatalogSchema.safeParse({
      packages: [{ id: 'url-only', name: 'URL only', url: 'https://x.example.com/repo' }],
    })
    if (!parsed.success) throw new Error('fixture must parse')
    const normalized = normalizeStoreV1Item('src-1', parsed.data.packages[0]!)
    expect(normalized.summary).toBe('')
    expect(normalized.description).toBeUndefined()
    expect(normalized.repository).toBe('https://x.example.com/repo')
  })

  it('treats an unparseable repository URL as absent', () => {
    const parsed = storeV1CatalogSchema.safeParse({
      packages: [{ ...entry, url: 'not a url at all' }],
    })
    if (!parsed.success) throw new Error('fixture must parse')
    expect(normalizeStoreV1Item('src-1', parsed.data.packages[0]!).repository).toBeUndefined()
  })

  it('rejects malformed projections', () => {
    expect(storeV1CatalogSchema.safeParse({ packages: [{ id: 'x', name: 'n' }] }).success).toBe(false)
    expect(storeV1CatalogSchema.safeParse({ packages: [{ ...entry, id: 'has space' }] }).success).toBe(false)
  })
})

describe('registryLatestSchema', () => {
  it('requires name and version and tolerates a missing dsh block', () => {
    expect(registryLatestSchema.safeParse({ name: 'p', version: '1.0.0' }).success).toBe(true)
    expect(registryLatestSchema.safeParse({ name: 'p', version: '1.0.0', dsh: { bundle: { patch: './x' }, extra: 1 } }).success).toBe(true)
    expect(registryLatestSchema.safeParse({ name: 'p' }).success).toBe(false)
  })
})

describe('storedSourcesSchema', () => {
  it('validates the registry document shape', () => {
    expect(storedSourcesSchema.safeParse({
      schema: 1,
      selected: 'dsh-1024store',
      sources: [{ id: 'dsh-1024store', name: 'DSH 1024Store', kind: 'store-v1', url: 'https://deepseek1024.com/api/v1/plugins' }],
    }).success).toBe(true)
    expect(storedSourcesSchema.safeParse({ schema: 2, selected: null, sources: [] }).success).toBe(false)
    expect(storedSourcesSchema.safeParse({
      schema: 1,
      selected: null,
      sources: [{ id: 'bad id', name: 'n', kind: 'store-v1', url: 'https://example.com/x' }],
    }).success).toBe(false)
  })
})

describe('constants', () => {
  it('declares the built-in source attribution and the closed kind list', () => {
    expect(DEFAULT_SOURCE_ATTRIBUTION).toEqual({ name: 'DSH 1024Store', url: 'https://deepseek1024.com/' })
    expect(SOURCE_KINDS).toEqual(['catalog', 'store-v1'])
  })
})
