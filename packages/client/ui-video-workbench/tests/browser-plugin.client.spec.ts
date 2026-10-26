/**
 * ui-video-workbench browser half: the sidebar panel row and the keyed `main`
 * page against the real SlotRegistry. The row's label is the regression this
 * spec owns — a hardcoded English literal leaves the row in English inside a
 * Chinese UI, which reads as a different typeface beside its Chinese
 * neighbours. Fiber teardown proves removal (HMR safety).
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject, PANEL_ID, type VideoWorkbenchInjected } from '../src/client/index.ts'
import { en, NS, zh } from '../src/client/locales.ts'

afterEach(() => { vi.unstubAllGlobals() })

/** The sidebar row's resolved label, read the way the sidebar shell reads it. */
function panelLabel(ctx: Context): string | undefined {
  const entry = ctx.slots.entries('sidebar.panellist').find(({ options }) => options.id === PANEL_ID)
  return resolveSlotLabel(entry?.options.label)
}

/** The registered main page entry for this panel. */
function mainPage(ctx: Context) {
  return ctx.slots.entries('main').find(({ options }) => options.key === PANEL_ID)
}

/** Boot the browser half over a real slot tree declaring the shell's rows. */
async function bench(options: {
  current?: () => SessionId | undefined
  scope?: Context
  selectPanel?: () => void
} = {}): Promise<{ ctx: Context; fiber: ReturnType<Context['plugin']> }> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'sidebar.panellist': { kind: 'list', scope: 'root' },
      'main': { kind: 'keyed', scope: 'root' },
    },
  } as never, () => null)
  // The locale plugin binds a settings scope, which reads the connection handle
  // and the forwarded-event port.
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  // The layout service closes the panel when a shot is handed back to the chat.
  ctx.provide('layout', { selectPanel: options.selectPanel ?? (() => {}) } as never)
  // The sessions service resolves the open Session the request is sent to.
  ctx.provide('sessions', {
    list: { getSnapshot: () => ({ current: options.current?.() }) },
    scope: () => options.scope,
    sessionOf: () => undefined,
  } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber }
}

describe('ui-video-workbench browser half', () => {
  it('hands a combined render back as a complete storyboard draft', async () => {
    const scope = new Context()
    const setDraft = vi.fn()
    scope.provide('conversation', { input: { for: () => ({ setDraft }) } } as never)
    const { ctx, fiber } = await bench({ scope, current: () => SessionId('episode-1') })
    try {
      ctx.locale.setLocale('en')
      const face = mainPage(ctx)!.inject!() as unknown as VideoWorkbenchInjected
      await face.requestRegeneration('vp-1', 'all', 's1: opening\ns2: close', [], '/video')
      expect(setDraft).toHaveBeenCalledOnce()
      expect(setDraft.mock.calls[0]![0]).toContain('complete multi_shot plan')
      expect(setDraft.mock.calls[0]![0]).toContain('s1: opening\ns2: close')
      expect(setDraft.mock.calls[0]![0]).not.toContain('shot all')
    } finally {
      await fiber.dispose()
    }
  })

  it('keeps the draft untouched when the user switches sessions while anchors load', async () => {
    const scope = new Context()
    const setDraft = vi.fn()
    const selectPanel = vi.fn()
    scope.provide('conversation', { input: { for: () => ({ setDraft }) } } as never)
    let current = SessionId('episode-1')
    let finish!: (response: Response) => void
    const response = new Promise<Response>((resolve) => { finish = resolve })
    vi.stubGlobal('fetch', vi.fn(() => response))
    const { ctx, fiber } = await bench({ scope, current: () => current, selectPanel })
    try {
      const face = mainPage(ctx)!.inject!() as unknown as VideoWorkbenchInjected
      const handoff = face.requestRegeneration('vp-1', 's1', 'opening', [
        { name: 'hero', kind: 'character', reference: '/video/assets/hero.png' },
      ], '/video')
      const refused = expect(handoff).rejects.toThrow(/Session changed/u)
      current = SessionId('episode-2')
      finish(new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } }))
      await refused
      expect(setDraft).not.toHaveBeenCalled()
      expect(selectPanel).not.toHaveBeenCalled()
    } finally {
      await fiber.dispose()
    }
  })
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'locale', 'layout', 'sessions'])
  })

  it('labels its sidebar row from the active locale', async () => {
    const { ctx, fiber } = await bench()
    try {
      ctx.locale.setLocale('en')
      expect(panelLabel(ctx)).toBe('Video workbench')
      ctx.locale.setLocale('zh')
      expect(panelLabel(ctx)).toBe('视频工作台')
    } finally {
      await fiber.dispose()
    }
  })

  it('registers the panel row and the keyed main page, and teardown removes both', async () => {
    const { ctx, fiber } = await bench()
    ctx.locale.setLocale('en')
    expect(panelLabel(ctx)).toBeDefined()
    const face = mainPage(ctx)?.inject?.() as unknown as VideoWorkbenchInjected | undefined
    expect(typeof face?.loadSummary).toBe('function')
    expect(ctx.locale.bind(NS)('loadFailed')).toBe(en.loadFailed)

    await fiber.dispose()
    expect(panelLabel(ctx)).toBeUndefined()
    expect(mainPage(ctx)).toBeUndefined()
    // Withdrawn dictionaries leave the key unresolved rather than translated.
    expect(ctx.locale.bind(NS)('loadFailed')).not.toBe(en.loadFailed)
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})
