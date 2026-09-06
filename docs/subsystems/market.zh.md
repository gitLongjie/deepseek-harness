# 插件市场

[English](market.md) | 中文

插件市场通过用户配置的目录源发现可安装插件,对每个候选包执行 npm 注册表校验,并将其安装进受管 profile。类型定义位于 [`packages/market/market/src/types.ts`](../../packages/market/market/src/types.ts);`dsh-market-local` 拥有目录读取、注册表校验与 pnpm 执行;`dsh market` CLI、宿主 Remote 网关与 Web 设置页是消费方。

## 标识

`MarketSourceId`、`MarketEntryId` 与 `MarketBundleId` 是[品牌化 id](core.zh.md#branded-ids)。目录条目只携带源本地的 `entryId`,因此每个面向条目的操作都接受 `MarketEntryRef` 二元组。展示文本属于提供方内容:归一化器在条目抵达消费方之前拒绝控制字符与双向覆盖字符,客户端回传的是不透明 id 而非名称。

## 来源

用户持有的来源注册表位于 `<dsh home>/market/sources.json`,每次操作都重新读取,因此服务、CLI 与 GUI 共享同一状态。全新 home 会播种内置的 DSH 1024Store 来源并默认选中。传输 kind 是封闭联合:`catalog` 说标准 dsh 目录端点协议,由服务端处理 `q`/`category`/`cursor`/`limit` 翻页;`store-v1` 说 DSH 1024Store 有界投影,其完整可安装列表按缓存生命周期拉取一次并在客户端过滤。

```ts type-equiv
/** Catalog transport a source speaks. The union is closed; providers switch with `assertNever`. */
type MarketSourceKind =
  | /** Standard dsh catalog endpoint: server-side `q`/`category`/`cursor`/`limit` over catalog pages. */ 'catalog'
  | /** DSH 1024Store `/api/v1/plugins` projection: one bounded installable list, filtered client-side. */ 'store-v1'
```

```ts type-equiv
/** One configured catalog source in the user-owned source registry. */
interface MarketSource {
  readonly id: MarketSourceId
  /** Display name; a standard source manifest owns its own, an input names it up front. */
  readonly name: string
  readonly kind: MarketSourceKind
  /** Absolute HTTPS URL of the manifest (standard) or directory endpoint (store-v1). */
  readonly url: string
  readonly attribution?: MarketAttribution
}
```

标准来源的 manifest 固定自己的端点——端点必须留在 manifest 源内并以 `/v1/plugins` 结尾——并声明其支持的查询参数与页大小上限。提供方载荷先经校验与归一化才进入已观察条目缓存;缓存按配置的 `maxCatalogEntries` 封顶单个来源,并按生存时间服务读取。

## 条目与浏览

```ts type-equiv
/** One normalized catalog entry projected to consumers; provider payload fields never leak. */
interface MarketCatalogEntry {
  readonly sourceId: MarketSourceId
  readonly entryId: MarketEntryId
  /** Display name. */
  readonly name: string
  /** One-line description. */
  readonly summary: string
  /** Longer description beyond the summary. */
  readonly description?: string
  readonly categories: readonly string[]
  readonly keywords: readonly string[]
  /** Repository URL (HTTPS). */
  readonly repository?: string
  /** Homepage URL (HTTPS). */
  readonly homepage?: string
  /**
   * The one npm package identity that can install this entry, when the source
   * declares exactly one. This is a claim: installability is validated against
   * the npm registry, never against this field alone.
   */
  readonly npmPackage?: string
  /** Informational version from the source; the npm registry remains the version authority. */
  readonly latestVersion?: string
  readonly license?: string
  readonly publisher?: string
}
```

`browse` 返回一页 `MarketCatalogPage`,其 `nextCursor` 是不透明游标,`total` 在来源未上报时为 null。`entryDetail` 缓存优先地解析条目,标准来源在缓存未观察该 id 时按 id 搜索;返回 `undefined` 表示来源未列出该 id,这从不是错误。

## 可安装性与安装

npm 注册表是唯一的版本权威。可安装性要求恰好一个声明的 npm 包,其注册表 `latest` manifest 携带相同名称、确切稳定版本,并声明 `dsh.bundle.patch`;每个未满足的要求都在 `reasons` 中自述。安装以该确切版本运行 profile 包管理器并调和 `dsh.profile.bundles`,因此市场安装与 `dsh plugin add` 行为一致,并在下一次宿主启动时激活。

```ts type-equiv
/**
 * Whether one entry may be installed right now. `installable` requires exactly
 * one declared npm package whose registry `latest` manifest resolves to the
 * same name at an exact stable version and declares `dsh.bundle.patch`; every
 * failed requirement names itself in `reasons`.
 */
interface MarketInstallability {
  readonly installable: boolean
  readonly npmPackage: string | null
  readonly resolvedVersion: string | null
  readonly reasons: readonly string[]
}
```

已安装视图以 profile manifest 为唯一事实读取,因此经 CLI、其他市场或本市场安装的插件全部出现。依赖排在前面并携带 manifest spec;安装方拥有的模板层只读列出并拒绝卸载。

```ts type-equiv
/** One plugin dependency of the managed profile, as the installed view shows it. */
interface MarketInstalledPlugin {
  /** Opaque uninstall handle; revalidated against the live profile manifest at uninstall time. */
  readonly bundleId: MarketBundleId
  readonly packageName: string
  /** Installed version when the package resolves. */
  readonly version: string | null
  /** The dependency spec recorded in the profile manifest, or null for an installation-owned template layer. */
  readonly spec: string | null
  /** Whether the package joins the profile's `dsh.profile.bundles` layer stack. */
  readonly isBundleLayer: boolean
  /** Whether this service may uninstall it; installation-owned template layers are never removable. */
  readonly removable: boolean
}
```

```ts type-equiv
/** Successful install: the exact npm version pnpm added to the profile. */
interface MarketInstallSuccess {
  readonly ok: true
  readonly packageName: string
  readonly version: string
  /** True while bundle layers activate only on the next host start. */
  readonly restartRequired: boolean
}
```

安装与卸载返回可辨识联合结果;失败变体携带有界的进程输出尾随用于诊断。超时的子进程拥有裁定权,即使它随后报告零退出码。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmarket--market-abstract-seam"></a>

### `ctx.market` — `Market` (abstract seam)

The market capability. All identity arguments are host-validated: clients submit opaque ids and the service resolves every package name, version, and command itself. Catalog data is untrusted provider content; only entries this service normalized can install, and the npm registry is the sole version authority at install time.

```ts cordis-catalog
/**
 * List the configured sources in registry order.
 * @returns the configured sources in registry order.
 */
abstract listSources(): Promise<readonly MarketSource[]>

/**
 * The selected source's id, or null when no source is selected.
 * @returns the selected source id, or null when nothing is selected.
 */
abstract selectedSource(): Promise<MarketSourceId | null>

/**
 * Select the source subsequent browsing reads. Selection is durable,
 * user-owned state.
 * @param id - the source to select; must be configured.
 */
abstract selectSource(id: MarketSourceId): Promise<void>

/**
 * Register a new source and select nothing (selection changes only through
 * {@link selectSource}).
 * @param input - the source's display name, transport kind, and HTTPS URL.
 * @returns the registered source with its assigned identity.
 */
abstract addSource(input: MarketSourceInput): Promise<MarketSource>

/**
 * Remove a configured source. Removing the selected source clears the
 * selection and drops that source's cached catalog.
 * @param id - the source to remove.
 */
abstract removeSource(id: MarketSourceId): Promise<void>

/**
 * Read one page from the selected source. Server-side sources translate the
 * query into their endpoint call; bounded-projection sources filter their
 * cached list client-side. Failures name the source and stage.
 * @param query - free-text query, category filter, cursor, and page size.
 * @returns one page of normalized entries with an opaque next cursor.
 */
abstract browse(query: MarketBrowseQuery): Promise<MarketCatalogPage>

/**
 * Resolve one entry through its source: cache-first, with a catalog source
 * searched for the id when the cache has not observed it. Undefined means
 * the source does not list the id — never an error, so callers can probe.
 * @param ref - the source and entry to resolve.
 * @returns the observed entry, or undefined when the source does not know it.
 */
abstract entryDetail(ref: MarketEntryRef): Promise<MarketCatalogEntry | undefined>

/**
 * Validate one entry's installability against the npm registry: exactly one
 * declared npm package, whose registry `latest` manifest carries the same
 * name, an exact stable version, and a `dsh.bundle.patch` declaration.
 * @param ref - the source and entry to validate.
 * @returns the installability verdict with one reason per unmet requirement.
 */
abstract installability(ref: MarketEntryRef): Promise<MarketInstallability>

/**
 * Install one entry into the managed profile: validate installability, then
 * run the profile package manager with the exact resolved version and
 * reconcile `dsh.profile.bundles`. The new layer activates on the next host
 * start.
 * @param ref - the source and entry to install.
 * @returns the discriminated install outcome with the exact added version on success.
 */
abstract install(ref: MarketEntryRef): Promise<MarketInstallOutcome>

/**
 * List the managed profile's direct plugin dependencies with their bundle
 * state. Every install route appears — this market, another market, or the
 * CLI — because the profile manifest is the only truth read.
 * @returns the profile's plugin dependencies, dependencies first.
 */
abstract installed(): Promise<readonly MarketInstalledPlugin[]>

/**
 * Uninstall one dependency-managed plugin from the managed profile. The
 * bundle id is revalidated against the live profile manifest; installation
 * owned template layers refuse.
 * @param bundleId - the opaque handle from a previous {@link installed} read.
 * @returns the discriminated uninstall outcome naming the removed package.
 */
abstract uninstall(bundleId: MarketBundleId): Promise<MarketUninstallOutcome>
```

Source: [`packages/market/market/src/index.ts`](../../packages/market/market/src/index.ts)
<!-- END GENERATED cordis-surface -->
