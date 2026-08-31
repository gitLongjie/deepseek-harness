/** Regression checks for the native identity shipped by electron-builder. */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createElectronBuilderOemConfig,
  readDesktopOemConfig,
  syncDesktopOemIcons,
} from '../scripts/desktop-oem-config.mjs'

const BUILDER_CONFIG = fileURLToPath(new URL('../electron-builder.yml', import.meta.url))
const DEV_LAUNCHER = fileURLToPath(new URL('../scripts/dev.ts', import.meta.url))
const DEPLOY_LAUNCHER = fileURLToPath(new URL('../scripts/deploy-app.mjs', import.meta.url))
const RENDER_ENTRY = fileURLToPath(new URL('../src/render/entry.ts', import.meta.url))
const UPDATER = fileURLToPath(new URL('../src/main/updater.ts', import.meta.url))
const DESKTOP_MANIFEST = fileURLToPath(new URL('../package.json', import.meta.url))
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('desktop builder identity', () => {
  const config = readFileSync(BUILDER_CONFIG, 'utf8')

  it('ships the product name used by the native shell', () => {
    expect(config).toMatch(/^appId:\s*ai\.deepseek\.works\s*$/m)
    expect(config).not.toMatch(/^productName:/m)
    expect(config).not.toContain('深度Works')
  })

  it('pins the application icon instead of Electron default artwork', () => {
    expect(config).toMatch(/^icon:\s*build\/icon\.png\s*$/m)
    expect(config).toMatch(/^\s+icon:\s*build\/icon\.ico\s*$/m)
    expect(config).not.toContain('executableName: 深度Works')
  })

  it('gives Windows and macOS release assets stable architecture-specific names', () => {
    expect(config).toMatch(
      /^nsis:\s*$[\s\S]*?^\s+artifactName:\s+deepagens-works-\$\{version\}-win-\$\{arch\}\.\$\{ext\}\s*$/m,
    )
    expect(config).toMatch(
      /^mac:\s*$[\s\S]*?^\s+artifactName:\s+deepagens-works-\$\{version\}-mac-\$\{arch\}\.\$\{ext\}\s*$/m,
    )
    expect(config).not.toContain('${productName}-${version}')
  })

  it('brands the Windows development executable used by Task Manager', () => {
    const launcher = readFileSync(DEV_LAUNCHER, 'utf8')
    expect(launcher).toContain('syncDesktopOemIcons(repoRoot, root)')
    expect(launcher).toContain('NtExecutable.from(readFileSync(electronExecutable))')
    expect(launcher).toContain("resolve(root, 'build', 'icon.ico')")
    expect(launcher).toContain('replaceIconsForResource')
    expect(launcher).toContain('version.setProductVersion(desktopVersion)')
    expect(launcher).toContain('version.setFileVersion(desktopVersion)')
    expect(launcher).toContain('FileDescription: DESKTOP_PRODUCT_NAME')
    expect(launcher).toContain('writeFileSync(brandedExecutable, Buffer.from(executable.generate()))')
    expect(launcher).toContain('DSH_DESKTOP_PRODUCT_NAME: DESKTOP_PRODUCT_NAME')
    expect(launcher).not.toContain('spawn(\'cmd.exe\', [\'/c\', \'pnpm\', \'exec\', \'electron\'')
  })

  it('projects the OEM product name into electron-builder', () => {
    const launcher = readFileSync(DEPLOY_LAUNCHER, 'utf8')
    expect(launcher).toContain('readDesktopOemConfig(repoRoot)')
    expect(launcher).toContain('syncDesktopOemIcons(repoRoot, root)')
    expect(launcher.indexOf('syncDesktopOemIcons(repoRoot, root)'))
      .toBeGreaterThan(launcher.lastIndexOf("'vite', 'build'"))
    expect(launcher).toContain('createElectronBuilderOemConfig(productName, updateUrl, {')
    expect(launcher).toContain('allowLoopbackHttp: localUpdateTest')
    expect(launcher).toContain('localUpdateFeed: localUpdateTest')
    expect(launcher).toContain('output: process.env.DSH_DESKTOP_LOCAL_UPDATE_OUTPUT')
    expect(launcher).toContain('version: process.env.DSH_DESKTOP_BUILD_VERSION')
    expect(launcher).toContain("else ebArgs.push('--publish', 'never')")
    expect(createElectronBuilderOemConfig(
      '深度Worker',
      'https://updates.example.test/desktop',
    )).toEqual({
      extends: 'electron-builder.yml',
      productName: '深度Worker',
      extraMetadata: {
        dsh: { updateUrl: 'https://updates.example.test/desktop' },
      },
    })
    expect(() => createElectronBuilderOemConfig('../Worker')).toThrow(/Windows filename/)
    expect(() => createElectronBuilderOemConfig('Worker', 'http://updates.example.test'))
      .toThrow(/updateUrl/)
    expect(createElectronBuilderOemConfig('Worker', 'http://127.0.0.1:43119', {
      allowLoopbackHttp: true,
      localUpdateFeed: true,
      output: 'C:/local-update/feed',
      version: '1.2.4',
    })).toMatchObject({
      directories: { output: 'C:/local-update/feed' },
      extraMetadata: {
        version: '1.2.4',
        dsh: { updateUrl: 'http://127.0.0.1:43119', localUpdateTest: true },
      },
      publish: [{ provider: 'generic', url: 'http://127.0.0.1:43119' }],
    })
    expect(() => createElectronBuilderOemConfig('Worker', 'http://updates.example.test', {
      allowLoopbackHttp: true,
    })).toThrow(/updateUrl/)
  })

  it('projects one configured Web icon into both native desktop icon files', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'dsh-oem-repo-'))
    const desktopRoot = join(repoRoot, 'apps', 'desktop')
    roots.push(repoRoot)
    mkdirSync(join(repoRoot, 'apps', 'web', 'public', 'brand'), { recursive: true })
    writeFileSync(join(repoRoot, 'oem.config.json'), JSON.stringify({
      productName: 'Acme Agent',
      brandIcon: '/brand/acme.ico',
      updateUrl: 'https://updates.acme.test/desktop',
    }))
    const icon = Buffer.from([0, 0, 1, 0, 1, 0, 42])
    writeFileSync(join(repoRoot, 'apps', 'web', 'public', 'brand', 'acme.ico'), icon)

    expect(readDesktopOemConfig(repoRoot, {})).toEqual({
      productName: 'Acme Agent',
      brandIcon: '/brand/acme.ico',
      updateUrl: 'https://updates.acme.test/desktop',
    })
    syncDesktopOemIcons(repoRoot, desktopRoot)
    expect(readFileSync(join(desktopRoot, 'build', 'icon.ico'))).toEqual(icon)
    expect(readFileSync(join(desktopRoot, 'build', 'tray.ico'))).toEqual(icon)

    const override = Buffer.from([0, 0, 1, 0, 2, 0, 84])
    writeFileSync(join(repoRoot, 'apps', 'web', 'public', 'brand', 'override.ico'), override)
    syncDesktopOemIcons(repoRoot, desktopRoot, { DSH_CLIENT_BRAND_ICON: '/brand/override.ico' })
    expect(readFileSync(join(desktopRoot, 'build', 'icon.ico'))).toEqual(override)
    expect(readFileSync(join(desktopRoot, 'build', 'tray.ico'))).toEqual(override)
  })

  it('rejects native icon overrides that are remote or not ICO data', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'dsh-oem-invalid-'))
    const desktopRoot = join(repoRoot, 'apps', 'desktop')
    roots.push(repoRoot)
    mkdirSync(join(repoRoot, 'apps', 'web', 'public'), { recursive: true })
    writeFileSync(join(repoRoot, 'oem.config.json'), JSON.stringify({
      productName: 'Acme Agent',
      brandIcon: '/invalid.ico',
      updateUrl: 'https://updates.acme.test/desktop',
    }))
    writeFileSync(join(repoRoot, 'apps', 'web', 'public', 'invalid.ico'), 'not an icon')

    expect(() => readDesktopOemConfig(repoRoot, {
      DSH_CLIENT_BRAND_ICON: 'https://cdn.acme.test/icon.ico',
    })).toThrow(/local/)
    expect(() => syncDesktopOemIcons(repoRoot, desktopRoot, {})).toThrow(/valid ICO/)
  })

  it('takes the custom title-bar mark from the OEM-projected document favicon', () => {
    const entry = readFileSync(RENDER_ENTRY, 'utf8')
    expect(entry).toContain("querySelector<HTMLLinkElement>('link[rel~=\"icon\"]')")
    expect(entry).not.toContain("installTitleBar(document, ipc, './favicon.ico')")
  })

  it('configures electron-updater from the OEM update URL before checking', () => {
    const updater = readFileSync(UPDATER, 'utf8')
    expect(updater).toContain('autoUpdater.setFeedURL({')
    expect(updater).toContain('url: updateUrl')
    expect(updater).toContain('channel: resolveUpdateChannel(app.getVersion())')
    expect(updater.indexOf('autoUpdater.setFeedURL'))
      .toBeLessThan(updater.indexOf('autoUpdater.checkForUpdates'))
  })

  it('declares runtime-only packages required by the shipped plugin tree', () => {
    const manifest = JSON.parse(readFileSync(DESKTOP_MANIFEST, 'utf8')) as {
      dependencies?: Record<string, string>
    }
    expect(manifest.dependencies).toMatchObject({
      '@deepseek-ai/dsh-attachment': 'workspace:^',
      '@deepseek-ai/dsh-credentials': 'workspace:^',
      '@deepseek-ai/dsh-jobs': 'workspace:^',
      '@deepseek-ai/dsh-session-persistence': 'workspace:^',
      '@deepseek-ai/dsh-session-query': 'workspace:^',
      '@deepseek-ai/dsh-settings': 'workspace:^',
      '@xmanrui/dsh-im': 'file:../../dsh-im/dsh-im-main',
    })
  })
})
