import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import KnowledgeBase, { default as DefaultKnowledgeBase } from '../src/index.ts'
import type { KnowledgeBaseId, KnowledgeBaseView, KnowledgeDocumentPage } from '../src/types.ts'

/** Minimal concrete provider exercising the abstract Service Definition. */
class StubKnowledgeBase extends KnowledgeBase {
  async list(): Promise<readonly KnowledgeBaseView[]> { return [] }
  webUi(): string | null { return null }
  async listDocuments(_baseId: KnowledgeBaseId): Promise<KnowledgeDocumentPage> {
    return { documents: [], total: 0 }
  }
}

describe('knowledge-base Service Definition', () => {
  it('registers concrete providers as the ctx.knowledgeBase service', async () => {
    const ctx = new Context()
    // Cordis exposes the service through a per-context filtered view, so the
    // registration is asserted through type, name, and delegation.
    new StubKnowledgeBase(ctx)
    expect(ctx.knowledgeBase).toBeInstanceOf(StubKnowledgeBase)
    expect(ctx.knowledgeBase.name).toBe('knowledgeBase')
    await expect(ctx.knowledgeBase.list()).resolves.toEqual([])
    expect(DefaultKnowledgeBase).toBe(KnowledgeBase)
  })
})
