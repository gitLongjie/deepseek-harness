/** Expert-center slot registration and its injected actions. */
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject, NS } from '../src/client/index.ts'
import { UiExpertService } from '../src/client/navigation.ts'

afterEach(() => { vi.restoreAllMocks() })

type RemoteStub = { list: ReturnType<typeof vi.fn> }

function stub(): RemoteStub {
  return {
    list: vi.fn(async () => ({
      ok: true,
      value: {
        presets: [
          // A mode preset: no card metadata, never admitted to the market.
          { id: 'standard', trust: 'system' as const, isDefault: true, name: '标准模式' },
          // A shipped expert: category is the committed expert marker.
          {
            id: 'geo-optimizer', trust: 'system' as const, isDefault: false,
            name: 'GEO 优化专家', category: 'marketing',
          },
          // A shipped expert with richer card metadata.
          {
            id: 'fresh-expert', trust: 'user' as const, isDefault: false,
            name: '新装专家', category: '写作', icon: '✒️',
          },
        ],
        authorable: true,
      },
    })),
  }
}

async function bench(remote: RemoteStub) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const calls: string[] = []
  const uiAgentPreset = { stageNextSessionPreset: vi.fn((id: string) => { calls.push(`stage:${id}`) }) }
  ctx.provide('uiAgentPreset', uiAgentPreset as never)
  const uiWorkspace = { startSession: vi.fn(() => { calls.push('start') }) }
  ctx.provide('uiWorkspace', uiWorkspace as never)
  const layout = { selectPanel: vi.fn((panelId: unknown) => { calls.push(panelId === null ? 'panel:conversation' : 'panel') }) }
  ctx.provide('layout', layout as never)
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
  ctx.provide('remote.agentPresets', remote)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, uiAgentPreset, uiWorkspace, calls }
}

function declare(slots: SlotRegistry): () => void {
  // The shells (ui-sidebar, ui-conversation) own these declarations and claim
  // the expert holes in their children tables; the bench mirrors that claim.
  return slots.register({
    name: 'root',
    children: {
      'sidebar': { kind: 'single', scope: 'root' },
      'sidebar.experts': { kind: 'single', scope: 'root' },
      'conversation.expert.browser': { kind: 'single', scope: 'root' },
    },
  } as never, () => null)
}

describe('ui-expert browser plugin', () => {
  it('declares only the services used by the expert contributions', () => {
    expect(NS).toBe('expert')
    expect(inject).toEqual([
      'slots', 'locale', 'remote', 'remote.agentPresets', 'sessions', 'layout', 'uiWorkspace', 'uiAgentPreset',
    ])
  })

  it('registers the nav row and the page without reading the Remote eagerly', async () => {
    const remote = stub()
    const b = await bench(remote)
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    expect(b.slots.entries('sidebar.experts')).toHaveLength(1)
    expect(b.slots.entries('conversation.expert.browser')).toHaveLength(1)
    expect(remote.list).not.toHaveBeenCalled()
  })

  it('admits only shipped experts with card metadata, and hires stage-then-start', async () => {
    const remote = stub()
    const b = await bench(remote)
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const page = b.slots.entries('conversation.expert.browser')[0]
    expect(page).toBeDefined()
    const injected = (page?.inject as unknown as () => {
      load: () => Promise<{ experts: readonly { id: string; name?: string }[] }>
      hire: (id: string) => void
    })()

    const { experts } = await injected.load()
    // The roster is the market's only source: the mode preset never enters,
    // and every admitted row is the deployment's own record.
    expect(experts.map(expert => expert.id)).toEqual(['geo-optimizer', 'fresh-expert'])
    expect(experts.find(expert => expert.id === 'geo-optimizer')?.name).toBe('GEO 优化专家')
    expect(remote.list).toHaveBeenCalledTimes(1)

    injected.hire('geo-optimizer')
    // The stage must be waiting before the flow creates the session, and the
    // page must stand down so the session surface takes the area back.
    expect(b.calls).toEqual(['stage:geo-optimizer', 'start'])
    expect((b.ctx.get('uiExpert') as UiExpertService).view.getSnapshot().open).toBe(false)
  })

  it('degrades to an empty market when the roster read refuses', async () => {
    const remote: RemoteStub = {
      list: vi.fn(async () => ({ ok: false, error: { code: 'invocation-unavailable', message: 'absent' } })),
    }
    const b = await bench(remote)
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const page = b.slots.entries('conversation.expert.browser')[0]
    const injected = (page?.inject as unknown as () => { load: () => Promise<{ experts: readonly { id: string }[] }> })()

    const { experts } = await injected.load()
    expect(experts).toEqual([])
  })
})
