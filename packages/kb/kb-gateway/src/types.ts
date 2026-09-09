/**
 * Wire-facing knowledge-base types. These are the gateway's own declarations,
 * not re-exports of the Service Definition package: the Typert type graph
 * walks this package's files, so every identity and view the client sees is
 * declared here with the same brand keys the Service Definition uses.
 * @module @deepseek-ai/dsh-kb-gateway/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Knowledge-base identity as the backend service assigned it. */
export type KnowledgeBaseId = Branded<'KnowledgeBaseId'>

/** One knowledge base as consumers present it. */
export interface KnowledgeBaseView {
  readonly id: KnowledgeBaseId
  readonly name: string
  readonly description?: string
}

/** Document identity as the backend service assigned it. */
export type KnowledgeDocumentId = Branded<'KnowledgeDocumentId'>

/** What kind of entry a document is: an uploaded file, a web page, or pasted text. */
export type KnowledgeDocumentKind = 'file' | 'url' | 'manual'

/** One document of a knowledge base as consumers present it. */
export interface KnowledgeDocumentView {
  readonly id: KnowledgeDocumentId
  /** Display title; the backend's file name when it stores no title. */
  readonly title: string
  /** Entry kind; absent when the backend does not classify the entry. */
  readonly kind?: KnowledgeDocumentKind
  /** Lowercase file extension (`pdf`, `docx`); absent for non-file entries. */
  readonly fileType?: string
  /** File size in bytes, when the backend reports one. */
  readonly fileSize?: number
  /** Last update timestamp (ISO 8601), when the backend reports one. */
  readonly updatedAt?: string
}

/** One page of a knowledge base's documents. */
export interface KnowledgeDocumentPage {
  readonly documents: readonly KnowledgeDocumentView[]
  readonly total: number
}
