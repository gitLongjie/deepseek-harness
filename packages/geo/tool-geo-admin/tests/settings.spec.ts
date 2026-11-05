/** Durable profile configuration consumed by the expert's live service. */
import { readFileSync, rmSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { profileFixture } from './profile-fixture.ts'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { GEO_ADMIN_PASSWORD_REF } from '../src/settings.ts'

describe('geo-admin profile configuration', () => {
  it('exposes editable fields, persists them, and restores them after restart', async () => {
    const fixture = await profileFixture()
    try {
      const form = fixture.ctx.settings.describe().find(row => row.ns === 'geo-admin')
      expect(form).toBeDefined()
      await fixture.ctx.geoAdminSettings.update({ baseUrl: 'http://localhost:8001', username: 'editor' })
      await fixture.ctx.credentials.set(credentialRef(GEO_ADMIN_PASSWORD_REF), 'restart-password')
      expect(fixture.ctx.geoAdminSettings.get()).toEqual({ baseUrl: 'http://localhost:8001', username: 'editor' })
      expect(readFileSync(fixture.profile.patchPath, 'utf8')).toContain('editor')
      expect(readFileSync(fixture.profile.patchPath, 'utf8')).not.toContain('restart-password')
      await fixture.ctx.fiber.dispose()
      const restored = await fixture.start()
      try {
        expect(restored.geoAdminSettings.get()).toEqual({ baseUrl: 'http://localhost:8001', username: 'editor' })
        expect((await restored.credentials.resolve(credentialRef(GEO_ADMIN_PASSWORD_REF)))?.value).toBe('restart-password')
      } finally {
        await restored.fiber.dispose()
      }
    } finally {
      await fixture.ctx.fiber.dispose()
      rmSync(fixture.dir, { recursive: true, force: true })
    }
  })
})
