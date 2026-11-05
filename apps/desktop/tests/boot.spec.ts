/** Unit tests for the desktop boot helpers. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  createDesktopProfileContext,
  ensureRootPluginLinks,
  healsSharedModuleFallback,
  resolveDevAnalyticsPatches,
  resolveMarketAnchorPatch,
  resolveOptionalBundlePatch,
  resolveTelemetryPatch,
} from '../src/main/boot.ts'

describe('createDesktopProfileContext', () => {
  it('names the desktop surface while retaining the loaded profile locations', () => {
    const profile = {
      name: 'web',
      dir: 'C:/profiles/web',
      patchPath: 'C:/profiles/web/cordis.patch.yml',
      layers: [{
        packageName: '@deepseek-ai/dsh-base',
        packageDir: 'C:/profiles/web/node_modules/@deepseek-ai/dsh-base',
        patchPaths: ['C:/profiles/web/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml'],
        patches: [],
      }],
      patches: [],
      skippedBundles: [],
    }
    const overlays = [{ id: 'webserver', config: { port: 0 } }]
    expect(createDesktopProfileContext(profile, overlays)).toMatchObject({
      name: 'desktop',
      dir: profile.dir,
      patchPath: profile.patchPath,
      startedBundles: ['@deepseek-ai/dsh-base'],
      overlays,
    })
  })
})

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

describe('resolveDevAnalyticsPatches', () => {
  it('returns no patches outside the development switch', () => {
    expect(resolveDevAnalyticsPatches(undefined)).toEqual([])
    expect(resolveDevAnalyticsPatches('')).toEqual([])
    expect(resolveDevAnalyticsPatches('0')).toEqual([])
  })

  it('disables both product analytics rows in development', () => {
    expect(resolveDevAnalyticsPatches('1')).toEqual([
      { id: 'desktop-product-telemetry', disabled: true },
      { id: 'product-analytics', disabled: true },
    ])
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
    const subagentDir = fileURLToPath(new URL('../../../packages/subagent/subagent', import.meta.url))
    const dirs = { rootAi, profilesAi, installAnchor, profilesModules: join(mkdtempSync(join(tmpdir(), 'dsh-desktop-farm-')), 'absent') }
    ensureRootPluginLinks(dirs)

    const subagentLink = join(rootAi, 'dsh-subagent')
    expect(realpathSync.native(subagentLink)).toBe(realpathSync.native(subagentDir))
    expect(readlinkSync(join(rootAi, 'dsh-profile-only'))).toBe(join(profilesAi, 'dsh-profile-only'))

    // Idempotent: a second pass keeps every link it wrote.
    ensureRootPluginLinks(dirs)
    expect(realpathSync.native(subagentLink)).toBe(realpathSync.native(subagentDir))
    expect(existsSync(join(rootAi, 'dsh-profile-only'))).toBe(true)
  })

  it('mirrors the web profile farm\'s third-party plugin packages at their own node_modules locations', () => {
    const rootAi = join(mkdtempSync(join(tmpdir(), 'dsh-desktop-links-')), '@deepseek-ai')
    mkdirSync(rootAi, { recursive: true })
    const rootModules = dirname(rootAi)
    const farm = mkdtempSync(join(tmpdir(), 'dsh-desktop-farm-'))
    // A qualifying package: its manifest declares dsh.bundle.
    const plugin = join(farm, 'dsh-wechat')
    mkdirSync(plugin, { recursive: true })
    writeFileSync(join(plugin, 'package.json'), JSON.stringify({ name: 'dsh-wechat', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
    const scoped = join(farm, '@xmanrui', 'dsh-im')
    mkdirSync(scoped, { recursive: true })
    writeFileSync(join(scoped, 'package.json'), JSON.stringify({ name: '@xmanrui/dsh-im', dsh: { bundle: {} } }))
    // A farm library without dsh.bundle stays out, as does the @deepseek-ai
    // scope (the profilesAi mirror owns it).
    const plain = join(farm, 'plain-lib')
    mkdirSync(plain, { recursive: true })
    writeFileSync(join(plain, 'package.json'), JSON.stringify({ name: 'plain-lib' }))
    const ownScoped = join(farm, '@deepseek-ai', 'dsh-elsewhere')
    mkdirSync(ownScoped, { recursive: true })
    writeFileSync(join(ownScoped, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-elsewhere', dsh: { bundle: {} } }))

    const installAnchor = fileURLToPath(new URL('../package.json', import.meta.url))
    const dirs = { rootAi, profilesAi: join(mkdtempSync(join(tmpdir(), 'dsh-desktop-shared-')), 'absent'), installAnchor, profilesModules: farm, rootModules }
    ensureRootPluginLinks(dirs)

    expect(realpathSync.native(join(rootModules, 'dsh-wechat'))).toBe(realpathSync.native(plugin))
    expect(realpathSync.native(join(rootModules, '@xmanrui', 'dsh-im'))).toBe(realpathSync.native(scoped))
    expect(existsSync(join(rootModules, 'plain-lib'))).toBe(false)
    expect(existsSync(join(rootModules, '@deepseek-ai', 'dsh-elsewhere'))).toBe(false)

    // Idempotent: a second pass keeps every link it wrote.
    ensureRootPluginLinks(dirs)
    expect(realpathSync.native(join(rootModules, 'dsh-wechat'))).toBe(realpathSync.native(plugin))
  })
})

describe('healsSharedModuleFallback', () => {
  it('heals a boot with no bare-module base', () => {
    expect(healsSharedModuleFallback(undefined)).toBe(true)
  })

  it('heals the branded dev executable, whose checkout base is a real directory', () => {
    // The branded dev exe reports app.isPackaged and receives a bare base, but
    // its roster resolves through the shared farm, so it must keep healing.
    expect(healsSharedModuleFallback('file:///E:/checkout/apps/desktop/')).toBe(true)
  })

  it('skips the closed archive the installed build runs from', () => {
    expect(healsSharedModuleFallback('file:///C:/app/resources/app.asar/')).toBe(false)
  })

  it('treats an app.asar.unpacked twin as the open tree it is', () => {
    expect(healsSharedModuleFallback('file:///C:/app/resources/app.asar.unpacked/')).toBe(true)
  })
})

describe('main entry ordering', () => {
  it('invokes main() only after the module state its failure path reads', () => {
    // main() runs synchronously up to its first await, and its packaged-resource
    // guard reads these bindings before any await. Invoking it above them throws
    // "Cannot access 'currentLocale' before initialization" and hides the real
    // startup failure behind a ReferenceError.
    const source = readFileSync(fileURLToPath(new URL('../src/main/index.ts', import.meta.url)), 'utf8')
    const entry = source.indexOf('void main()')
    expect(entry).toBeGreaterThan(-1)
    for (const declaration of ['let currentLocale', 'const host:', 'const RESOURCE_LABEL_KEYS']) {
      expect(source.indexOf(declaration), declaration).toBeLessThan(entry)
    }
  })
})
