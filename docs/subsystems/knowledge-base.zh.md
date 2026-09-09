# 知识库

[English](knowledge-base.md) | 中文

知识库能力列出部署的企业知识服务所暴露的库,让客户端知道自己能读什么。类型定义位于 [`packages/kb/kb/src/types.ts`](../../packages/kb/kb/src/types.ts);`dsh-kb-weknora` 拥有 WeKnora 传输与凭据解析;宿主 Remote 网关(`dsh-kb-gateway`)与 Web 客户端侧边栏知识分区是消费方。检索动词在消费方需要时加入本定义。

## 标识

`KnowledgeBaseId` 是由后端服务分配的[品牌 id](core.zh.md#branded-ids);消费方将其视为不透明 id,回传 id 而非名称。列出的库就是所配置凭据可读的全部,企业可见性规则留在知识服务一侧。

```ts type-equiv
/** One knowledge base as consumers present it. */
interface KnowledgeBaseView {
  readonly id: KnowledgeBaseId
  /** Display name; falls back to the id when the deployment names no base. */
  readonly name: string
  readonly description?: string
}
```

## 提供者

`dsh-kb-weknora` 通过每次读取一个有界请求调用 WeKnora 的 `GET /knowledge-bases`:墙钟时间上界、响应体大小上界,以及经[凭据](credentials.zh.md)接缝的逐次凭据解析,轮换后的密钥无需重启即可到达下一次调用。base URL 是部署自有配置且通常位于内网,因此与市场传输不同,本提供者不设公网地址守卫——配置的 URL 就是信任决策。非数组列表或缺少 id 的库是响亮的契约失败,绝不会静默清空侧边栏。

## 文档

`listDocuments(baseId, query?)` 经后端支持关键词过滤、有分页上界的列表接口读取一个知识库的文档。显示标题回退为后端的文件名,再回退为 id;条目种类(`file`/`url`/`manual`)与小写扩展名分开传递,客户端用自己的词汇为其命名。`readDocument(documentId, query?)` 组装一个文档的可读内容——身份事实(标题、摘要、网页条目的来源 URL)加一页有序文本块——客户端阅读器由此翻阅长文档。

## 客户端界面

网关将该定义投影到 `knowledgeBase` Remote 命名空间:`list` 返回库列表,`describe` 返回部署控制台 URL(未配置时为 null)。知识页面(位于 `@deepseek-ai/dsh-client-ui-knowledge-base`)在会话区渲染:侧边栏的知识入口行打开它,左列列出各库,右列显示所选库的文档浏览器,其"提问"动作新建会话;Agent 侧通过自己的知识工具从库中作答。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
