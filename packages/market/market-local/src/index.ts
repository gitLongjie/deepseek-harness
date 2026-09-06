/**
 * Local Service Provider for the plugin market: catalog reads over HTTPS
 * through the bounded transport, npm-registry installability, and profile
 * plugin install and uninstall via pnpm. Source configuration is a durable
 * registry file in the Harness home, read per operation so every surface —
 * this service, another market, or the CLI — shares one truth.
 * @module @deepseek-ai/dsh-market-local
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  Market,
  type MarketBrowseQuery,
  type MarketBundleId,
  type MarketCatalogEntry,
  type MarketCatalogPage,
  type MarketEntryRef,
  type MarketInstallability,
  type MarketInstallOutcome,
  type MarketInstalledPlugin,
  type MarketSource,
  type MarketSourceId,
  type MarketSourceInput,
  type MarketUninstallOutcome,
} from '@deepseek-ai/dsh-market'
import { resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { resolveInstallAnchor } from './anchor.ts'
import { CatalogCache, type CatalogBounds } from './catalog.ts'
import { assertPublicHttpsUrl, type FetchJsonOptions } from './http.ts'
import { isExactStableVersion, resolveRegistryLatest } from './npm-registry.ts'
import { ensureProfileDir, isNpmPackageName, pnpmInstall, pnpmUninstall, readInstalledPlugins } from './profile-io.ts'
import { newSourceId, readSourcesFile, writeSourcesFile } from './sources.ts'
import { SOURCE_KINDS } from './schemas.ts'
import type { StoredSourcesFile } from './schemas.ts'

/** Plugin config (all fields optional — `static Config` supplies the defaults). */
export interface Config {
  /** Profile the market manages; default: the launcher's profile fact. */
  profile?: string
  /** npm registry base URL used as the install-version authority. */
  npmRegistryUrl?: string
  /** Per-request wall-time bound for catalog and registry fetches (ms). */
  requestTimeoutMs?: number
  /** Maximum accepted catalog response size (bytes). */
  maxCatalogBytes?: number
  /** Maximum normalized entries kept in one source's observed cache. */
  maxCatalogEntries?: number
  /** Source cache lifetime (ms). */
  cacheTtlMs?: number
  /** Maximum pnpm install/uninstall runtime (ms). */
  pnpmTimeoutMs?: number
  /** Maximum captured process-output tail retained for failure diagnostics (bytes). */
  maxOutputTailBytes?: number
}

/** The shape after schemastery applied the defaults (profile stays optional). */
type ResolvedConfig = Required<Omit<Config, 'profile'>> & Pick<Config, 'profile'>

function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`market-local: ${name} must be a positive finite number`)
  }
}

/**
 * The local market implementation. The npm registry is the sole version
 * authority; catalog data is untrusted provider content; clients submit only
 * opaque ids.
 */
export default class LocalMarket extends Market {
  static inject: readonly string[] = []

  static Config: z<Config> = z.object({
    profile: z.string(),
    npmRegistryUrl: z.string().default('https://registry.npmjs.org'),
    requestTimeoutMs: z.number().default(15_000),
    maxCatalogBytes: z.number().default(8 * 1024 * 1024),
    maxCatalogEntries: z.number().default(20_000),
    cacheTtlMs: z.number().default(600_000),
    pnpmTimeoutMs: z.number().default(300_000),
    maxOutputTailBytes: z.number().default(8_000),
  })

  private readonly registryUrl: string
  private readonly bounds: CatalogBounds
  private readonly fetchOptions: FetchJsonOptions
  private readonly pnpmTimeoutMs: number
  private readonly maxOutputTailBytes: number
  private readonly profileName: string | null
  private readonly installAnchor: string
  private readonly catalog = new CatalogCache()

  constructor(ctx: Context, config: Config) {
    super(ctx)
    // Parse through the schema here so a direct construction (the CLI runner)
    // receives the same defaults the loader applies before construction; a
    // loader-parsed config is idempotent under this second parse.
    const resolved = LocalMarket.Config(config) as ResolvedConfig
    for (const [name, value] of Object.entries({
      requestTimeoutMs: resolved.requestTimeoutMs,
      maxCatalogBytes: resolved.maxCatalogBytes,
      maxCatalogEntries: resolved.maxCatalogEntries,
      cacheTtlMs: resolved.cacheTtlMs,
      pnpmTimeoutMs: resolved.pnpmTimeoutMs,
      maxOutputTailBytes: resolved.maxOutputTailBytes,
    })) {
      assertPositiveFinite(name, value as number)
    }
    this.registryUrl = resolved.npmRegistryUrl
    this.bounds = {
      timeoutMs: resolved.requestTimeoutMs,
      maxBytes: resolved.maxCatalogBytes,
      maxCatalogEntries: resolved.maxCatalogEntries,
      cacheTtlMs: resolved.cacheTtlMs,
    }
    this.fetchOptions = { timeoutMs: resolved.requestTimeoutMs, maxBytes: resolved.maxCatalogBytes }
    this.pnpmTimeoutMs = resolved.pnpmTimeoutMs
    this.maxOutputTailBytes = resolved.maxOutputTailBytes
    // The profile fact may not exist on every host (a web server without a
    // launcher profile still serves catalog browsing); profile-mutating
    // operations resolve it lazily and fail loud when it is absent.
    this.profileName = resolved.profile ?? ctx.get('launcherProfile')?.get() ?? null
    this.installAnchor = resolveInstallAnchor(import.meta.url)
  }

  /** The managed profile identity and directory, or a loud error when no profile is resolvable. */
  private get managedProfile(): { profileName: string; profileDir: string } {
    if (this.profileName === null) {
      throw new Error('market-local: no profile to manage — set the profile config or launch through dsh --profile')
    }
    return { profileName: this.profileName, profileDir: resolveProfileDir(this.profileName) }
  }

  async listSources(): Promise<readonly MarketSource[]> {
    const state = await readSourcesFile(resolveDshHome())
    return state.sources
  }

  async selectedSource(): Promise<MarketSourceId | null> {
    const state = await readSourcesFile(resolveDshHome())
    return state.selected as MarketSourceId | null
  }

  async selectSource(id: MarketSourceId): Promise<void> {
    await this.mutateSources((state) => {
      if (!state.sources.some(source => source.id === id)) {
        throw new Error(`market-local: source ${id} is not configured`)
      }
      return { ...state, selected: id }
    })
  }

  async addSource(input: MarketSourceInput): Promise<MarketSource> {
    if (!SOURCE_KINDS.includes(input.kind)) {
      throw new Error(`market-local: unknown source kind ${JSON.stringify(input.kind)}`)
    }
    const url = assertPublicHttpsUrl(input.url).href
    const source: MarketSource = {
      id: newSourceId() as MarketSourceId,
      name: input.name,
      kind: input.kind,
      url,
    }
    await this.mutateSources(state => ({ ...state, sources: [...state.sources, source] }))
    return source
  }

  async removeSource(id: MarketSourceId): Promise<void> {
    await this.mutateSources((state) => {
      const sources = state.sources.filter(source => source.id !== id)
      if (sources.length === state.sources.length) {
        throw new Error(`market-local: source ${id} is not configured`)
      }
      this.catalog.drop(id)
      return { ...state, selected: state.selected === id ? null : state.selected, sources }
    })
  }

  async browse(query: MarketBrowseQuery): Promise<MarketCatalogPage> {
    const source = await this.requireSelectedSource()
    return this.catalog.browse(source, query, this.bounds)
  }

  async entryDetail(ref: MarketEntryRef): Promise<MarketCatalogEntry | undefined> {
    const state = await readSourcesFile(resolveDshHome())
    const source = state.sources.find(candidate => candidate.id === ref.sourceId)
    if (source === undefined) return undefined
    return this.catalog.ensureEntryObserved(source, ref.entryId, this.bounds)
  }

  async installability(ref: MarketEntryRef): Promise<MarketInstallability> {
    const entry = await this.requireObservedEntry(ref)
    if (entry.npmPackage === undefined) {
      return {
        installable: false,
        npmPackage: null,
        resolvedVersion: null,
        reasons: ['the source declares no unique npm package for this entry'],
      }
    }
    const latest = await resolveRegistryLatest(this.registryUrl, entry.npmPackage, this.fetchOptions)
    const reasons: string[] = []
    let resolvedVersion: string | null = null
    if (latest === undefined) {
      reasons.push('the npm registry latest manifest is unreadable or malformed')
    } else {
      if (latest.name !== entry.npmPackage) reasons.push(`registry manifest name ${latest.name} does not match ${entry.npmPackage}`)
      if (!isExactStableVersion(latest.version)) reasons.push(`registry version ${latest.version} is not an exact stable release`)
      if (latest.dsh?.bundle === undefined) reasons.push('the registry manifest declares no dsh.bundle patch')
      if (reasons.length === 0) resolvedVersion = latest.version
    }
    return {
      installable: reasons.length === 0,
      npmPackage: entry.npmPackage,
      resolvedVersion,
      reasons,
    }
  }

  async install(ref: MarketEntryRef): Promise<MarketInstallOutcome> {
    const entry = await this.requireObservedEntry(ref)
    if (entry.npmPackage === undefined) {
      return { ok: false, message: 'the source declares no unique npm package for this entry', outputTail: null }
    }
    const latest = await resolveRegistryLatest(this.registryUrl, entry.npmPackage, this.fetchOptions)
    if (latest === undefined || latest.name !== entry.npmPackage || !isExactStableVersion(latest.version)) {
      return { ok: false, message: `installability for ${entry.npmPackage} was not validated against the npm registry`, outputTail: null }
    }
    if (latest.dsh?.bundle === undefined) {
      return { ok: false, message: `registry manifest for ${entry.npmPackage} declares no dsh.bundle patch`, outputTail: null }
    }
    const { profileName, profileDir } = this.managedProfile
    ensureProfileDir(profileName, profileDir)
    return pnpmInstall('market-local', entry.npmPackage, latest.version, {
      profileDir,
      installAnchor: this.installAnchor,
      pnpmTimeoutMs: this.pnpmTimeoutMs,
      maxOutputTailBytes: this.maxOutputTailBytes,
    })
  }

  async installed(): Promise<readonly MarketInstalledPlugin[]> {
    const { profileName, profileDir } = this.managedProfile
    ensureProfileDir(profileName, profileDir)
    return readInstalledPlugins('market-local', profileDir, this.installAnchor)
  }

  async uninstall(bundleId: MarketBundleId): Promise<MarketUninstallOutcome> {
    if (!isNpmPackageName(bundleId)) {
      return { ok: false, message: `not a package identity: ${JSON.stringify(bundleId)}`, outputTail: null }
    }
    const { profileName, profileDir } = this.managedProfile
    ensureProfileDir(profileName, profileDir)
    return pnpmUninstall('market-local', bundleId, {
      profileDir,
      installAnchor: this.installAnchor,
      pnpmTimeoutMs: this.pnpmTimeoutMs,
      maxOutputTailBytes: this.maxOutputTailBytes,
    })
  }

  private async requireSelectedSource(): Promise<MarketSource> {
    const state = await readSourcesFile(resolveDshHome())
    const selected = state.sources.find(source => source.id === state.selected)
    if (selected === undefined) throw new Error('market-local: no source is selected')
    return selected
  }

  private async requireObservedEntry(ref: MarketEntryRef): Promise<MarketCatalogEntry> {
    const state = await readSourcesFile(resolveDshHome())
    const source = state.sources.find(candidate => candidate.id === ref.sourceId)
    if (source === undefined) throw new Error(`market-local: source ${ref.sourceId} is not configured`)
    const entry = await this.catalog.ensureEntryObserved(source, ref.entryId, this.bounds)
    if (entry === undefined) {
      throw new Error(`market-local: source ${source.name} does not list entry ${ref.entryId}`)
    }
    return entry
  }

  /** Read, mutate under one closure, and persist the source registry. */
  private async mutateSources(mutate: (state: StoredSourcesFile) => StoredSourcesFile): Promise<void> {
    const home = resolveDshHome()
    const state = await readSourcesFile(home)
    const next = mutate(state)
    await writeSourcesFile(home, next)
  }
}
