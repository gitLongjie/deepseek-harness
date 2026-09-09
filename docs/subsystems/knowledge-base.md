# Knowledge Base

English | [中文](knowledge-base.zh.md)

The knowledge-base capability lists the bases a deployment's enterprise knowledge service exposes, so a client can name what it may read. The types live in [`packages/kb/kb/src/types.ts`](../../packages/kb/kb/src/types.ts); `dsh-kb-weknora` owns the WeKnora transport and credential resolution; the host Remote gateway (`dsh-kb-gateway`) and the web client's sidebar knowledge section are consumers. Retrieval verbs join this definition when a consumer needs them.

## Identities

`KnowledgeBaseId` is a [branded id](core.md#branded-ids) assigned by the backend service; consumers treat it as opaque and submit it back rather than a name. The listed bases are exactly what the configured credential may read, so enterprise visibility rules stay on the knowledge service.

```ts type-equiv
/** One knowledge base as consumers present it. */
interface KnowledgeBaseView {
  readonly id: KnowledgeBaseId
  /** Display name; falls back to the id when the deployment names no base. */
  readonly name: string
  readonly description?: string
}
```

## Provider

`dsh-kb-weknora` speaks WeKnora's `GET /knowledge-bases` through one bounded request per read: wall-time bound, body-size bound, and a per-operation credential resolution through the [credentials](credentials.md) seam, so a rotated key reaches the next call without a restart. The base URL is deployment-owned configuration and is commonly intranet, so unlike the market transport this provider runs no public-address guard — the configured URL is the trust decision. A non-array listing or a base without an id is a loud contract failure, never a silently emptied sidebar.

## Documents

`listDocuments(baseId, query?)` reads one base's documents through the backend's keyword-filtered, page-bounded listing. The display title falls back to the backend's file name, then the id; the entry kind (`file`/`url`/`manual`) and lowercase file extension travel separately so clients label them in their own vocabulary.

## Client surface

The gateway projects the definition onto the `knowledgeBase` Remote namespace: `list` returns the bases and `describe` the deployment console URL (null when unconfigured). The knowledge page (in `@deepseek-ai/dsh-client-ui-knowledge-base`) renders in the conversation area: the sidebar's knowledge entry row opens it, the left pane lists the bases, and the right pane shows the selected base's document browser whose ask action starts a New Session; the agent side answers from the base through its own knowledge tools.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxknowledgebase--knowledgebase-abstract-seam"></a>

### `ctx.knowledgeBase` — `KnowledgeBase` (abstract seam)

The knowledge-base capability. Base ids are backend-assigned and opaque to consumers; visibility follows the credential the provider resolves, so the listed bases are exactly what the configured deployment may read.

```ts cordis-catalog
/**
 * List the knowledge bases the configured credential can see.
 * @returns the bases in the backend's own order.
 */
abstract list(): Promise<readonly KnowledgeBaseView[]>

/**
 * The deployment's browser-openable console for client manage actions, or
 * null when the deployment exposes none.
 * @returns the console URL, or null.
 */
abstract webUi(): string | null

/**
 * List one knowledge base's documents, newest-backend-order first page.
 * @param baseId - the opaque base identity from a previous {@link list} read.
 * @param query - optional keyword filter matched by the backend against
 *   document titles and content.
 * @returns one page of documents with the backend's total count.
 */
abstract listDocuments(baseId: KnowledgeBaseId, query?: { keyword?: string }): Promise<KnowledgeDocumentPage>
```

Source: [`packages/kb/kb/src/index.ts`](../../packages/kb/kb/src/index.ts)
<!-- END GENERATED cordis-surface -->
