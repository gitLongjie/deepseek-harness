import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type {
  KnowledgeBase, KnowledgeBaseView, KnowledgeDocumentContent, KnowledgeDocumentPage, KnowledgeDocumentView,
} from '@deepseek-ai/dsh-kb'
import KnowledgeBaseGateway from '../src/index.ts'

// Test fixtures cast the wire strings into the branded identities once, at the
// fixture assembly point; every call site below uses these constants.
const BASE: KnowledgeBaseView = { id: 'kb-1' as KnowledgeBaseView['id'], name: '产品文档', description: 'Product docs' }
const DOCUMENT: KnowledgeDocumentView = { id: 'doc-1' as KnowledgeDocumentView['id'], title: '使用指南' }

/** The wire-facing service stubs the gateway projects onto the wire. */
interface GatewayStub {
  list: ReturnType<typeof vi.fn>
  webUi: ReturnType<typeof vi.fn>
  listDocuments: ReturnType<typeof vi.fn>
  readDocument: ReturnType<typeof vi.fn>
}

function harness(): { gateway: KnowledgeBaseGateway; stub: GatewayStub } {
  const ctx = new Context()
  const stub = {
    list: vi.fn(async () => [BASE]),
    webUi: vi.fn(() => 'http://kb.internal:8080'),
    listDocuments: vi.fn(async () => ({ documents: [], total: 0 })),
    readDocument: vi.fn(async () => ({ id: 'doc-1', title: '使用指南', chunks: [], total: 0, page: 1, pageSize: 20 })),
  }
  ctx.provide('knowledgeBase', stub as unknown as KnowledgeBase)
  return { gateway: new KnowledgeBaseGateway(ctx), stub }
}

describe('knowledge-base gateway projection', () => {
  it('binds the knowledgeBase wire namespace under its own service key and the injected service', () => {
    const { gateway } = harness()
    expect(gateway.typertRemote.serviceKey).toBe('knowledgeBaseGateway')
    expect(gateway.typertRemote.namespace).toBe('knowledgeBase')
    expect((gateway as unknown as { name: string }).name).toBe('knowledgeBaseGateway')
  })

  it('projects the base listing and the deployment facts', async () => {
    const { gateway, stub } = harness()
    await expect(gateway.list()).resolves.toEqual({ bases: [BASE] })
    expect(stub.list).toHaveBeenCalledOnce()
    await expect(gateway.describe()).resolves.toEqual({ webUiUrl: 'http://kb.internal:8080' })
    expect(stub.webUi).toHaveBeenCalledOnce()
  })

  it('projects the document listing of one base', async () => {
    const { gateway, stub } = harness()
    const page: KnowledgeDocumentPage = { documents: [DOCUMENT], total: 1 }
    vi.mocked(stub.listDocuments).mockResolvedValueOnce(page)
    await expect(gateway.listDocuments({ baseId: BASE.id, query: { keyword: '指南' } })).resolves.toEqual(page)
    expect(stub.listDocuments).toHaveBeenCalledWith(BASE.id, { keyword: '指南' })
  })

  it('projects the document content read of one page', async () => {
    const { gateway, stub } = harness()
    const content: KnowledgeDocumentContent = {
      id: DOCUMENT.id, title: '使用指南',
      chunks: [{ index: 1, content: '第一步。' }],
      total: 22, page: 2, pageSize: 20,
    }
    vi.mocked(stub.readDocument).mockResolvedValueOnce(content)
    await expect(gateway.readDocument({ documentId: DOCUMENT.id, query: { page: 2 } })).resolves.toEqual(content)
    expect(stub.readDocument).toHaveBeenCalledWith(DOCUMENT.id, { page: 2 })
  })
})
