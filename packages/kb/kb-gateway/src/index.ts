/**
 * Remote gateway for the knowledge-base capability: projects the
 * `knowledgeBase` Service Definition onto the Typert wire for trusted
 * clients. The gateway holds no state of its own — every call reads through
 * the mounted knowledge-base service, so the WeKnora transport, credential
 * resolution, and response contract stay owned by one implementation.
 * @module @deepseek-ai/dsh-kb-gateway
 */

import type { Context } from '@deepseek-ai/cordis'
import type { KnowledgeBase as KnowledgeBaseService } from '@deepseek-ai/dsh-kb'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import type {
  KnowledgeBaseId, KnowledgeBaseView, KnowledgeDocumentContent, KnowledgeDocumentId, KnowledgeDocumentPage,
} from './types.ts'

export type * from './types.ts'

/**
 * Remote-only knowledge-base gateway. The Context key `knowledgeBaseGateway`
 * names this service registration (distinct from the Service Definition's
 * key); the wire namespace stays `knowledgeBase`.
 */
export class KnowledgeBaseGateway extends TypertRemoteService {
  static inject = ['knowledgeBase']

  constructor(ctx: Context) {
    super(ctx, 'knowledgeBaseGateway', { namespace: 'knowledgeBase' })
  }

  /** The mounted knowledge-base Service Provider instance, guaranteed by `static inject`. */
  private get knowledgeBase(): KnowledgeBaseService {
    return this.ctx.knowledgeBase
  }

  /**
   * List the knowledge bases the configured credential can see.
   * @returns the bases in the backend's own order.
   */
  @Remote('list')
  async list(): Promise<{ bases: readonly KnowledgeBaseView[] }> {
    return { bases: await this.knowledgeBase.list() }
  }

  /**
   * List one knowledge base's documents.
   * @param request - the opaque base identity and an optional keyword filter
   *   the backend matches against titles and content.
   * @returns one page of documents with the backend's total count.
   */
  @Remote('listDocuments')
  async listDocuments(request: { baseId: KnowledgeBaseId; query?: { keyword?: string } }): Promise<KnowledgeDocumentPage> {
    return this.knowledgeBase.listDocuments(request.baseId, request.query)
  }

  /**
   * Read one document's assembled content, one page of blocks at a time.
   * @param request - the opaque document identity and an optional 1-based page
   *   number; omission reads the first page.
   * @returns the page's blocks with the document's identity facts and totals.
   */
  @Remote('readDocument')
  async readDocument(request: { documentId: KnowledgeDocumentId; query?: { page?: number } }): Promise<KnowledgeDocumentContent> {
    return this.knowledgeBase.readDocument(request.documentId, request.query)
  }

  /**
   * Read the deployment facts client surfaces render with.
   * @returns the deployment console URL, or null when it exposes none.
   */
  @Remote('describe')
  describe(): Promise<{ webUiUrl: string | null }> {
    return Promise.resolve({ webUiUrl: this.knowledgeBase.webUi() })
  }
}

export default KnowledgeBaseGateway
