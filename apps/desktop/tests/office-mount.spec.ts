/** Unit tests for in-process Desktop Office path resolution. */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveBundledSkillDir, resolveDesktopOfficePaths, usePackagedOfficeLayout } from '../src/main/desktop/office.ts'

describe('resolveBundledSkillDir', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('copies the shipped dashi-ppt skill into the Harness home for an installed launch', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-dashi-'))
    vi.stubEnv('DSH_HOME', root)
    vi.stubEnv('DSH_DESKTOP_DEV', '')
    const resourcesPath = join(root, 'resources')
    mkdirSync(join(resourcesPath, 'runtime', 'primary-runtime'), { recursive: true })
    mkdirSync(join(resourcesPath, 'runtime', 'bundled-skills', 'dashi-ppt'), { recursive: true })
    writeFileSync(join(resourcesPath, 'runtime', 'bundled-skills', 'dashi-ppt', 'SKILL.md'), '---\nname: dashi-ppt\n---\n')
    const resolved = resolveBundledSkillDir({
      packaged: true,
      resourcesPath,
      appPath: join(resourcesPath, 'app.asar'),
    })
    expect(resolved).toBe(join(root, 'bundled-skills'))
    expect(readFileSync(join(root, 'bundled-skills', 'dashi-ppt', 'SKILL.md'), 'utf8')).toContain('dashi-ppt')
  })
})

describe('resolveDesktopOfficePaths', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('prefers packaged resources/runtime for installed product launches', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-office-packaged-'))
    vi.stubEnv('DSH_HOME', root)
    vi.stubEnv('DSH_DESKTOP_DEV', '')
    const resourcesPath = join(root, 'resources')
    const source = join(resourcesPath, 'runtime', 'primary-runtime')
    mkdirSync(join(resourcesPath, 'runtime', 'office-skills'), { recursive: true })
    mkdirSync(source, { recursive: true })
    writeFileSync(join(source, 'runtime.json'), '{}')
    const appPath = join(resourcesPath, 'app.asar')
    mkdirSync(join(appPath, 'dsh'), { recursive: true })

    expect(usePackagedOfficeLayout(true, undefined)).toBe(true)
    expect(resolveDesktopOfficePaths({
      packaged: true,
      resourcesPath,
      appPath,
    })).toEqual({
      source,
      root: join(root, 'dsh-runtimes', 'dsh-primary-runtime'),
      runtimeDir: join(appPath, 'dsh'),
      skillsAvailable: true,
    })
  })

  it('ignores app.isPackaged under DSH_DESKTOP_DEV and uses the checkout override', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-office-dev-'))
    vi.stubEnv('DSH_HOME', root)
    vi.stubEnv('DSH_DESKTOP_DEV', '1')
    const source = join(root, 'payload', 'primary-runtime')
    mkdirSync(join(root, 'payload', 'office-skills'), { recursive: true })
    mkdirSync(source, { recursive: true })
    writeFileSync(join(source, 'runtime.json'), '{}')
    vi.stubEnv('DSH_DESKTOP_PRIMARY_RUNTIME', source)

    expect(usePackagedOfficeLayout(true, '1')).toBe(false)
    expect(resolveDesktopOfficePaths({
      packaged: true,
      resourcesPath: join(root, 'electron-dist', 'resources'),
      appPath: join(root, 'electron-dist', 'resources', 'app.asar'),
    })).toEqual({
      source,
      root: join(root, 'dsh-runtimes', 'dsh-primary-runtime'),
      runtimeDir: source,
      skillsAvailable: true,
    })
  })

  it('honors DSH_DESKTOP_PRIMARY_RUNTIME for unpackaged launches', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-office-override-'))
    vi.stubEnv('DSH_HOME', root)
    vi.stubEnv('DSH_DESKTOP_DEV', '')
    const source = join(root, 'payload', 'primary-runtime')
    mkdirSync(join(root, 'payload', 'office-skills'), { recursive: true })
    mkdirSync(source, { recursive: true })
    writeFileSync(join(source, 'runtime.json'), '{}')
    vi.stubEnv('DSH_DESKTOP_PRIMARY_RUNTIME', source)

    expect(resolveDesktopOfficePaths({
      packaged: false,
      resourcesPath: join(root, 'missing-resources'),
      appPath: join(root, 'missing-app'),
    })).toEqual({
      source,
      root: join(root, 'dsh-runtimes', 'dsh-primary-runtime'),
      runtimeDir: source,
      skillsAvailable: true,
    })
  })
})
