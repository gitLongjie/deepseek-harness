/** Unit tests for the desktop boot helpers. */
import { existsSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveInstallationModuleLinks } from '@deepseek-ai/dsh-app-boot'
import { ensureRootPluginLinks, resolveMarketAnchorPatch, resolveOptionalBundlePatch, resolveTelemetryPatch } from '../src/main/boot.ts'

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

describe('resolveMarketAnchorPatch', () => {
  it('returns undefined when the composition has no market-local row', () => {
    expect(resolveMarketAnchorPatch(false, 'C:/app/package.json')).toBeUndefined()
  })

  it('hands the boot anchor to the market-local row', () => {
    expect(resolveMarketAnchorPatch(true, 'C:/app/package.json'))
      .toEqual({ id: 'market-local', config: { installAnchor: 'C:/app/package.json' } })
  })
})

describe('resolveOptionalBundlePatch', () => {
  /** Create an install anchor directory with an optional bundle package inside it. */
  function installAnchorWith(bundle: { manifest: object; patch?: string }): string {
    const anchorDir = mkdtempSync(join(tmpdir(), 'dsh-desktop-bundle-'))
    writeFileSync(join(anchorDir, 'package.json'), '{}')
    const packageDir = join(anchorDir, 'node_modules', '@xmanrui', 'dsh-business-entry')
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify(bundle.manifest))
    if (bundle.patch !== undefined) writeFileSync(join(packageDir, 'cordis.patch.yml'), bundle.patch)
    return join(anchorDir, 'package.json')
  }

  const DECLARED = { name: '@xmanrui/dsh-business-entry', dsh: { bundle: { patch: './cordis.patch.yml' } } }
  const PATCH = '- insert:\n    - id: xmanrui-dsh-business-entry\n      name: \'@xmanrui/dsh-business-entry\'\n'

  it('loads the declared patch of an installed bundle', () => {
    const anchor = installAnchorWith({ manifest: DECLARED, patch: PATCH })
    expect(resolveOptionalBundlePatch(anchor, '@xmanrui/dsh-business-entry', []))
      .toEqual([{ insert: [{ id: 'xmanrui-dsh-business-entry', name: '@xmanrui/dsh-business-entry' }] }])
  })

  it('returns undefined when the bundle name resolves nowhere', () => {
    // A name that exists in no node_modules along any resolution path; under
    // vitest the workspace resolver would find a real bundle's name.
    const anchorDir = mkdtempSync(join(tmpdir(), 'dsh-desktop-bundle-'))
    const anchor = join(anchorDir, 'package.json')
    writeFileSync(anchor, '{}')
    expect(resolveOptionalBundlePatch(anchor, '@xmanrui/dsh-no-such-bundle', [])).toBeUndefined()
  })

  it('returns undefined when the installed bundle declares no patch layer', () => {
    const anchor = installAnchorWith({ manifest: { name: '@xmanrui/dsh-business-entry' } })
    expect(resolveOptionalBundlePatch(anchor, '@xmanrui/dsh-business-entry', [])).toBeUndefined()
  })

  it('fails loudly when an installed bundle declares a broken patch layer', () => {
    const anchor = installAnchorWith({ manifest: DECLARED, patch: 'not: an array\n' })
    expect(() => resolveOptionalBundlePatch(anchor, '@xmanrui/dsh-business-entry', [])).toThrow(/must be a top-level YAML array/)
  })

  it('skips the injection when an existing layer disables the same plugin id', () => {
    const anchor = installAnchorWith({ manifest: DECLARED, patch: PATCH })
    expect(resolveOptionalBundlePatch(anchor, '@xmanrui/dsh-business-entry', [{ id: 'xmanrui-dsh-business-entry', disabled: true }]))
      .toBeUndefined()
  })

  it('skips the injection when an existing layer already inserts the same plugin id', () => {
    const anchor = installAnchorWith({ manifest: DECLARED, patch: PATCH })
    const existing = [{ insert: [{ id: 'xmanrui-dsh-business-entry', name: '@xmanrui/dsh-business-entry' }] }]
    expect(resolveOptionalBundlePatch(anchor, '@xmanrui/dsh-business-entry', existing)).toBeUndefined()
  })

  it('injects when existing layers only configure unrelated ids', () => {
    const anchor = installAnchorWith({ manifest: DECLARED, patch: PATCH })
    expect(resolveOptionalBundlePatch(anchor, '@xmanrui/dsh-business-entry', [{ id: 'session-telemetry-otel', disabled: true }]))
      .toEqual([{ insert: [{ id: 'xmanrui-dsh-business-entry', name: '@xmanrui/dsh-business-entry' }] }])
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
