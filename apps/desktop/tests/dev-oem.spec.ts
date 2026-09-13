/** Regression checks for OEM identity in the desktop development launcher. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DEV_LAUNCHER = fileURLToPath(new URL('../scripts/dev.ts', import.meta.url))

describe('desktop OEM development build', () => {
  const launcher = readFileSync(DEV_LAUNCHER, 'utf8')

  it('reads the native development process name from the root OEM config', () => {
    expect(launcher).toContain('updateUrl: DESKTOP_UPDATE_URL } = readDesktopOemConfig(repoRoot)')
    expect(launcher).toContain('syncDesktopOemIcons(repoRoot, root)')
    expect(launcher).toContain('DSH_DESKTOP_UPDATE_URL: DESKTOP_UPDATE_URL')
    expect(launcher).not.toContain("const DESKTOP_PRODUCT_NAME = '深度Works'")
  })

  it('rebuilds client bundles before Vite consumes their compiled output', () => {
    // The emit refresh must cover every client package: tsdown bundles from
    // the lib/types emit, so a package the tsc step misses silently ships its
    // previous bundle.
    const clientTypeBuild = launcher.indexOf('...discoverPluginDirs(repoRoot)')
    const clientBundleBuild = launcher.indexOf("'--env.DSH_BUILD_FACE', 'client'")
    const viteBuild = launcher.indexOf("'@deepseek-ai/dsh-web-frontend', 'exec', 'vite', 'build'")
    const iconSync = launcher.indexOf('syncDesktopOemIcons(repoRoot, root)')
    expect(clientTypeBuild).toBeGreaterThan(-1)
    expect(launcher).toContain('...discoverLibraryDirs(repoRoot)')
    expect(launcher).toContain("from '../../../scripts/dev-web.ts'")
    expect(clientBundleBuild).toBeGreaterThan(clientTypeBuild)
    expect(viteBuild).toBeGreaterThan(clientBundleBuild)
    expect(iconSync).toBeGreaterThan(viteBuild)
  })
})
