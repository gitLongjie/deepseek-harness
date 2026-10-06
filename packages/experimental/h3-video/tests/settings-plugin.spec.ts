/**
 * The `./settings` host entry: it owns the `h3-video` settings namespace and
 * publishes the live view a mounted H3 service consumes.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import * as settingsPlugin from '../src/settings.ts'
import { H3_VIDEO_SETTINGS_NAMESPACE, type H3VideoSettingsSection } from '../src/settings.ts'

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

/** Boot one context with the settings provider and the host entry mounted. */
async function boot(base: H3VideoSettingsSection = {}): Promise<Context> {
  const ctx = new Context()
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  // The namespace-object plugin boundary types config as a plain record; the
  // section narrows on the apply side, so the fixture crosses with a cast.
  const pluginFiber = ctx.plugin(settingsPlugin, base as unknown as Record<string, unknown>)
  await pluginFiber.await()
  return ctx
}

describe('the h3-video settings host entry', () => {
  it('publishes a view reading the composition base', async () => {
    const ctx = await boot({ comfyUrl: 'http://127.0.0.1:8188' })
    expect(ctx.h3VideoSettings.get().comfyUrl).toBe('http://127.0.0.1:8188')
    await ctx.fiber.dispose()
  })

  it('reflects committed user edits into the view and its watchers', async () => {
    const ctx = await boot()
    const seen: H3VideoSettingsSection[] = []
    const stop = ctx.h3VideoSettings.watch((next) => { seen.push(next) })
    await ctx.settings.update(H3_VIDEO_SETTINGS_NAMESPACE, { comfyUrl: 'http://10.0.0.2:8188' })
    expect(ctx.h3VideoSettings.get().comfyUrl).toBe('http://10.0.0.2:8188')
    expect(seen.at(-1)?.comfyUrl).toBe('http://10.0.0.2:8188')
    stop()
    await ctx.fiber.dispose()
  })

  it('rejects a second registration of the namespace', async () => {
    const ctx = await boot()
    expect(() => ctx.settings.register(H3_VIDEO_SETTINGS_NAMESPACE, { ...settingsPlugin.H3VideoSettingsSchema } as never))
      .toThrow(/already registered/)
    await ctx.fiber.dispose()
  })
})
