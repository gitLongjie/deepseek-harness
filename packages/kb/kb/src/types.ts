/**
 * Wire-facing knowledge-base types. The gateway declares its own copies of
 * these identities (the Typert type graph walks the declaring package), so
 * both files stay in step on the same brand keys.
 * @module @deepseek-ai/dsh-kb/types
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
