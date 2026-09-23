/**
 * The hire flow across packages: the expert page's hire action must land the
 * card's preset on the conversation flow's seat — staged before the session
 * starts, applied when the blank session becomes current, and named by the
 * chip over the whole healthy roster. This spec mounts the REAL ui-expert and
 * ui-agent-preset browser plugins over controller doubles, so a broken hop
 * between the two packages fails here rather than only in a running client.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SessionId } from '@deepseek-ai/dsh-session'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as agentPresetApply, inject as agentPresetInject } from '@deepseek-ai/dsh-client-ui-agent-preset/client'
import { apply as expertApply, inject as expertInject } from '../src/client/index.ts'

type SessionRow = {
  id: string
  blank: boolean
  projectionValues?: { agentPreset?: string | null }
}

const ROSTER = {
  ok: true as const,
  value: {
    presets: [
      { id: 'standard', trust: 'system' as const, isDefault: true },
      { id: 'geo-optimizer', trust: 'system' as const, isDefault: false, name: 'GEO 优化专家', category: 'marketing' },
    ],
    authorable: true,
    modeSelectionEnabled: true,
  },
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)

  const selectCalls: Array<{ sessionId: string; agentPreset: string }> = []
  const agentPresets = {
    list: () => Promise.resolve(ROSTER),
    select: (_agentId: string, agentPreset: string) => {
      selectCalls.push({ sessionId: _agentId, agentPreset })
      return Promise.resolve({ ok: true as const, value: agentPreset })
    },
  }

  const settings = {
    update: () => Promise.resolve({ ok: true as const, value: {} }),
  }
  const remote = new TestRemote(ctx, { settings, agentPresets })

  const sessionState: { current?: string; byId: Record<string, SessionRow> } = {
    current: 's1',
    byId: { s1: { id: 's1', blank: true, projectionValues: { agentPreset: 'standard' } } },
  }
  const sessionListeners = new Set<() => void>()
  ctx.provide('sessions', {
    list: {
      getSnapshot: () => sessionState,
      subscribe: (fn: () => void) => {
        sessionListeners.add(fn)
        return () => { sessionListeners.delete(fn) }
      },
    },
  } as never)

  const starts: unknown[] = []
  const adoptionListeners: Array<(sessionId: string) => void | Promise<void>> = []
  ctx.provide('uiWorkspace', {
    startSession: () => { starts.push(null) },
    bindPlaceholderAdoption: (listener: (sessionId: string) => void | Promise<void>) => {
      adoptionListeners.push(listener)
      return () => {
        const at = adoptionListeners.indexOf(listener)
        if (at >= 0) adoptionListeners.splice(at, 1)
      }
    },
  } as never)

  const panelListeners: Array<(panelId: unknown) => void> = []
  ctx.provide('layout', {
    selectPanel: () => {},
    onPanelSelection: (listener: (panelId: unknown) => void) => {
      panelListeners.push(listener)
      return () => {
        const at = panelListeners.indexOf(listener)
        if (at >= 0) panelListeners.splice(at, 1)
      }
    },
  } as never)

  return { ctx, selectCalls, sessionState, sessionListeners, starts, adoptionListeners, remote }
}

function declareSlots(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'sidebar.experts': { kind: 'single', scope: 'root' },
      'conversation.expert.browser': { kind: 'single', scope: 'root' },
      'conversation.hero.agentPreset': { kind: 'single', scope: 'root' },
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'settings.section': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

describe('expert hire across packages', () => {
  it('stages the card preset, composes the adopted placeholder, and names the expert', async () => {
    const b = await bench()
    declareSlots(b.ctx.get('slots') as SlotRegistry)
    b.ctx.provide('conversation', {} as never)

    // The conversation flow (ui-agent-preset's inner scope) first, then the
    // expert page: the production order has the flow bound before any hire.
    await b.ctx.plugin({
      inject: [...agentPresetInject, 'conversation', 'sessions', 'uiWorkspace'],
      apply: agentPresetApply,
    }).await()
    await b.ctx.plugin({ inject: [...expertInject], apply: expertApply }).await()

    // The chip loads its roster the way its mount does.
    const slots = b.ctx.get('slots') as SlotRegistry
    const seat = (slots.entries('conversation.hero.agentPreset')[0]!
      .inject as unknown as () => {
      hooks: { agentPresetSeat: { getSnapshot: () => { current: string; currentPreset?: { name?: string }; introduce: boolean } } }
      load: () => Promise<void>
    })()
    await seat.load()
    expect(seat.hooks.agentPresetSeat.getSnapshot().current).toBe('standard')

    // The expert page's hire action, exactly as the card button invokes it.
    const page = (slots.entries('conversation.expert.browser')[0]!
      .inject as unknown as () => { hire: (id: string) => void })()
    page.hire('geo-optimizer')

    // The pick is waiting before the flow starts the session...
    expect(b.starts).toHaveLength(1)
    expect(seat.hooks.agentPresetSeat.getSnapshot().current).toBe('geo-optimizer')
    expect(seat.hooks.agentPresetSeat.getSnapshot().introduce).toBe(true)

    // ...the workspace flow adopts the blank placeholder, and the adoption
    // must NOT restore the deployment default over the staged pick.
    expect(b.adoptionListeners).toHaveLength(1)
    await b.adoptionListeners[0]!(SessionId('s1'))
    expect(b.selectCalls).toEqual([])

    // The started session becomes current; the seat composes it there.
    b.sessionListeners.forEach((fn) => { fn() })
    await new Promise((resolve) => { setTimeout(resolve, 0) })

    expect(b.selectCalls).toEqual([{ sessionId: 's1', agentPreset: 'geo-optimizer' }])
    const snapshot = seat.hooks.agentPresetSeat.getSnapshot()
    expect(snapshot.current).toBe('geo-optimizer')
    // The chip names the composition by its roster name — experts included —
    // because the menu cannot offer it.
    expect(snapshot.currentPreset?.name).toBe('GEO 优化专家')
    expect(b.remote).toBeDefined()
  })
})
