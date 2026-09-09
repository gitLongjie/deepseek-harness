import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { CredentialProvider, CredentialRef } from '@deepseek-ai/dsh-credentials'
import WeknoraKnowledgeBase, { WeknoraKnowledgeBaseError } from '../src/index.ts'
import type { Config } from '../src/index.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Credential seam stub: the configured reference resolves to a settable value. */
function credentials(value: string | undefined) {
  return { resolve: vi.fn(async (_ref: CredentialRef) => value === undefined ? undefined : { value, source: 'test' }) }
}

// The Service constructor registers the instance as its context's service, so
// every provider lives on its own context. A null credential value resolves
// to nothing (an unconfigured reference), distinct from the empty string that
// declares an unauthenticated deployment.
function makeProvider(config: Config = {}, credentialValue: string | null = 'sk-test') {
  const ctx = new Context()
  const credentialsStub = credentials(credentialValue === null ? undefined : credentialValue)
  ctx.provide('credentials', credentialsStub as unknown as CredentialProvider)
  return { provider: new WeknoraKnowledgeBase(ctx, config), credentialsStub }
}

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } })
}

const ENVELOPE = JSON.stringify({
  data: [
    { id: 'kb-1', name: '产品文档', description: 'Product docs' },
    { id: 'kb-2', name: '' },
    { id: 'kb-3', description: 'Only a description' },
  ],
})

describe('kb-weknora provider', () => {
  it('fails loud at load on a non-URL or non-http base URL and a bad console URL', () => {
    expect(() => makeProvider({ baseUrl: 'not a url' })).toThrow(/baseUrl is not a valid URL/)
    expect(() => makeProvider({ baseUrl: 'ftp://kb.internal/api/v1' })).toThrow(/must be an http\(s\) URL/)
    expect(() => makeProvider({ webUiUrl: 'javascript:alert(1)' })).toThrow(/webUiUrl must be an http\(s\) URL/)
    expect(() => makeProvider({ baseUrl: 'http://kb.internal:8080/api/v1' })).not.toThrow()
  })

  it('fails loud at load on a reference outside the credential grammar', () => {
    expect(() => makeProvider({ apiKeyEnv: 'not a name' })).toThrow(/must match/)
  })

  it('lists the bases the credential can see, falling the name back to the id', async () => {
    const fetchStub = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse(ENVELOPE))
    vi.stubGlobal('fetch', fetchStub)
    const { provider } = makeProvider({ baseUrl: 'http://kb.internal:8080/api/v1', tenantId: 'ws-1' })

    await expect(provider.list()).resolves.toEqual([
      { id: 'kb-1', name: '产品文档', description: 'Product docs' },
      { id: 'kb-2', name: 'kb-2' },
      { id: 'kb-3', name: 'kb-3', description: 'Only a description' },
    ])
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://kb.internal:8080/api/v1/knowledge-bases')
    expect(init.headers).toMatchObject({ accept: 'application/json', 'x-api-key': 'sk-test', 'x-tenant-id': 'ws-1' })
  })

  it('sends no key for an explicitly unauthenticated deployment', async () => {
    const fetchStub = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse(ENVELOPE))
    vi.stubGlobal('fetch', fetchStub)
    const { provider, credentialsStub } = makeProvider({ apiKeyEnv: '' })

    await expect(provider.list()).resolves.toHaveLength(3)
    const [, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).not.toHaveProperty('x-api-key')
    expect(credentialsStub.resolve).not.toHaveBeenCalled()
  })

  it('omits the key header while the reference is unconfigured, and re-resolves per operation', async () => {
    const fetchStub = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse(ENVELOPE))
    vi.stubGlobal('fetch', fetchStub)
    const { provider, credentialsStub } = makeProvider({}, null)

    await provider.list()
    expect((fetchStub.mock.calls[0] as unknown as [string, RequestInit])[1].headers).not.toHaveProperty('x-api-key')

    credentialsStub.resolve.mockResolvedValueOnce({ value: 'sk-next', source: 'test' })
    await provider.list()
    expect((fetchStub.mock.calls[1] as unknown as [string, RequestInit])[1].headers).toMatchObject({ 'x-api-key': 'sk-next' })
    expect(credentialsStub.resolve).toHaveBeenCalledTimes(2)
  })

  it('exposes the configured console URL or null', () => {
    expect(makeProvider({}).provider.webUi()).toBeNull()
    expect(makeProvider({ webUiUrl: '' }).provider.webUi()).toBeNull()
    expect(makeProvider({ webUiUrl: 'http://kb.internal:8080' }).provider.webUi()).toBe('http://kb.internal:8080')
  })

  it('raises a loud contract failure for a non-array listing and an id-less base', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(JSON.stringify({ data: { nope: true } }))))
    await expect(makeProvider({}).provider.list())
      .rejects.toThrow(/without a base array/)

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(JSON.stringify({ data: [{ name: 'no id' }] }))))
    await expect(makeProvider({}).provider.list())
      .rejects.toThrow(/without an id/)

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(JSON.stringify({ data: [null] }))))
    await expect(makeProvider({}).provider.list())
      .rejects.toThrow(/without an id/)
  })

  it('lists one base\'s documents with keyword and page bounds, mapping fields', async () => {
    const fetchStub = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse(JSON.stringify({
      data: [
        { id: 'doc-1', title: '使用指南', file_type: 'docx', type: 'file', file_size: 64, updated_at: '2026-09-05T07:20:17+08:00' },
        { id: 'doc-2', file_name: '站长.txt' },
        { id: 'doc-3', type: 'url', source: 'https://example.com' },
      ],
      total: 3,
    })))
    vi.stubGlobal('fetch', fetchStub)
    const { provider } = makeProvider({ baseUrl: 'http://kb.internal:8080/api/v1' })

    await expect(provider.listDocuments('kb-1' as never, { keyword: '指南' })).resolves.toEqual({
      documents: [
        { id: 'doc-1', title: '使用指南', kind: 'file', fileType: 'docx', fileSize: 64, updatedAt: '2026-09-05T07:20:17+08:00' },
        { id: 'doc-2', title: '站长.txt' },
        { id: 'doc-3', title: 'doc-3', kind: 'url' },
      ],
      total: 3,
    })
    const [url] = fetchStub.mock.calls[0] as unknown as [string]
    expect(url).toBe('http://kb.internal:8080/api/v1/knowledge-bases/kb-1/knowledge?page=1&page_size=1000&keyword=%E6%8C%87%E5%8D%97')
  })

  it('lists documents unfiltered when no keyword is given', async () => {
    const fetchStub = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse(JSON.stringify({ data: [] })))
    vi.stubGlobal('fetch', fetchStub)
    const { provider } = makeProvider()
    await provider.listDocuments('kb-2' as never)
    const [url] = fetchStub.mock.calls[0] as unknown as [string]
    expect(url).toBe('http://localhost:8080/api/v1/knowledge-bases/kb-2/knowledge?page=1&page_size=1000')
  })

  it('reads one document as facts plus a page of chunks', async () => {
    const fetchStub = vi.fn(async (url: string | URL | Request) => jsonResponse(
      String(url).includes('/chunks/')
        ? JSON.stringify({
          data: [{ chunk_index: 1, content: '第一步。' }, { content: '第二步。' }],
          total: 22, page: 2, page_size: 20,
        })
        : JSON.stringify({ data: { id: 'doc-1', title: '指南', description: '摘要', source: 'https://example.com' } }),
    ))
    vi.stubGlobal('fetch', fetchStub)
    const { provider } = makeProvider({ baseUrl: 'http://kb.internal:8080/api/v1' })

    await expect(provider.readDocument('doc-1' as never, { page: 2 })).resolves.toEqual({
      id: 'doc-1',
      title: '指南',
      summary: '摘要',
      sourceUrl: 'https://example.com',
      chunks: [{ index: 1, content: '第一步。' }, { index: 2, content: '第二步。' }],
      total: 22,
      page: 2,
      pageSize: 20,
    })
    const [factsUrl, chunksUrl] = fetchStub.mock.calls.map(call => (call[0] as unknown as string))
    expect(factsUrl).toBe('http://kb.internal:8080/api/v1/knowledge/doc-1')
    expect(chunksUrl).toBe('http://kb.internal:8080/api/v1/chunks/doc-1?page=2&page_size=20')
  })

  it('raises loud contract failures for a bad document record and a bad chunk page', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => jsonResponse(
      String(url).includes('/chunks/')
        ? JSON.stringify({ data: [{ content: 'x' }], total: 1 })
        : JSON.stringify({ data: { title: 'no id' } }),
    )))
    await expect(makeProvider({}).provider.readDocument('doc-1' as never))
      .rejects.toThrow(/document without an id/)

    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => jsonResponse(
      String(url).includes('/chunks/')
        ? JSON.stringify({ data: 'nope' })
        : JSON.stringify({ data: { id: 'doc-1' } }),
    )))
    await expect(makeProvider({}).provider.readDocument('doc-1' as never))
      .rejects.toThrow(/chunk array/)
  })

  it('raises a loud contract failure for a non-array document listing and an id-less document', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(JSON.stringify({ data: 'nope' }))))
    await expect(makeProvider({}).provider.listDocuments('kb-1' as never))
      .rejects.toThrow(/without a document array/)

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(JSON.stringify({ data: [{ title: 'no id' }] }))))
    await expect(makeProvider({}).provider.listDocuments('kb-1' as never))
      .rejects.toThrow(/document without an id/)

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(JSON.stringify({ data: [null] }))))
    await expect(makeProvider({}).provider.listDocuments('kb-1' as never))
      .rejects.toThrow(/document without an id/)
  })

  it('maps transport, HTTP, body-bound, and parse failures onto the provider error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('connection refused') }))
    await expect(makeProvider({}).provider.list())
      .rejects.toThrow(WeknoraKnowledgeBaseError)

    vi.stubGlobal('fetch', vi.fn(async () => { throw 'boom' }))
    await expect(makeProvider({}).provider.list())
      .rejects.toThrow(/failed: boom/)

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse('{"error":"denied"}', 403)))
    const denied = await makeProvider({}).provider.list().catch((error: unknown) => error)
    expect(denied).toBeInstanceOf(WeknoraKnowledgeBaseError)
    expect((denied as WeknoraKnowledgeBaseError).status).toBe(403)
    expect((denied as WeknoraKnowledgeBaseError).message).toContain('HTTP 403')

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse('not json')))
    await expect(makeProvider({}).provider.list())
      .rejects.toThrow(/non-JSON body/)

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(JSON.stringify({ data: 'x'.repeat(64) }))))
    await expect(makeProvider({ maxResponseBytes: 8 }).provider.list())
      .rejects.toThrow(/byte limit/)
  })

  it('treats an empty body as a contract failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, body: null } as unknown as Response)))
    await expect(makeProvider({}).provider.list())
      .rejects.toThrow(/non-JSON body/)
  })
})
