/**
 * The `h3-video` settings section schema, and the settings service that owns
 * page-policy registration. The host entry no longer calls `settings.register`;
 * a loader Config schema is the namespace, and {@link SettingsForms.configure}
 * is the per-instance registration.
 */
import { describe, expect, it } from 'vitest'
import SettingsForms from '@deepseek-ai/dsh-settings'
import { H3_VIDEO_SETTINGS_NAMESPACE, H3VideoSettingsSchema } from '../src/settings.ts'

describe('the h3-video settings schema', () => {
  it('accepts a composition base', () => {
    expect(H3VideoSettingsSchema({ comfyUrl: 'http://127.0.0.1:8188' }).comfyUrl).toBe('http://127.0.0.1:8188')
  })

  it('leaves an omitted field absent', () => {
    expect(H3VideoSettingsSchema({}).comfyUrl).toBeUndefined()
  })

  it('names the settings namespace', () => {
    expect(H3_VIDEO_SETTINGS_NAMESPACE).toBe('h3-video')
  })

  it('registers page policy through configure', () => {
    expect(typeof SettingsForms.prototype.configure).toBe('function')
    expect(Object.hasOwn(SettingsForms.prototype, 'register')).toBe(false)
  })
})
