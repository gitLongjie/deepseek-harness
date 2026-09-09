/**
 * Knowledge-base Service Definition: listing the bases a deployment's
 * enterprise knowledge service exposes. The concrete WeKnora provider lives
 * in `@deepseek-ai/dsh-kb-weknora`; consumers are the host Remote gateway
 * (`@deepseek-ai/dsh-kb-gateway`) and the web client's knowledge-base
 * section. Retrieval verbs join this definition when a consumer needs them.
 * @module @deepseek-ai/dsh-kb
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  KnowledgeBaseId,
  KnowledgeBaseView,
  KnowledgeDocumentContent,
  KnowledgeDocumentId,
  KnowledgeDocumentPage,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The knowledge-base service; mounted by a Service Provider such as `dsh-kb-weknora`. */
    knowledgeBase: KnowledgeBase
  }
}

/**
 * The knowledge-base capability. Base ids are backend-assigned and opaque to
 * consumers; visibility follows the credential the provider resolves, so the
 * listed bases are exactly what the configured deployment may read.
 */
export abstract class KnowledgeBase extends Service {
  constructor(ctx: Context) {
    super(ctx, 'knowledgeBase')
  }

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

  /**
   * Read one document's assembled content, one page of blocks at a time.
   * @param documentId - the opaque document identity from a previous
   *   {@link listDocuments} read.
   * @param query - optional 1-based page number; omission reads the first page.
   * @returns the page's blocks with the document's identity facts and totals.
   */
  abstract readDocument(documentId: KnowledgeDocumentId, query?: { page?: number }): Promise<KnowledgeDocumentContent>
}

export default KnowledgeBase
