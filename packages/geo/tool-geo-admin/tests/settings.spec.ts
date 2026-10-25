/**
 * The `./settings` host entry: it owns the `geo-admin` settings namespace and
 * publishes the live view the preset-mounted publishing tools read.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import * as settingsPlugin from '../src/settings.ts'
import { GEO_ADMIN_PASSWORD_REF, GEO_ADMIN_SETTINGS_NAMESPACE } from '../src/settings.ts'
import type { GeoAdminSettingsSection } from '../src/settings.ts'

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
async function boot(base: GeoAdminSettingsSection = {}): Promise<Context> {
  const ctx = new Context()
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  const pluginFiber = ctx.plugin(settingsPlugin, base)
  await pluginFiber.await()
  return ctx
}

describe('the geo-admin settings host entry', () => {
  it('names the publishing tools credential reference', () => {
    expect(GEO_ADMIN_SETTINGS_NAMESPACE).toBe('geo-admin')
    expect(GEO_ADMIN_PASSWORD_REF).toBe('GEO_ADMIN_PASSWORD')
  })

  it('publishes a view reading the composition base', async () => {
    const ctx = await boot({ baseUrl: 'http://localhost:8001', username: 'article-bot' })
    expect(ctx.geoAdminSettings.get()).toEqual({ baseUrl: 'http://localhost:8001', username: 'article-bot' })
    await ctx.fiber.dispose()
  })

  it('reflects committed user edits into the view and its watchers', async () => {
    const ctx = await boot()
    const seen: GeoAdminSettingsSection[] = []
    const stop = ctx.geoAdminSettings.watch((next) => { seen.push(next) })
    await ctx.settings.update(GEO_ADMIN_SETTINGS_NAMESPACE, { username: 'editor' })
    expect(ctx.geoAdminSettings.get().username).toBe('editor')
    expect(seen.at(-1)?.username).toBe('editor')
    stop()
    await ctx.settings.update(GEO_ADMIN_SETTINGS_NAMESPACE, { username: 'editor-2' })
    expect(seen.at(-1)?.username).toBe('editor')
    await ctx.fiber.dispose()
  })

  it('rejects a second registration of the namespace', async () => {
    const ctx = await boot()
    expect(() => ctx.settings.register(GEO_ADMIN_SETTINGS_NAMESPACE, { ...settingsPlugin.GeoAdminSettingsSchema } as never))
      .toThrow(/already registered/)
    await ctx.fiber.dispose()
  })
})
