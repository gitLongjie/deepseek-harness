// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, NS } from '../src/client/index.ts'
import { MarketSettingsTab } from '../src/client/MarketSettingsTab.tsx'
import type { MarketSettingsTabInjected } from '../src/client/MarketSettingsTab.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

type RemoteStub = {
  listSources: ReturnType<typeof vi.fn>
  selectedSource: ReturnType<typeof vi.fn>
  selectSource: ReturnType<typeof vi.fn>
  browse: ReturnType<typeof vi.fn>
  installability: ReturnType<typeof vi.fn>
  install: ReturnType<typeof vi.fn>
  installed: ReturnType<typeof vi.fn>
  uninstall: ReturnType<typeof vi.fn>
}

function stub(): RemoteStub {
  return {
    listSources: vi.fn(async () => ({ ok: true, value: { sources: [] } })),
    selectedSource: vi.fn(async () => ({ ok: true, value: { sourceId: 'src-1' } })),
    selectSource: vi.fn(async () => ({ ok: true, value: undefined })),
    browse: vi.fn(async () => ({ ok: true, value: { entries: [], nextCursor: null, total: null } })),
    installability: vi.fn(async () => ({ ok: true, value: { installable: false, npmPackage: null, resolvedVersion: null, reasons: [] } })),
    install: vi.fn(async () => ({ ok: true, value: { ok: false, message: 'denied', outputTail: null } })),
    installed: vi.fn(async () => ({ ok: true, value: { plugins: [] } })),
    uninstall: vi.fn(async () => ({ ok: true, value: { ok: true, packageName: 'p', restartRequired: true } })),
  }
}

async function bench(remote: RemoteStub) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  ctx.provide('remote.market', remote)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-market browser plugin', () => {
  it('declares only the services used by the Settings market contribution', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.market'])
  })

  it('registers a localized tab without reading the Remote eagerly', async () => {
    const remote = stub()
    const b = await bench(remote)
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('settings.plugins.tab')[0]!
    expect(entry.component).toBe(MarketSettingsTab)
    expect(entry.options).toMatchObject({ id: 'market', order: 20 })
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe('插件市场')
    expect(remote.browse).not.toHaveBeenCalled()

    const injected = (entry.inject as unknown as () => MarketSettingsTabInjected)()
    await expect(injected.selectedSource()).resolves.toBe('src-1')
    expect(remote.selectedSource).toHaveBeenCalledOnce()
    await expect(injected.browse({ limit: 50 })).resolves.toEqual({ entries: [], nextCursor: null, total: null })
    expect(remote.browse).toHaveBeenCalledWith({ query: { limit: 50 } })
    await expect(injected.selectSource('src-2')).resolves.toBeUndefined()
    expect(remote.selectSource).toHaveBeenCalledWith({ sourceId: 'src-2' })
    await b.ctx.fiber.dispose()
  })

  it('surfaces Remote failures as rejected injected calls', async () => {
    const remote = stub()
    remote.selectedSource.mockResolvedValueOnce({ ok: false, error: { code: 'REMOTE_ERROR', message: 'unavailable' } })
    const b = await bench(remote)
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const injected = (b.slots.entries('settings.plugins.tab')[0]!.inject as unknown as () => MarketSettingsTabInjected)()
    await expect(injected.selectedSource()).rejects.toThrow('market.selectedSource failed: REMOTE_ERROR: unavailable')
    await b.ctx.fiber.dispose()
  })

  it('follows locale and recovers across late declaration and declarer reload', async () => {
    const b = await bench(stub())
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.plugins.tab')).toHaveLength(1) })
    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.plugins.tab')[0]!.options.label)).toBe('Marketplace')

    stop()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('settings.plugins.tab')[0]?.component).toBe(MarketSettingsTab)
    })

    await fiber.dispose()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    expect(() => b.locale.register(NS, 'zh', {})).not.toThrow()
    await b.ctx.fiber.dispose()
  })
})
