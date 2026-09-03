/**
 * The installed-host base that packaged runtimes anchor preset rows at. A
 * packaged runtime has no `node_modules` above its writable composition
 * directory, so discovery and the mount must resolve bare package names from
 * the application archive root; every open layout keeps the composition base.
 */

import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { installedHostBase } from '@deepseek-ai/dsh-agent-presets'

/** The app-root prefix of the running platform ('C:' or ''). */
const appRoot = process.platform === 'win32' ? 'C:' : sep

describe('the installed-host base of a packaged runtime', () => {
  it('returns the archive root for a module inside app.asar', () => {
    const moduleDir = join(appRoot, 'apps', 'resources', 'app.asar', 'node_modules', '@deepseek-ai', 'dsh-agent-presets', 'lib')

    // The archive root, where the packaged plugin `node_modules` lives — the
    // same base `boot()` hands the Loader for bare imports.
    expect(installedHostBase(moduleDir))
      .toBe(pathToFileURL(join(appRoot, 'apps', 'resources', 'app.asar') + sep).href)
  })

  it('refuses an app.asar.unpacked twin, whose name only starts with the archive', () => {
    const moduleDir = join(appRoot, 'apps', 'resources', 'app.asar.unpacked', 'node_modules', 'koffi')

    expect(installedHostBase(moduleDir)).toBeUndefined()
  })

  it('returns undefined for every open layout', () => {
    expect(installedHostBase(join(appRoot, 'checkout', 'packages', 'preset', 'agent-presets', 'lib'))).toBeUndefined()
  })
})
