/**
 * The agent-preset roster store: it derives the display options from one
 * roster call and treats an empty roster as "this deployment composes no
 * presets" rather than as a failure. The management section writes each
 * preference through a narrow field writer in the same settings namespace.
 */

import { describe, expect, it } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { RemoteErrorCode } from '@deepseek-ai/dsh-api-remotes/client'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  AGENT_PRESET_SETTINGS_NS, AgentPresetSettingsController,
  presetOptions,
  writeDefaultPreset, writeModeSelectionEnabled,
} from '../src/client/settings-store.ts'

/** The roster store over a scripted context. */
function derivedController(ctx: ClientContext) {
  return new AgentPresetSettingsController(ctx)
}
import { AgentPresetSeatController } from '../src/client/seat-store.ts'

type SeatSession = Pick<SessionSummary, 'id' | 'blank' | 'projectionValues'>

/** One roster row a spec scripts, with the metadata a surface may read. */
interface FakePreset {
  id: string
  trust: 'system' | 'user'
  isDefault: boolean
  name?: string
  category?: string
  broken?: string
}

interface Recorded { ns: string; ops: unknown }

/** A roster Remote answering a fixed set of rows, or refusing. */
function fakeRoster(
  presets: FakePreset[],
  options: {
    failList?: string
    failListCode?: RemoteErrorCode
    settings?: object
    showPicker?: boolean
  } = {},
): ClientContext {
  return {
    remote: {
      ...options.settings === undefined ? {} : { settings: options.settings },
      agentPresets: {
        list: () => {
          return Promise.resolve(options.failList === undefined
            ? {
              ok: true as const,
              value: {
                presets, authorable: true, modeSelectionEnabled: options.showPicker ?? true,
              },
            }
            : {
              ok: false as const,
              error: new RemoteError(options.failListCode ?? 'gateway/internal', options.failList, {}),
            })
        },
      },
    },
  } as unknown as ClientContext
}

/** A context whose roster and settings write outcome the test controls. */
function fakeApi(
  presets: FakePreset[],
  options: {
    writes?: Recorded[]
    failWrite?: string
    failList?: string
  } = {},
): ClientContext {
  const settings = {
    update: (ns: string, patch: { default?: unknown; modeSelectionEnabled?: unknown }) => {
      options.writes?.push({ ns, ops: patch })
      if (options.failWrite !== undefined) {
        return Promise.resolve({ ok: false as const, error: new RemoteError('gateway/internal', options.failWrite, {}) })
      }
      if (patch.default !== undefined) {
        for (const preset of presets) preset.isDefault = preset.id === patch.default
      }
      return Promise.resolve({ ok: true as const, value: {} })
    },
  }
  return fakeRoster(presets, {
    settings,
    ...options.failList === undefined ? {} : { failList: options.failList },
  })
}

describe('the agent-preset roster store', () => {
  it('derives the display options from one roster call', async () => {
    const controller = derivedController(fakeApi([
      { id: 'standard', trust: 'system', isDefault: true },
      { id: 'mine', trust: 'user', isDefault: false },
    ]))

    await controller.load()

    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.options).toEqual([
      { id: 'standard', trust: 'system' },
      { id: 'mine', trust: 'user' },
    ])
  })

  it('offers no broken preset: the pickers choose the NEXT session\'s composition', async () => {
    const controller = derivedController(fakeApi([
      { id: 'standard', trust: 'system', isDefault: true },
      { id: 'damaged', trust: 'user', isDefault: false, broken: 'the composition is not valid YAML' },
    ] as never))

    await controller.load()

    // A broken preset cannot compose a session; listing it here would defer
    // that discovery to a failed session start. The management section shows
    // (and deletes) it from its own store instead.
    expect(controller.store.getSnapshot().options.map(option => option.id)).toEqual(['standard'])
  })

  it('carries the display metadata a preset published', async () => {
    const controller = derivedController(fakeApi([
      { id: 'standard', trust: 'system', isDefault: true, name: '标准模式', description: '完整的编码 agent。' },
    ] as never))

    await controller.load()

    // Surfaces beyond this row read the same options; the id alone never said
    // what a preset does.
    expect(controller.store.getSnapshot().options).toEqual([
      { id: 'standard', trust: 'system', name: '标准模式', description: '完整的编码 agent。' },
    ])
  })

  it('keeps an expert-marked preset nameable: the label reads this store', async () => {
    const controller = derivedController(fakeApi([
      { id: 'standard', trust: 'system', isDefault: true },
      { id: 'geo-optimizer', trust: 'system', isDefault: false, name: 'GEO 专家', category: 'marketing' },
    ] as never))

    await controller.load()

    // A session hired from the expert market runs that preset, and the header
    // label names what the session runs rather than printing the raw id.
    expect(controller.store.getSnapshot().options).toEqual([
      { id: 'standard', trust: 'system' },
      { id: 'geo-optimizer', trust: 'system', name: 'GEO 专家' },
    ])
  })

  it('presetOptions offers no expert-marked preset: the market owns those cards', () => {
    expect(presetOptions([
      { id: 'standard', trust: 'system', isDefault: true },
      { id: 'geo-optimizer', trust: 'system', isDefault: false, category: 'marketing' },
      { id: 'damaged', trust: 'user', isDefault: false, broken: 'not valid YAML', category: 'writing' },
    ] as never)).toEqual([{ id: 'standard', trust: 'system' }])
  })

  it('reports an empty roster as unavailable, not as an error', async () => {
    const controller = derivedController(fakeApi([]))

    await controller.load()

    // A deployment composing no presets is valid: every session shares the
    // host composition and the surfaces render nothing.
    expect(controller.store.getSnapshot().status).toBe('unavailable')
    expect(controller.store.getSnapshot().error).toBeNull()
  })

  it('treats an unavailable optional namespace as an empty roster', async () => {
    const controller = derivedController(fakeRoster([], {
      failList: 'no active Remote method exports this endpoint',
      failListCode: 'gateway/invocation-unavailable',
    }))

    await controller.load()

    expect(controller.store.getSnapshot()).toMatchObject({ status: 'unavailable', error: null, options: [] })
  })

  it('writeDefaultPreset writes only the default field, into the agent-presets namespace', async () => {
    const writes: Recorded[] = []
    const ctx = fakeApi([
      { id: 'standard', trust: 'system', isDefault: true },
      { id: 'minimal', trust: 'system', isDefault: false },
    ], { writes })

    expect(await writeDefaultPreset(ctx, 'minimal')).toBeUndefined()

    expect(writes).toEqual([{
      ns: AGENT_PRESET_SETTINGS_NS,
      ops: { default: 'minimal' },
    }])
  })

  it('writeDefaultPreset surfaces the refusal message when the write fails', async () => {
    const ctx = fakeApi([
      { id: 'standard', trust: 'system', isDefault: true },
    ], { failWrite: 'read-only settings' })

    expect(await writeDefaultPreset(ctx, 'minimal')).toBe('read-only settings')
  })

  it('writeModeSelectionEnabled writes only the picker policy field', async () => {
    const writes: Recorded[] = []

    expect(await writeModeSelectionEnabled(fakeApi([], { writes }), false)).toBeUndefined()
    expect(writes).toEqual([{
      ns: AGENT_PRESET_SETTINGS_NS,
      ops: { modeSelectionEnabled: false },
    }])
  })

  it('surfaces a roster failure without claiming the deployment has no presets', async () => {
    const controller = derivedController(fakeApi([], { failList: 'host down' }))

    await controller.load()

    const state = controller.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('host down')
  })

  it('ignores a load while one is already in flight', async () => {
    const writes: Recorded[] = []
    const controller = derivedController(fakeApi(
      [{ id: 'standard', trust: 'system', isDefault: true }], { writes }))

    await Promise.all([controller.load(), controller.load()])

    expect(controller.store.getSnapshot().status).toBe('ready')
  })

})

describe('the new-session chip controller', () => {
  /** A chip over a current session the test can move, or resolve by id. */
  function chip(
    presets: FakePreset[],
    current: SeatSession | undefined | ((id?: SessionId) => SeatSession | undefined),
    options: {
      writes?: Recorded[]
      failSelect?: string
      failList?: string
      failListCode?: RemoteErrorCode
      showPicker?: boolean
      list?: () => Promise<ReturnType<typeof remoteRoster>>
    } = {},
  ): AgentPresetSeatController {
    const ctx = {
      remote: {
        agentPresets: {
          list: options.list ?? (() => {
            return Promise.resolve(options.failList === undefined
              ? {
                ok: true as const,
                value: {
                  presets, authorable: true, modeSelectionEnabled: options.showPicker ?? true,
                },
              }
              : {
                ok: false as const,
                error: new RemoteError(options.failListCode ?? 'gateway/internal', options.failList, {}),
              })
          }),
          select: (agentId: SessionId, agentPreset: string) => {
            options.writes?.push({ ns: 'select', ops: agentPreset })
            return Promise.resolve(options.failSelect === undefined
              ? { ok: true as const, value: agentPreset }
              : {
                ok: false as const,
                error: new RemoteError('agent-preset/locked', options.failSelect, {
                  sessionId: agentId, agentPreset,
                }),
              })
          },
        },
      },
    } as unknown as ClientContext
    return new AgentPresetSeatController(
      ctx,
      typeof current === 'function' ? current : () => current,
    )
  }

  const ROSTER: FakePreset[] = [
    { id: 'standard', trust: 'system', isDefault: true },
    { id: 'minimal', trust: 'system', isDefault: false },
  ]

  /** The roster after the expert market installed one into the user root. */
  const ROSTER_EXPERT: FakePreset[] = [
    { id: 'standard', trust: 'system', isDefault: true },
    {
      id: 'geo-optimizer', trust: 'user', isDefault: false,
      name: 'GEO 优化专家', category: 'marketing',
    },
  ]

  it('opens on the deployment default', async () => {
    const controller = chip(ROSTER, undefined)

    await controller.load()

    // The chip names the session about to start, and nothing about it is
    // decided yet — the default is the honest opening value.
    expect(controller.store.getSnapshot().current).toBe('standard')
    expect(controller.store.getSnapshot().options).toEqual([
      { id: 'standard', trust: 'system' },
      { id: 'minimal', trust: 'system' },
    ])
  })

  it('takes picker visibility from the newest Host roster truth', async () => {
    const first = Promise.withResolvers<ReturnType<typeof remoteRoster>>()
    const second = Promise.withResolvers<ReturnType<typeof remoteRoster>>()
    const replies = [first.promise, second.promise]
    const controller = chip([], undefined, { list: () => replies.shift()! })

    const older = controller.load()
    const newer = controller.load()
    second.resolve(remoteRoster(false))
    await newer
    first.resolve(remoteRoster(true))
    await older

    expect(controller.store.getSnapshot()).toMatchObject({
      showPicker: false, current: 'standard', error: null,
    })
  })

  it('shows the first preset when the roster marks none default', async () => {
    const controller = chip([{ id: 'minimal', trust: 'system', isDefault: false }], undefined)

    await controller.load()

    // Settings can name a preset that was since deleted; the chip still has
    // to open on something rather than render nothing.
    expect(controller.store.getSnapshot().current).toBe('minimal')
  })

  it('skips an expert-marked default: the market hires those, the chip offers modes', async () => {
    const controller = chip([
      { id: 'geo-optimizer', trust: 'system', isDefault: true, category: 'marketing' },
      { id: 'standard', trust: 'system', isDefault: false },
    ] as never, undefined)

    await controller.load()

    const state = controller.store.getSnapshot()
    expect(state.options.map(option => option.id)).toEqual(['standard'])
    expect(state.current).toBe('standard')
  })

  it('names the composition a chat runs, including one the menu cannot offer', async () => {
    const controller = chip(ROSTER_EXPERT, {
      id: 's1' as SessionId,
      blank: true,
      projectionValues: { agentPreset: 'geo-optimizer' },
    })

    await controller.load()

    const state = controller.store.getSnapshot()
    // A hire composed this chat, and the market is where an expert is chosen:
    // the menu still offers modes alone, while the chip names what the chat
    // will actually run instead of showing the raw identifier.
    expect(state.options.map(option => option.id)).toEqual(['standard'])
    expect(state.currentPreset?.name).toBe('GEO 优化专家')
  })

  it('carries the display metadata into the menu rows', async () => {
    const controller = chip([
      { id: 'standard', trust: 'system', isDefault: true, name: '标准模式', description: '完整的编码 agent。' },
    ] as never, undefined)

    await controller.load()

    expect(controller.store.getSnapshot().options).toEqual([
      { id: 'standard', trust: 'system', name: '标准模式', description: '完整的编码 agent。' },
    ])
  })

  it('opens on nothing when the deployment composes no presets', async () => {
    const controller = chip([], undefined)

    await controller.load()

    // An empty roster is a valid deployment: every session shares the host
    // composition, and the chip renders nothing rather than an empty control.
    expect(controller.store.getSnapshot().current).toBe('')
  })

  it('opens on nothing when the optional namespace is unavailable', async () => {
    const controller = chip([], undefined, {
      failList: 'no active Remote method exports this endpoint',
      failListCode: 'gateway/invocation-unavailable',
    })

    await controller.load()

    expect(controller.store.getSnapshot()).toMatchObject({ current: '', error: null, options: [] })
  })

  it('stages a pick made before any session exists', async () => {
    const writes: Recorded[] = []
    const controller = chip(ROSTER, undefined, { writes })
    await controller.load()

    await controller.select('minimal')

    // Nothing to switch yet: the new-session screen precedes the session.
    expect(writes).toEqual([])
    expect(controller.store.getSnapshot().current).toBe('minimal')
  })

  it('replaces the default display when an existing blank session arrives after roster load', async () => {
    const state: { current?: SeatSession } = {}
    const controller = chip([
      { id: 'standard', trust: 'system', isDefault: false },
      { id: 'minimal', trust: 'system', isDefault: true },
    ], () => state.current)
    await controller.load()
    expect(controller.store.getSnapshot().current).toBe('minimal')

    state.current = {
      id: 's1' as SessionId,
      blank: true,
      projectionValues: { agentPreset: 'standard' },
    }
    await controller.apply()

    expect(controller.store.getSnapshot().current).toBe('standard')
  })

  it('applies the stage to the blank session the flow lands on', async () => {
    const writes: Recorded[] = []
    const current = {
      id: 's1' as SessionId,
      blank: true,
      projectionValues: { agentPreset: 'standard' },
    }
    const controller = chip(ROSTER, current, { writes })
    await controller.load()
    await controller.select('minimal')

    expect(writes).toEqual([{ ns: 'select', ops: 'minimal' }])
    expect(controller.store.getSnapshot().current).toBe('minimal')
  })

  it('spends the stage exactly once', async () => {
    const writes: Recorded[] = []
    const controller = chip(ROSTER, {
      id: 's1' as SessionId,
      blank: true,
      projectionValues: { agentPreset: 'standard' },
    }, { writes })
    await controller.load()
    await controller.select('minimal')

    await controller.apply()
    await controller.apply()

    // Every later list movement calls apply(); an unspent stage would keep
    // switching sessions the user never picked for.
    expect(writes).toEqual([{ ns: 'select', ops: 'minimal' }])
  })

  it('drops the stage against a session that already started', async () => {
    const writes: Recorded[] = []
    const controller = chip(ROSTER, {
      id: 's1' as SessionId,
      blank: false,
      projectionValues: { agentPreset: 'standard' },
    }, { writes })
    await controller.load()

    await controller.select('minimal')

    // The host enforces the same rule; the chip simply never asks.
    expect(writes).toEqual([])
  })

  it('drops the stage when the session already runs it', async () => {
    const writes: Recorded[] = []
    const controller = chip(ROSTER, {
      id: 's1' as SessionId,
      blank: true,
      projectionValues: { agentPreset: 'minimal' },
    }, { writes })
    await controller.load()

    await controller.select('minimal')

    expect(writes).toEqual([])
  })

  it('falls back to the default when the host refuses the switch', async () => {
    const controller = chip(
      ROSTER,
      {
        id: 's1' as SessionId,
        blank: true,
        projectionValues: { agentPreset: 'standard' },
      },
      { failSelect: 'already started' },
    )
    await controller.load()

    await controller.select('minimal')

    // Showing `minimal` after a refusal would claim a composition the session
    // never got.
    expect(controller.store.getSnapshot()).toMatchObject({ current: 'standard', error: 'already started' })
  })

  it('ignores a pick while a switch is in flight', async () => {
    const writes: Recorded[] = []
    const controller = chip(ROSTER, {
      id: 's1' as SessionId,
      blank: true,
      projectionValues: { agentPreset: 'standard' },
    }, { writes })
    await controller.load()

    const first = controller.select('minimal')
    await controller.select('standard')
    await first

    expect(writes).toEqual([{ ns: 'select', ops: 'minimal' }])
  })

  it('keeps a staged pick across a roster refresh', async () => {
    const controller = chip(ROSTER, undefined)
    await controller.load()
    await controller.select('minimal')

    await controller.load()

    // A settings push re-reads the roster; it must not silently discard what
    // the user picked for the session they are about to start.
    expect(controller.store.getSnapshot().current).toBe('minimal')
  })

  it('clears an unconsumed stage when the Host hides the picker', async () => {
    const writes: Recorded[] = []
    const controller = chip(ROSTER, {
      id: 's1' as SessionId,
      blank: false,
      projectionValues: { agentPreset: 'standard' },
    }, { writes, showPicker: false })
    controller.stage('minimal', true)

    await controller.load()
    await controller.apply()

    expect(writes).toEqual([])
    expect(controller.store.getSnapshot()).toMatchObject({
      showPicker: false,
      current: 'standard',
      introduce: false,
    })
  })

  it('reports a refused roster read without emptying the chip', async () => {
    const controller = chip(ROSTER, undefined, { failList: 'host down' })

    await controller.load()

    expect(controller.store.getSnapshot()).toMatchObject({ error: 'host down', options: [] })
  })

  describe('the adopted New Session placeholder', () => {
    /** A chip whose session reader resolves any listed Session by id. */
    function chipOver(
      presets: FakePreset[],
      sessions: Record<string, SeatSession>,
      options: { writes?: Recorded[]; failSelect?: string; failList?: string } = {},
    ): AgentPresetSeatController {
      return chip(presets, id => (id === undefined ? undefined : sessions[id]), options)
    }

    /** One blank placeholder, composed from `preset` when one is named. */
    function placeholder(preset?: string): Record<string, SeatSession> {
      return {
        s1: {
          id: 's1' as SessionId,
          blank: true,
          ...preset === undefined ? {} : { projectionValues: { agentPreset: preset } },
        },
      }
    }

    it('restores the composition a new Session gets', async () => {
      const writes: Recorded[] = []
      const controller = chipOver(ROSTER_EXPERT, placeholder('geo-optimizer'), { writes })

      await controller.prepareNewSession('s1' as SessionId)

      // A chat the user hired an expert into and never used is the NEXT new
      // session's placeholder: adopting it must not start a chat under a
      // composition nobody asked for this flow.
      expect(writes).toEqual([{ ns: 'select', ops: 'standard' }])
    })

    it('leaves a placeholder already composing the default alone', async () => {
      const writes: Recorded[] = []
      const controller = chipOver(ROSTER, placeholder('standard'), { writes })
      // A chip that already read the roster knows the default without asking
      // again; the step reuses that read.
      await controller.load()

      await controller.prepareNewSession('s1' as SessionId)

      expect(writes).toEqual([])
    })

    it('keeps a mode picked on this screen', async () => {
      const writes: Recorded[] = []
      const controller = chipOver(ROSTER, placeholder('minimal'), { writes })

      await controller.prepareNewSession('s1' as SessionId)

      // The chip offers this preset, so the user may have picked it for this
      // very chat: adopting the placeholder must not overrule that.
      expect(writes).toEqual([])
    })

    it('restores a placeholder that records no preset at all', async () => {
      const writes: Recorded[] = []
      const controller = chipOver(ROSTER, placeholder(), { writes })

      await controller.prepareNewSession('s1' as SessionId)

      // Nothing chose this Session's composition — a fresh create resolves the
      // default — so the placeholder is composed like one.
      expect(writes).toEqual([{ ns: 'select', ops: 'standard' }])
    })

    it('ignores a placeholder it cannot read', async () => {
      const writes: Recorded[] = []
      const controller = chipOver(ROSTER_EXPERT, placeholder('geo-optimizer'), { writes })

      await controller.prepareNewSession('gone' as SessionId)

      // Nothing is listed under that id, so there is no composition to judge.
      expect(writes).toEqual([])
    })

    it('leaves a Session that has started to the composition it ran', async () => {
      const writes: Recorded[] = []
      const controller = chipOver(ROSTER_EXPERT, {
        s1: { id: 's1' as SessionId, blank: false, projectionValues: { agentPreset: 'geo-optimizer' } },
      }, { writes })

      await controller.prepareNewSession('s1' as SessionId)

      // Its history was produced under that composition; the host refuses the
      // swap anyway, and the user is using the chat.
      expect(writes).toEqual([])
    })

    it('defers to a pick this flow already staged', async () => {
      const writes: Recorded[] = []
      const controller = chipOver(ROSTER_EXPERT, placeholder('geo-optimizer'), { writes })
      controller.stage('minimal')

      await controller.prepareNewSession('s1' as SessionId)

      // The staged pick IS what this flow asked for, and the applier owns
      // switching the Session onto it.
      expect(writes).toEqual([])
    })

    it('restores nothing while the roster marks no default', async () => {
      const writes: Recorded[] = []
      const controller = chipOver(
        [{ id: 'standard', trust: 'system', isDefault: false }],
        placeholder('geo-optimizer'),
        { writes },
      )

      await controller.prepareNewSession('s1' as SessionId)

      // Without a marked default there is no composition a fresh create would
      // produce, so the placeholder's own is the best answer available.
      expect(writes).toEqual([])
    })

    it('survives a refused roster read', async () => {
      const writes: Recorded[] = []
      const controller = chipOver(ROSTER_EXPERT, placeholder('geo-optimizer'), {
        writes, failList: 'host down',
      })

      await controller.prepareNewSession('s1' as SessionId)

      expect(writes).toEqual([])
    })

    it('ignores a refusal from a Session that started mid-step', async () => {
      const controller = chipOver(ROSTER_EXPERT, placeholder('geo-optimizer'), {
        failSelect: 'already started',
      })

      await expect(controller.prepareNewSession('s1' as SessionId)).resolves.toBeUndefined()
    })
  })

})

function remoteRoster(modeSelectionEnabled: boolean) {
  return {
    ok: true as const,
    value: {
      presets: [{ id: 'standard', trust: 'system' as const, isDefault: true }],
      authorable: true,
      modeSelectionEnabled,
    },
  }
}
