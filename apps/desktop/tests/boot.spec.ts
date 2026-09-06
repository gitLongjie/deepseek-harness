/** Unit tests for the desktop boot helpers. */
import { existsSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveInstallationModuleLinks } from '@deepseek-ai/dsh-app-boot'
import { ensureRootPluginLinks, resolveTelemetryPatch } from '../src/main/boot.ts'

describe('resolveTelemetryPatch', () => {
  it('returns undefined when the switch is unset or the row is absent', () => {
    expect(resolveTelemetryPatch(undefined, true)).toBeUndefined()
    expect(resolveTelemetryPatch('', true)).toBeUndefined()
    expect(resolveTelemetryPatch('1', false)).toBeUndefined()
  })

  it('disables the telemetry row for any non-empty value', () => {
    expect(resolveTelemetryPatch('0', true)).toEqual({ id: 'session-telemetry-otel', disabled: true })
    expect(resolveTelemetryPatch('1', true)).toEqual({ id: 'session-telemetry-otel', disabled: true })
    expect(resolveTelemetryPatch('false', true)).toEqual({ id: 'session-telemetry-otel', disabled: true })
  })
})

describe('ensureRootPluginLinks', () => {
  it('points closure packages at the running installation and refreshes stale links', () => {
    // The root directory is one package scope, as node_modules/@deepseek-ai is.
    const rootAi = join(mkdtempSync(join(tmpdir(), 'dsh-desktop-links-')), '@deepseek-ai')
    mkdirSync(rootAi, { recursive: true })
    const profilesAi = mkdtempSync(join(tmpdir(), 'dsh-desktop-shared-'))
    // The previous mirror behavior left a link that follows the shared
    // fallback directory; a direct target must replace it.
    symlinkSync(join(profilesAi, 'dsh-subagent'), join(rootAi, 'dsh-subagent'), 'junction')
    // A name outside the installation closure keeps the shared-dir mirror.
    mkdirSync(join(profilesAi, 'dsh-profile-only'), { recursive: true })
    writeFileSync(join(profilesAi, 'dsh-profile-only', 'package.json'), '{}')

    const installAnchor = fileURLToPath(new URL('../package.json', import.meta.url))
    const closure = resolveInstallationModuleLinks(installAnchor)
    ensureRootPluginLinks({ rootAi, profilesAi, installAnchor })

    const subagentLink = join(rootAi, 'dsh-subagent')
    expect(realpathSync.native(subagentLink))
      .toBe(realpathSync.native(closure.get('@deepseek-ai/dsh-subagent')!))
    expect(readlinkSync(join(rootAi, 'dsh-profile-only'))).toBe(join(profilesAi, 'dsh-profile-only'))

    // Idempotent: a second pass keeps every link it wrote.
    ensureRootPluginLinks({ rootAi, profilesAi, installAnchor })
    expect(realpathSync.native(subagentLink))
      .toBe(realpathSync.native(closure.get('@deepseek-ai/dsh-subagent')!))
    expect(existsSync(join(rootAi, 'dsh-profile-only'))).toBe(true)
  })
})
