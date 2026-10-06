/**
 * The settings overlay: how a committed `h3-video` section layers over the
 * composition configuration, and how a mounted service rebuilds its providers
 * when the section changes.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import H3VideoService, { resolveOverlayConfig, type Config } from '../src/index.ts'
import type { H3VideoSettingsSection, H3VideoSettingsView } from '../src/settings.ts'

/** A minimal composition configuration enabling only the local backend. */
function baseConfig(overrides: Partial<Config> = {}): Config {
  return {
    comfy: { workflowPath: 'D:/ComfyUI/template.json', url: 'http://127.0.0.1:8188' },
    ...overrides,
  }
}

/**
 * The plugin's static Config schema widens every optional with `null` and
 * narrows `resolutions` to its literal union under `exactOptionalPropertyTypes`;
 * the interface-shaped fixture narrows once, at the plugin boundary only.
 */
function pluginConfig(config: Config): never {
  return config as never
}

describe('resolveOverlayConfig', () => {
  it('keeps the composition untouched for an empty section', () => {
    const base = baseConfig({ outputDir: '/tmp/video' })
    expect(resolveOverlayConfig(base, {})).toEqual(base)
  })

  it('overrides present values and inherits absent ones', () => {
    const effective = resolveOverlayConfig(baseConfig(), {
      comfyUrl: 'http://192.168.1.10:8188',
      minFreeSpaceMb: 2048,
    })
    expect(effective.comfy?.url).toBe('http://192.168.1.10:8188')
    expect(effective.comfy?.workflowPath).toBe('D:/ComfyUI/template.json')
    expect(effective.minFreeSpaceMb).toBe(2048)
  })

  it('treats an empty string as unset', () => {
    const effective = resolveOverlayConfig(baseConfig(), { comfyUrl: '', outputDir: '' })
    expect(effective.comfy?.url).toBe('http://127.0.0.1:8188')
    expect(effective.outputDir).toBeUndefined()
  })

  it('enables the remote backend a composition carries no key for', () => {
    const effective = resolveOverlayConfig(baseConfig(), { minimaxApiKeyRef: 'MINIMAX_API_KEY' })
    expect(effective.minimax?.apiKeyRef).toBe('MINIMAX_API_KEY')
    expect(effective.comfy?.workflowPath).toBe('D:/ComfyUI/template.json')
  })

  it('ignores an empty resolution list', () => {
    const effective = resolveOverlayConfig(baseConfig(), { comfyResolutions: [] })
    expect(effective.comfy?.resolutions).toBeUndefined()
  })
})

/** A controllable view: the value it reports and the watchers it notifies. */
function fakeView(initial: H3VideoSettingsSection): H3VideoSettingsView & { commit(next: H3VideoSettingsSection): void } {
  let current = initial
  const watchers = new Set<(next: H3VideoSettingsSection) => void>()
  return {
    get: () => current,
    watch: (callback) => {
      watchers.add(callback)
      return () => { watchers.delete(callback) }
    },
    commit: (next) => {
      current = next
      for (const watch of watchers) watch(next)
    },
  }
}

describe('the mounted service over a settings view', () => {
  it('serves the overlaid configuration from the first request', async () => {
    const ctx = new Context()
    ctx.provide('h3VideoSettings', fakeView({ comfyUrl: 'http://10.0.0.5:8188' }))
    await ctx.plugin(H3VideoService, pluginConfig(baseConfig()))
    const capabilities = (ctx.h3Video as H3VideoService).capabilities('local')
    expect(capabilities?.resolutions).toEqual(['768P'])
    await ctx.fiber.dispose()
  })

  it('rebuilds providers when the section changes', async () => {
    const ctx = new Context()
    const view = fakeView({})
    ctx.provide('h3VideoSettings', view)
    await ctx.plugin(H3VideoService, pluginConfig(baseConfig()))
    const before = (ctx.h3Video as H3VideoService).capabilities('local')
    expect(before?.maxConcurrency).toBe(1)

    view.commit({ comfyMaxConcurrency: 3 })
    const after = (ctx.h3Video as H3VideoService).capabilities('local')
    expect(after?.maxConcurrency).toBe(3)
    await ctx.fiber.dispose()
  })

  it('rebuilds without disturbing the other backend when one changes', async () => {
    const ctx = new Context()
    const view = fakeView({})
    ctx.provide('h3VideoSettings', view)
    await ctx.plugin(H3VideoService, pluginConfig(baseConfig()))

    // A remote-only overlay: the local backend keeps its composition values.
    view.commit({ minimaxBaseUrl: 'https://api.example.com', minimaxPollIntervalMs: 2_000 })
    const local = (ctx.h3Video as H3VideoService).capabilities('local')
    expect(local?.maxConcurrency).toBe(1)
    await ctx.fiber.dispose()
  })

  it('mounts unchanged without a view', async () => {
    const ctx = new Context()
    await ctx.plugin(H3VideoService, pluginConfig(baseConfig()))
    expect((ctx.h3Video as H3VideoService).capabilities('local')).toBeDefined()
    await ctx.fiber.dispose()
  })
})
