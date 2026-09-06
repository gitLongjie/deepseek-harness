import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarketBrowseQuery, MarketSourceInput } from '@deepseek-ai/dsh-market'
import LocalMarket from '../src/index.ts'
import { pnpmInstall, pnpmUninstall, readInstalledPlugins, ensureProfileDir } from '../src/profile-io.ts'
import { resolveRegistryLatest } from '../src/npm-registry.ts'

vi.mock('../src/profile-io.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/profile-io.ts')>()
  return {
    ...actual,
    ensureProfileDir: vi.fn(),
    pnpmInstall: vi.fn(),
    pnpmUninstall: vi.fn(),
    readInstalledPlugins: vi.fn(),
  }
})

vi.mock('../src/npm-registry.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/npm-registry.ts')>()
  return { ...actual, resolveRegistryLatest: vi.fn() }
})

afterEach(() => { vi.unstubAllGlobals() })

const DEFAULT_SOURCE_ID = 'dsh-1024store'
const NUMERIC_FIELDS = [
  'requestTimeoutMs', 'maxCatalogBytes', 'maxCatalogEntries', 'cacheTtlMs', 'pnpmTimeoutMs', 'maxOutputTailBytes',
] as const

interface Harness {
  home: string
  build: (config?: Record<string, unknown>) => LocalMarket
}

const harnesses: Harness[] = []

beforeEach(() => {
  vi.clearAllMocks()
  const home = mkdtempSync(join(tmpdir(), 'dsh-market-home-'))
  process.env.DSH_HOME = home
  harnesses.push({
    home,
    build: (config: Record<string, unknown> = {}) => {
      const resolved = {
        profile: 'market-test',
        npmRegistryUrl: 'https://registry.example.com',
        requestTimeoutMs: 1_000,
        maxCatalogBytes: 100_000,
        maxCatalogEntries: 3,
        cacheTtlMs: 60_000,
        pnpmTimeoutMs: 1_000,
        maxOutputTailBytes: 100,
        ...config,
      }
      return new LocalMarket(new Context(), resolved as never)
    },
  })
})

afterEach(() => {
  delete process.env.DSH_HOME
  while (harnesses.length > 0) {
    const harness = harnesses.pop()
    if (harness !== undefined) rmSync(harness.home, { recursive: true, force: true })
  }
})

function build(config: Record<string, unknown> = {}): LocalMarket {
  const harness = harnesses.at(-1)
  if (harness === undefined) throw new Error('no harness staged')
  return harness.build(config)
}

function storeBody(packages: Record<string, unknown>[]): unknown {
  return { packages, meta: { total: packages.length, catalogTotal: 9 } }
}

function storeEntry(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    name: `Entry ${id}`,
    owner: 'community',
    url: `https://github.com/example/${id}`,
    category: 'tools',
    description: { en: `${id} description`, zh: `${id} 摘要` },
    installMethods: [{ kind: 'npm', code: 'published_package', spec: `pkg-${id}`, revision: '1.0.0' }],
    ...extra,
  }
}

function stubStoreFetch(entries: Record<string, unknown>[]): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(storeBody(entries)), { status: 200 })))
}

describe('construction', () => {
  it('rejects non-positive or non-finite numeric config', () => {
    for (const field of NUMERIC_FIELDS) {
      expect(() => build({ [field]: 0 })).toThrow(/must be a positive finite number/)
      expect(() => build({ [field]: Number.POSITIVE_INFINITY })).toThrow(/must be a positive finite number/)
    }
  })

  it('takes the profile from config, from the launcher fact, or defers the loud failure to profile operations', async () => {
    expect(build({ profile: 'explicit' })['profileName']).toBe('explicit')

    const ctx = new Context()
    ctx.provide('launcherProfile', { get: () => 'from-launcher' })
    const fromLauncher = new LocalMarket(ctx, {
      npmRegistryUrl: 'https://registry.example.com', requestTimeoutMs: 1_000, maxCatalogBytes: 1_000,
      maxCatalogEntries: 1, cacheTtlMs: 1_000, pnpmTimeoutMs: 1_000, maxOutputTailBytes: 1,
    } as never)
    expect(fromLauncher['profileName']).toBe('from-launcher')

    const unprofiled = build({ profile: undefined })
    await expect(unprofiled.installed()).rejects.toThrow(/no profile to manage/)
  })
})

describe('source registry', () => {
  it('seeds the built-in source preselected', async () => {
    const market = build()
    await expect(market.selectedSource()).resolves.toBe(DEFAULT_SOURCE_ID)
    const sources = await market.listSources()
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({ id: DEFAULT_SOURCE_ID, kind: 'store-v1' })
  })

  it('adds a source with a minted id and persists it', async () => {
    const market = build()
    const input: MarketSourceInput = { name: 'Custom', kind: 'catalog', url: 'https://custom.example.com/v1/plugins' }
    const added = await market.addSource(input)
    expect(added.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(added).toMatchObject({ name: 'Custom', kind: 'catalog', url: 'https://custom.example.com/v1/plugins' })
    await expect(market.listSources()).resolves.toHaveLength(2)
  })

  it('rejects unknown kinds and non-public URLs', async () => {
    const market = build()
    await expect(market.addSource({ name: 'X', kind: 'rogue', url: 'https://x.example.com/' } as unknown as MarketSourceInput))
      .rejects.toThrow(/unknown source kind/)
    await expect(market.addSource({ name: 'X', kind: 'catalog', url: 'http://x.example.com/' }))
      .rejects.toThrow(/only https:\/\//)
  })

  it('selects a configured source and rejects unknown ids', async () => {
    const market = build()
    await market.selectSource(DEFAULT_SOURCE_ID as never)
    await expect(market.selectedSource()).resolves.toBe(DEFAULT_SOURCE_ID)
    await expect(market.selectSource('ghost' as never)).rejects.toThrow(/source ghost is not configured/)
  })

  it('removes a source, clears its selection, and rejects unknown ids', async () => {
    const market = build()
    const added = await market.addSource({ name: 'Custom', kind: 'catalog', url: 'https://custom.example.com/v1/plugins' })
    // Removing a non-selected source keeps the selection.
    await market.removeSource(added.id)
    await expect(market.selectedSource()).resolves.toBe(DEFAULT_SOURCE_ID)

    const second = await market.addSource({ name: 'Second', kind: 'catalog', url: 'https://second.example.com/v1/plugins' })
    await market.selectSource(second.id)
    await market.removeSource(second.id)
    await expect(market.selectedSource()).resolves.toBeNull()
    await expect(market.listSources()).resolves.toHaveLength(1)
    await expect(market.removeSource(second.id)).rejects.toThrow(/is not configured/)
  })
})

describe('browse and entryDetail', () => {
  it('fails loud when no source is selected', async () => {
    const market = build()
    // The built-in source ships preselected; removing it clears the selection
    // and browse must refuse before any network read.
    await market.removeSource(DEFAULT_SOURCE_ID as never)
    await expect(market.browse({ limit: 10 })).rejects.toThrow(/no source is selected/)
  })

  it('browses the selected source and finds entry details by ref', async () => {
    stubStoreFetch([storeEntry('a'), storeEntry('b')])
    const market = build()
    await market.selectSource(DEFAULT_SOURCE_ID as never)
    const page = await market.browse({ limit: 50 } satisfies MarketBrowseQuery)
    expect(page.entries).toHaveLength(2)
    expect(page.total).toBe(2)

    const detail = await market.entryDetail({ sourceId: DEFAULT_SOURCE_ID, entryId: 'a' } as never)
    expect(detail).toMatchObject({ entryId: 'a', npmPackage: 'pkg-a' })
    await expect(market.entryDetail({ sourceId: 'ghost-source', entryId: 'a' } as never)).resolves.toBeUndefined()
    await expect(market.entryDetail({ sourceId: DEFAULT_SOURCE_ID, entryId: 'ghost' } as never)).resolves.toBeUndefined()
  })
})

describe('installability', () => {
  it('reports a source entry without a unique npm package', async () => {
    stubStoreFetch([storeEntry('a', { installMethods: [] })])
    const market = build()
    const result = await market.installability({ sourceId: DEFAULT_SOURCE_ID, entryId: 'a' } as never)
    expect(result).toEqual({
      installable: false,
      npmPackage: null,
      resolvedVersion: null,
      reasons: ['the source declares no unique npm package for this entry'],
    })
  })

  it('accumulates registry-derived reasons and answers installable only when all pass', async () => {
    stubStoreFetch([storeEntry('a')])
    const market = build()

    vi.mocked(resolveRegistryLatest).mockResolvedValueOnce(undefined)
    expect(await market.installability({ sourceId: DEFAULT_SOURCE_ID, entryId: 'a' } as never)).toMatchObject({
      installable: false,
      reasons: ['the npm registry latest manifest is unreadable or malformed'],
    })

    vi.mocked(resolveRegistryLatest).mockResolvedValueOnce({
      name: 'pkg-other', version: '1.0.0-beta', dsh: undefined,
    })
    expect(await market.installability({ sourceId: DEFAULT_SOURCE_ID, entryId: 'a' } as never)).toEqual({
      installable: false,
      npmPackage: 'pkg-a',
      resolvedVersion: null,
      reasons: [
        'registry manifest name pkg-other does not match pkg-a',
        'registry version 1.0.0-beta is not an exact stable release',
        'the registry manifest declares no dsh.bundle patch',
      ],
    })

    vi.mocked(resolveRegistryLatest).mockResolvedValueOnce({ name: 'pkg-a', version: '1.2.3', dsh: { bundle: { patch: './cordis.patch.yml' } } })
    expect(await market.installability({ sourceId: DEFAULT_SOURCE_ID, entryId: 'a' } as never)).toEqual({
      installable: true,
      npmPackage: 'pkg-a',
      resolvedVersion: '1.2.3',
      reasons: [],
    })
    expect(vi.mocked(resolveRegistryLatest)).toHaveBeenLastCalledWith(
      'https://registry.example.com', 'pkg-a', { timeoutMs: 1_000, maxBytes: 100_000 },
    )
  })
})

describe('install', () => {
  it('fails loud for an entry the source does not list', async () => {
    stubStoreFetch([])
    const market = build()
    await expect(market.install({ sourceId: 'ghost-source', entryId: 'a' } as never))
      .rejects.toThrow(/source ghost-source is not configured/)
    await expect(market.install({ sourceId: DEFAULT_SOURCE_ID, entryId: 'a' } as never))
      .rejects.toThrow(/does not list entry a/)
  })

  it('rejects entries without a unique npm package', async () => {
    stubStoreFetch([storeEntry('a', { installMethods: [] })])
    const market = build()
    await expect(market.install({ sourceId: DEFAULT_SOURCE_ID, entryId: 'a' } as never)).resolves.toEqual({
      ok: false,
      message: 'the source declares no unique npm package for this entry',
      outputTail: null,
    })
  })

  it('refuses to install when the registry does not validate the exact version', async () => {
    stubStoreFetch([storeEntry('a')])
    const market = build()
    vi.mocked(resolveRegistryLatest).mockResolvedValueOnce(undefined)
    await expect(market.install({ sourceId: DEFAULT_SOURCE_ID, entryId: 'a' } as never)).resolves.toMatchObject({
      ok: false,
      message: 'installability for pkg-a was not validated against the npm registry',
    })

    vi.mocked(resolveRegistryLatest).mockResolvedValueOnce({ name: 'pkg-a', version: '1.2.3', dsh: undefined })
    await expect(market.install({ sourceId: DEFAULT_SOURCE_ID, entryId: 'a' } as never)).resolves.toMatchObject({
      ok: false,
      message: 'registry manifest for pkg-a declares no dsh.bundle patch',
    })
  })

  it('installs the exact validated version into the profile', async () => {
    stubStoreFetch([storeEntry('a')])
    const market = build({ profile: 'market-test' })
    vi.mocked(resolveRegistryLatest).mockResolvedValueOnce({ name: 'pkg-a', version: '1.2.3', dsh: { bundle: { patch: './x' } } })
    vi.mocked(pnpmInstall).mockResolvedValueOnce({ ok: true, packageName: 'pkg-a', version: '1.2.3', restartRequired: true })

    const outcome = await market.install({ sourceId: DEFAULT_SOURCE_ID, entryId: 'a' } as never)
    expect(outcome).toEqual({ ok: true, packageName: 'pkg-a', version: '1.2.3', restartRequired: true })
    expect(vi.mocked(pnpmInstall)).toHaveBeenCalledWith('market-local', 'pkg-a', '1.2.3', {
      profileDir: expect.stringMatching(/[\\/]market-test$/),
      installAnchor: expect.stringMatching(/[\\/]package\.json$/),
      pnpmTimeoutMs: 1_000,
      maxOutputTailBytes: 100,
    })
    const profileDir = vi.mocked(pnpmInstall).mock.calls[0]?.[3]?.profileDir ?? ''
    expect(vi.mocked(ensureProfileDir)).toHaveBeenCalledWith('market-test', profileDir)
  })
})

describe('installed', () => {
  it('ensures the profile directory and projects the manifest view', async () => {
    const market = build({ profile: 'market-test' })
    vi.mocked(readInstalledPlugins).mockReturnValueOnce([])
    await expect(market.installed()).resolves.toEqual([])
    expect(vi.mocked(readInstalledPlugins)).toHaveBeenCalledWith('market-local', expect.stringMatching(/[\\/]market-test$/), expect.any(String))
  })
})

describe('uninstall', () => {
  it('refuses non-package identities', async () => {
    const market = build()
    await expect(market.uninstall('NOT A PACKAGE' as never)).resolves.toMatchObject({ ok: false, message: /not a package identity/ })
    expect(vi.mocked(ensureProfileDir)).not.toHaveBeenCalled()
  })

  it('delegates a valid bundle id to pnpm', async () => {
    const market = build({ profile: 'market-test' })
    vi.mocked(pnpmUninstall).mockResolvedValueOnce({ ok: true, packageName: 'pkg-a', restartRequired: true })
    await expect(market.uninstall('pkg-a' as never)).resolves.toEqual({ ok: true, packageName: 'pkg-a', restartRequired: true })
    expect(vi.mocked(pnpmUninstall)).toHaveBeenCalledWith('market-local', 'pkg-a', {
      profileDir: expect.stringMatching(/[\\/]market-test$/),
      installAnchor: expect.any(String),
      pnpmTimeoutMs: 1_000,
      maxOutputTailBytes: 100,
    })
  })
})
