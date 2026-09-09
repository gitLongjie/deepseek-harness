/** Knowledge-base sidebar section slot registration and its injected actions. */
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject, NS } from '../src/client/index.ts'
import type {
  KnowledgeNavInjected, KnowledgePageInjected,
} from '../src/client/contract/slots.ts'

afterEach(cleanup)

type RemoteStub = {
  list: ReturnType<typeof vi.fn>
  listDocuments: ReturnType<typeof vi.fn>
  readDocument: ReturnType<typeof vi.fn>
  describe: ReturnType<typeof vi.fn>
}

function stub(): RemoteStub {
  return {
    list: vi.fn(async () => ({ ok: true, value: { bases: [{ id: 'kb-1', name: '产品文档' }] } })),
    listDocuments: vi.fn(async () => ({ ok: true, value: { documents: [], total: 0 } })),
    readDocument: vi.fn(async () => ({
      ok: true,
      value: { id: 'doc-1', title: '指南', chunks: [{ index: 1, content: '第一步。' }], total: 1, page: 1, pageSize: 20 },
    })),
    describe: vi.fn(async () => ({ ok: true, value: { webUiUrl: 'http://kb.internal:8080' } })),
  }
}

async function bench(remote: RemoteStub) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const uiWorkspace = { startSession: vi.fn() }
  ctx.provide('uiWorkspace', uiWorkspace as never)
  const sessions = {
    list: {
      getSnapshot: () => ({ current: undefined }),
      subscribe: () => () => {},
    },
  }
  ctx.provide('sessions', sessions as never)
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  ctx.provide('remote.knowledgeBase', remote)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, uiWorkspace }
}

function declare(slots: SlotRegistry): () => void {
  // The shell (ui-sidebar) owns the sidebar declaration and claims the
  // knowledge hole in its children table; the bench mirrors that claim.
  return slots.register({
    name: 'root',
    children: {
      'sidebar': { kind: 'single', scope: 'root' },
      'sidebar.knowledge': { kind: 'single', scope: 'root' },
      'conversation.knowledge.browser': { kind: 'single', scope: 'root' },
    },
  } as never, () => null)
}

describe('ui-knowledge-base browser plugin', () => {
  it('declares only the services used by the knowledge contributions', () => {
    expect(NS).toBe('knowledge')
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.knowledgeBase', 'uiWorkspace', 'sessions'])
  })

  it('registers the nav row and the page without reading the Remote eagerly', async () => {
    const remote = stub()
    const b = await bench(remote)
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    expect(b.slots.entries('sidebar.knowledge')).toHaveLength(1)
    expect(b.slots.entries('conversation.knowledge.browser')).toHaveLength(1)
    expect(remote.list).not.toHaveBeenCalled()

    // The nav row opens the page through the navigation service.
    const nav = (b.slots.entries('sidebar.knowledge')[0]!.inject as unknown as () => KnowledgeNavInjected)()
    nav.openPage()
    const uiKnowledge = b.ctx.get('uiKnowledge') as unknown as {
      view: { getSnapshot(): { open: boolean; base: unknown } }
    }
    expect(uiKnowledge.view.getSnapshot().open).toBe(true)
    await b.ctx.fiber.dispose()
  })

  it('drives the page through the page injected share', async () => {
    const remote = stub()
    remote.listDocuments.mockResolvedValueOnce({
      ok: true,
      value: { documents: [{ id: 'doc-1', title: '指南' }], total: 1 },
    })
    const b = await bench(remote)
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const page = (b.slots.entries('conversation.knowledge.browser')[0]!.inject as unknown as () => KnowledgePageInjected)()

    // Selecting a base in the list fills the browser pane.
    page.openBase({ id: 'kb-1', name: '产品文档' })
    await expect(page.listDocuments('kb-1', '指南')).resolves.toEqual({
      documents: [{ id: 'doc-1', title: '指南' }],
      total: 1,
    })
    expect(remote.listDocuments).toHaveBeenCalledWith({ baseId: 'kb-1', query: { keyword: '指南' } })

    // Asking starts a session through the Workspace UI's shared action; the
    // session watcher closes the page on that navigation.
    page.startSession()
    expect(b.uiWorkspace.startSession).toHaveBeenLastCalledWith()

    // Back returns to the base list without closing the page.
    page.closeBase()
    await b.ctx.fiber.dispose()
  })

  it('degrades a describe failure to a hidden manage action, keeping the listing', async () => {
    const remote = stub()
    remote.describe.mockResolvedValueOnce({ ok: false, error: { code: 'REMOTE_ERROR', message: 'unavailable' } })
    const b = await bench(remote)
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const page = (b.slots.entries('conversation.knowledge.browser')[0]!.inject as unknown as () => KnowledgePageInjected)()
    await expect(page.load()).resolves.toEqual({ bases: [{ id: 'kb-1', name: '产品文档' }], webUiUrl: null })
  })

  it('surfaces a list failure as a rejected load the page renders as its retry state', async () => {
    const remote = stub()
    remote.list.mockResolvedValueOnce({ ok: false, error: { code: 'REMOTE_ERROR', message: 'unreachable' } })
    const b = await bench(remote)
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const page = (b.slots.entries('conversation.knowledge.browser')[0]!.inject as unknown as () => KnowledgePageInjected)()
    await expect(page.load()).rejects.toThrow('knowledgeBase.list failed: REMOTE_ERROR: unreachable')
  })

  it('removes the entries on teardown and re-registers after a late declaration', async () => {
    const b = await bench(stub())
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('sidebar.knowledge')).toHaveLength(0)
    expect(b.slots.entries('conversation.knowledge.browser')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('sidebar.knowledge')).toHaveLength(1)
      expect(b.slots.entries('conversation.knowledge.browser')).toHaveLength(1)
    })
    stop()
    expect(b.slots.entries('sidebar.knowledge')).toHaveLength(0)
    expect(b.slots.entries('conversation.knowledge.browser')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('conversation.knowledge.browser')).toHaveLength(1)
    })

    await fiber.dispose()
    expect(b.slots.entries('sidebar.knowledge')).toHaveLength(0)
    expect(b.slots.entries('conversation.knowledge.browser')).toHaveLength(0)
    await b.ctx.fiber.dispose()
  })
})
