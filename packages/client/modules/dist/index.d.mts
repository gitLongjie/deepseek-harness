import { Context, Service } from "@deepseek-ai/cordis";
import { IndexInjection } from "@deepseek-ai/dsh-host-webserver";

//#region src/client/manifest.d.ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The client module system the web shell builds at boot (provided by the `./client` wrapper plugin). */
    modules: ClientModuleLoader;
  }
}
/**
 * One composed client entry pushed by the host (a graph row). Wire
 * single source: the host node half (package root) produces this same shape.
 * `immediately` marks stage-one prefetch. `inject` names package rows whose
 * factories must arrive before this row materializes, while Cordis separately
 * uses the same package edges to compose entries. `external` carries exact
 * non-inject module requests (see {@link WebBootGraph.entries}).
 */
interface WebBootEntry {
  /** Entry name == package name. */
  id: string;
  /** Revisioned single-resource combo endpoint used by HMR. */
  url: string;
  /** Opaque plugin-artifact revision used for HMR cache busting. */
  rev: string;
  /** Package-name dependency edges used for factory arrival and plugin composition. */
  inject?: string[];
  /** Stage-one prefetch mark: load the script for factory registration during module-face boot. */
  immediately?: boolean;
  /** Non-baseline module specifiers this row requests; omitted when it requests none. */
  external?: string[];
}
/** Initial scheduling phase for one content-addressed combo script. */
type WebBootBatchPhase = 'bootstrap' | 'application';
/** One initial combo script; a scheduling phase may span several descriptors. */
interface WebBootBatch {
  /** Parser-blocking bootstrap or preloaded application scheduling. */
  phase: WebBootBatchPhase;
  /** Content-addressed combo script endpoint. */
  url: string;
  /** Revision over the combined plugin script bytes and indexed source map. */
  rev: string;
  /** Graph entry ids whose factories the script registers, in execution order. */
  entries: string[];
}
/** The composed client entry graph the host injects as `window.__DSH_BOOT__`. */
interface WebBootGraph {
  /** Consistency anchor over the whole graph (content + bundle hashes). */
  rev: string;
  /**
   * Composed entries in module-graph order — a dynamic package row precedes
   * rows whose `external` requests that package. Cordis activation order is
   * unrelated and remains owned by fiber service waiting.
   */
  entries: WebBootEntry[];
  /** Initial combo descriptors; every entry belongs to exactly one descriptor. */
  batches: WebBootBatch[];
}
/** The npm-package view of one boot row: what the module table needs to fetch the bundle. */
interface BootModuleRow {
  /** Entry name == package name (module-table key). */
  id: string;
  /** Revisioned single-resource combo endpoint used after HMR invalidation. */
  url: string;
  /** Content-addressed combo endpoint used before the first HMR invalidation. */
  initialUrl: string;
  /** Opaque plugin-artifact revision used after HMR invalidation. */
  rev: string;
  /** Injected package rows whose factories arrive before this row materializes. */
  inject: string[];
  /** Module specifiers this row requests from the module table ([] when the wire omits them). */
  external: string[];
}
/** The cordis-plugin view of one boot row: what entry composition needs (optional wire fields normalized). */
interface BootPluginRow {
  /** Entry name == package name. */
  id: string;
  /** Package-name dependency edges ([] when the wire omits them). */
  inject: string[];
  /** Stage-one prefetch tier (false when the wire omits it). */
  immediately: boolean;
}
/** The parsed boot manifest: one wire, two consumer views. */
interface BootManifest {
  /** Consistency anchor over the whole graph. */
  rev: string;
  /** Rows as the module table consumes them. */
  modules: BootModuleRow[];
  /** Rows as entry composition consumes them. */
  plugins: BootPluginRow[];
}
/**
 * Normalize a module specifier onto the graph row that owns it: a plugin bundle
 * IS its package's client half, so `<id>/client` (the exports subpath external
 * bundles emit) and the bare package name resolve to the same exports. Both the
 * require path and graph composition normalize here, which is what lets each
 * importing package request the subpath its own code imports.
 * @param spec - module specifier as a bundle requires it or a declaration spells it.
 * @returns the specifier with a trailing `/client` removed.
 */
declare function stripClientSuffix(spec: string): string;
/** Per-module bookkeeping in {@link ClientModuleLoader.loadCache} (flat module-graph boundary). */
interface ClientModuleRecord {
  /** Module id (entry name / package name). */
  id: string;
  /** Materialized exports (`module.exports` from a factory or bootstrap registration). */
  exports: unknown;
  /** Owned `<style data-plugin>` tag ids (`data-plugin-css` values) injected during materialization. */
  styles: string[];
  /** Observed `require()` edges (module-graph boundary; only table words can appear). */
  edges: Set<string>;
}
/**
 * The internal-contract subset the vendored Loader and the client HMR plugin
 * consume. Mounted on `ctx.loader.internal` by the shell boot and provided
 * as `ctx.modules`.
 */
interface ClientModuleLoader {
  /** Discriminant against Node's internal loader shapes ('v1'/'v2'). */
  version: 'client';
  /** Parsed Host boot graph shared with the web entry after module-system creation. */
  manifest: BootManifest;
  /** Materialized-module registry: id → record. The governance-side read API for entry exports. */
  loadCache: Map<string, ClientModuleRecord>;
  /**
   * Internal contract consumed by the vendored Loader's `tree.import`. Resolves
   * `specifier` through the branch order documented on the module, fetching
   * and executing a bundle when needed.
   * @param specifier - module specifier (entry name or table word).
   * @param parentURL - importer URL (unused — the client module graph is flat).
   * @param attrs - Import attributes (unused; interface parity with Node's loader contract).
   * @returns the module's exports.
   */
  import(specifier: string, parentURL: string, attrs: Record<string, unknown>): Promise<unknown>;
  /**
   * Stage-one arrival: load the entry's declared dynamic requests, then its
   * own script, to register their factories (no materialization — module side
   * effects wait for import).
   * No-op for materialized bootstrap ids. A registered graph row still
   * registers any unresolved declared requests before skipping its own script;
   * concurrent arrivals share one in-flight task. To force a fresh load (HMR),
   * {@link invalidate} first.
   * @param id - graph entry name.
   */
  prefetch(id: string): Promise<void>;
  /**
   * Full reset of one non-bootstrap module: drop its registered factory and
   * materialized record so the next prefetch/import loads its one-resource
   * combo script rather than the initial multi-resource request. The bootstrap
   * module remains materialized.
   * @param id - entry name to invalidate.
   * @param rev - New content revision from the HMR frame; omitted to reuse
   * the graph revision or for page-local modules that register directly.
   */
  invalidate(id: string, rev?: string): void;
}
//#endregion
//#region src/index.d.ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The web plugin table (provided by the client-modules node half). */
    clientModules: ClientModuleRegistry;
  }
}
/** Filesystem baseline captured before a client artifact snapshot is read. */
interface ClientArtifactBaseline {
  /** Absolute path of the client bundle. */
  readonly path: string;
  /** Bundle modification time in milliseconds. */
  readonly mtimeMs: number;
  /** Bundle size in bytes. */
  readonly size: number;
}
/**
 * Order composed rows so every requested dynamic package precedes its
 * consumers. An `external` specifier is either the package row it names
 * (`<pkg>/client` aliases the bare package) or a static-table name that adds no
 * graph edge.
 * @param entries - composed rows in scan order.
 * @returns the same rows reordered; scan order breaks every tie.
 * @throws {Error} when a row requests itself or when the module graph has a
 * cycle; the message lists the packages on it.
 */
declare function orderByModuleGraph(entries: readonly WebBootEntry[]): WebBootEntry[];
/**
 * The boot protocol as index injection rows. The inline registration queue
 * precedes the application-batch preload and the blocking bootstrap batch. Its
 * `create()` method materializes the modules
 * bundle, delegates construction to that bundle, and leaves the same facade
 * in live-registration mode. The graph global follows before the shell reads
 * it.
 * @param graph - the composed entry graph.
 * @returns head rows in execution order: queue script, application preloads,
 * blocking bootstrap scripts, graph global.
 */
declare function bootInjections(graph: WebBootGraph): IndexInjection[];
/**
 * The web plugin table service: incremental `dsh.client` scan + wire composition
 * + bundle route + index injection rows. Construction runs the activation scan
 * synchronously — a malformed declaration or missing bundle among the
 * already-loaded entries aggregates into one loud throw (FAILED fiber; the
 * boot activation audit reports it).
 */
declare class ClientModuleRegistry extends Service {
  static inject: string[];
  private readonly table;
  private readonly sources;
  private readonly pkgMeta;
  private readonly rebuildListeners;
  private readonly graphListeners;
  private readonly dirty;
  private readonly initialRevisionNonce;
  private nextInitialRevision;
  private responses;
  private batchResponses;
  /** One prior graph generation covers a request racing the HMR recomposition that replaced its URL. */
  private previousBatchResponses;
  private flushQueued;
  private composed;
  /**
   * Build the service: subscribe, seed, and run the activation flush.
   * @param ctx - plugin context carrying webServer and loader.
   */
  constructor(ctx: Context);
  /**
   * Current composed entry graph (stable object between changes).
   * @returns the graph served as `window.__DSH_BOOT__`.
   */
  graph(): WebBootGraph;
  /**
   * Absolute path of an entry's client bundle.
   * @param id - entry id (package name).
   * @returns the path, or undefined for an unknown id.
   */
  clientPath(id: string): string | undefined;
  /**
   * Served bytes for one advertised bundle resource URL (single or combo).
   * @param resourceUrl - pathname plus search, exactly as the injection table advertises it.
   * @returns the body and media type, or undefined for an unadvertised URL.
   */
  bundleResponse(resourceUrl: string): {
    body: Buffer;
    contentType: string;
  } | undefined;
  /**
   * Filesystem baseline captured before an entry's current bytes were read.
   * HMR compares it with the live files when installing a watch, so a write
   * between startup composition and watch installation cannot disappear into
   * the watcher's initial state.
   * @param id - entry id (package name).
   * @returns the path and baseline, or undefined for an unknown id.
   */
  artifactBaseline(id: string): ClientArtifactBaseline | undefined;
  /**
   * Re-hash one bundle (the HMR watch's registration hook — the only entry
   * point through which bundle content changes reach the graph).
   * @param id - entry id (package name).
   * @returns the new rev, or undefined for an unknown id.
   */
  rebuilt(id: string): string | undefined;
  /**
   * Subscribe to bundle rebuilds; fires only when the re-hash changed the rev.
   * @param listener - receives the entry id and its new bundle rev.
   * @returns the unsubscriber.
   */
  onRebuilt(listener: (id: string, rev: string) => void): () => void;
  /**
   * Fires after any flush that recomposed the graph (row added/removed, or a
   * rebuilt rev change). Pull model: listeners re-read {@link graph}.
   * @param listener - notified with no payload.
   * @returns the unsubscriber.
   */
  onGraphChanged(listener: () => void): () => void;
  private compose;
  private notifyGraphChanged;
  private resolveMeta;
  /**
   * Locate the manifest of the package the Loader mounts for a row. The row's
   * module location is authoritative: the specifier resolves through the same
   * Loader resolution that imported the row's host half — including any
   * active ESM hooks — and the nearest ancestor manifest declaring the name
   * owns the module. Tree-anchored `require` resolution remains only for
   * runtimes without Node internals.
   * @param loaderName - module specifier of the loader row.
   * @param baseUrl - resolution base of the tree that owns the row.
   * @returns the manifest path, or `undefined` when the name resolves to no package root.
   */
  private locatePkgJson;
  private nearestPackage;
  private sourceKey;
  /** Capture the bundle stats before reading its bytes. */
  private captureArtifactBaseline;
  /** Allocate an opaque initial row revision without inspecting artifact bytes. */
  private allocateInitialRevision;
  /**
   * Read the activation-time bundle and optional source-map snapshots.
   * @param pkgName - package that declares the client bundle.
   * @param clientPath - absolute path of the built client artifact.
   * @returns the immutable bytes plus the pre-read filesystem baseline.
   * @throws {MissingClientBundleError} when the read fails with `ENOENT`; other filesystem errors are rethrown unchanged.
   */
  private initialBundleSnapshot;
  /** Treat a missing, torn, or malformed development map as an identity-mapped artifact revision. */
  private readSourceMapSnapshot;
  /** Reconcile one entry name against the live Loader sources. @returns whether the table changed. */
  private processOne;
  private resolveSource;
  private reconcilePackage;
  private flush;
  private readonly serveBundle;
}
//#endregion
export { type BootManifest, type BootModuleRow, type BootPluginRow, ClientArtifactBaseline, ClientModuleRegistry, ClientModuleRegistry as default, type WebBootBatch, type WebBootBatchPhase, type WebBootEntry, type WebBootGraph, bootInjections, orderByModuleGraph, stripClientSuffix };
//# sourceMappingURL=index.d.mts.map