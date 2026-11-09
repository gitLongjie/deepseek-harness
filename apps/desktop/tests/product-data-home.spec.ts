/** Desktop product data roots stay off the shared Harness and agents defaults. */

import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultAgentsHome, defaultDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  DESKTOP_PRODUCT_DATA_DIR,
  desktopAppDataDir,
  pinDesktopProductDataRoots,
  resolveDesktopProductDataRoots,
} from '../src/main/product-data-home.ts'

const appData = 'D:\\AppData\\Roaming'

describe('resolveDesktopProductDataRoots', () => {
  it('replaces the shared defaults with the DeepWorker directories', () => {
    expect(resolveDesktopProductDataRoots(appData, {})).toEqual({
      home: join(appData, DESKTOP_PRODUCT_DATA_DIR, 'home'),
      agents: join(appData, DESKTOP_PRODUCT_DATA_DIR, 'agents'),
    })
  })

  it('treats a blank or shared-default override as unset', () => {
    expect(resolveDesktopProductDataRoots(appData, { DSH_HOME: '  ', DSH_AGENTS_HOME: '' })).toEqual({
      home: join(appData, DESKTOP_PRODUCT_DATA_DIR, 'home'),
      agents: join(appData, DESKTOP_PRODUCT_DATA_DIR, 'agents'),
    })
    expect(resolveDesktopProductDataRoots(appData, {
      DSH_HOME: defaultDshHome(),
      DSH_AGENTS_HOME: defaultAgentsHome(),
    })).toEqual({
      home: join(appData, DESKTOP_PRODUCT_DATA_DIR, 'home'),
      agents: join(appData, DESKTOP_PRODUCT_DATA_DIR, 'agents'),
    })
  })

  it('keeps an explicit root that is not the shared default', () => {
    const roots = resolveDesktopProductDataRoots(appData, {
      DSH_HOME: 'D:\\custom\\deepworker',
      DSH_AGENTS_HOME: 'D:\\custom\\agents',
    })
    expect(roots).toEqual({
      home: resolve('D:\\custom\\deepworker'),
      agents: resolve('D:\\custom\\agents'),
    })
  })
})

describe('pinDesktopProductDataRoots', () => {
  it('writes both roots onto the launch environment', () => {
    const env: NodeJS.ProcessEnv = {}
    pinDesktopProductDataRoots(appData, env)
    expect(env.DSH_HOME).toBe(join(appData, DESKTOP_PRODUCT_DATA_DIR, 'home'))
    expect(env.DSH_AGENTS_HOME).toBe(join(appData, DESKTOP_PRODUCT_DATA_DIR, 'agents'))
  })
})

describe('desktopAppDataDir', () => {
  it('reads the platform application-data directory', () => {
    expect(desktopAppDataDir('win32', { APPDATA: 'D:\\Roaming' }, 'D:\\Users\\me')).toBe('D:\\Roaming')
    expect(desktopAppDataDir('win32', { APPDATA: '  ' }, 'D:\\Users\\me')).toBe(join('D:\\Users\\me', 'AppData', 'Roaming'))
    expect(desktopAppDataDir('darwin', {}, '/Users/me')).toBe(join('/Users/me', 'Library', 'Application Support'))
    expect(desktopAppDataDir('linux', { XDG_CONFIG_HOME: '/xdg' }, '/home/me')).toBe('/xdg')
    expect(desktopAppDataDir('linux', {}, '/home/me')).toBe(join('/home/me', '.config'))
  })
})
