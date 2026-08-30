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
    const clientTypeBuild = launcher.indexOf("'packages/client/ui-login'")
    const clientBundleBuild = launcher.indexOf("'--env.DSH_BUILD_FACE', 'client'")
    const viteBuild = launcher.indexOf("'@deepseek-ai/dsh-web-frontend', 'exec', 'vite', 'build'")
    const iconSync = launcher.indexOf('syncDesktopOemIcons(repoRoot, root)')
    expect(clientTypeBuild).toBeGreaterThan(-1)
    expect(launcher).toContain("'packages/client/ui-conversation'")
    expect(launcher).toContain("'packages/client/ui-brand-official'")
    expect(launcher).toContain("'packages/client/ui-layout'")
    expect(clientBundleBuild).toBeGreaterThan(clientTypeBuild)
    expect(viteBuild).toBeGreaterThan(clientBundleBuild)
    expect(iconSync).toBeGreaterThan(viteBuild)
  })
})
