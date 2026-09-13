/** Expert-center slot registration and its injected actions. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject, NS } from '../src/client/index.ts'
import { UiExpertService } from '../src/client/navigation.ts'
import { MOCK_EXPERT_PRESETS } from '../src/client/mock-data.ts'

afterEach(() => { vi.restoreAllMocks() })

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const calls: string[] = []
  const uiAgentPreset = { stageNextSessionPreset: vi.fn((id: string) => { calls.push(`stage:${id}`) }) }
  ctx.provide('uiAgentPreset', uiAgentPreset as never)
  const uiWorkspace = { startSession: vi.fn(() => { calls.push('start') }) }
  ctx.provide('uiWorkspace', uiWorkspace as never)
  const sessions = {
    list: {
      getSnapshot: () => ({ current: undefined }),
      subscribe: () => () => {},
    },
  }
  ctx.provide('sessions', sessions as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, calls }
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
      'slots', 'locale', 'sessions', 'uiWorkspace', 'uiAgentPreset',
    ])
  })

  it('registers the nav row and the page', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    expect(b.slots.entries('sidebar.experts')).toHaveLength(1)
    expect(b.slots.entries('conversation.expert.browser')).toHaveLength(1)
  })

  it('serves the curated market from the page inject and hires stage-then-start', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const page = b.slots.entries('conversation.expert.browser')[0]
    expect(page).toBeDefined()
    const injected = (page?.inject as unknown as () => {
      load: () => Promise<{ presets: readonly { id: string }[] }>
      hire: (id: string) => void
    })()

    // The market content is this package's own roster: the deployment's
    // preset list never reaches the page, so mode presets cannot present
    // here as hireable experts.
    const { presets } = await injected.load()
    expect(presets).toBe(MOCK_EXPERT_PRESETS)

    injected.hire('geo-optimizer')
    // The stage must be waiting before the flow creates the session, and the
    // page must stand down so the session surface takes the area back.
    expect(b.calls).toEqual(['stage:geo-optimizer', 'start'])
    expect((b.ctx.get('uiExpert') as UiExpertService).view.getSnapshot().open).toBe(false)
  })
})
