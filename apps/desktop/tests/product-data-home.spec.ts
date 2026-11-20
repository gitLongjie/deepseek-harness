/** Desktop product data roots stay off the shared Harness and agents defaults. */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultAgentsHome, defaultDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  adoptDesktopProductData,
  DESKTOP_PRODUCT_DATA_DIR,
  DesktopProductDataMigrationError,
  desktopAppDataDir,
  migrateDesktopProductDirectory,
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

describe('adoptDesktopProductData', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true })
    roots.length = 0
  })

  function scratch(): string {
    const root = mkdtempSync(join(tmpdir(), 'dsh-product-data-'))
    roots.push(root)
    return root
  }

  it('copies missing shared entries into an empty product home and leaves the source', () => {
    const root = scratch()
    const sharedHome = join(root, 'shared-home')
    const sharedAgents = join(root, 'shared-agents')
    mkdirSync(join(sharedHome, 'sessions'), { recursive: true })
    writeFileSync(join(sharedHome, 'sessions', 'one.jsonl'), 'session')
    writeFileSync(join(sharedHome, 'settings.json'), 'settings')
    mkdirSync(sharedAgents, { recursive: true })
    writeFileSync(join(sharedAgents, 'AGENTS.md'), 'agents')
    const appData = join(root, 'appdata')
    adoptDesktopProductData(appData, {}, { home: sharedHome, agents: sharedAgents })
    const home = join(appData, DESKTOP_PRODUCT_DATA_DIR, 'home')
    const agents = join(appData, DESKTOP_PRODUCT_DATA_DIR, 'agents')
    expect(readFileSync(join(home, 'sessions', 'one.jsonl'), 'utf8')).toBe('session')
    expect(readFileSync(join(home, 'settings.json'), 'utf8')).toBe('settings')
    expect(readFileSync(join(agents, 'AGENTS.md'), 'utf8')).toBe('agents')
    expect(readFileSync(join(sharedHome, 'sessions', 'one.jsonl'), 'utf8')).toBe('session')
  })

  it('replaces an empty product directory with the shared entries', () => {
    const root = scratch()
    const sharedHome = join(root, 'shared-home')
    mkdirSync(join(sharedHome, 'sessions'), { recursive: true })
    writeFileSync(join(sharedHome, 'sessions', 'old.jsonl'), 'old')
    const appData = join(root, 'appdata')
    const home = join(appData, DESKTOP_PRODUCT_DATA_DIR, 'home')
    mkdirSync(join(home, 'sessions'), { recursive: true })
    adoptDesktopProductData(appData, {}, { home: sharedHome, agents: join(root, 'missing-agents') })
    expect(readFileSync(join(home, 'sessions', 'old.jsonl'), 'utf8')).toBe('old')
  })

  it('keeps an existing product entry and copies only a missing sibling', () => {
    const root = scratch()
    const sharedHome = join(root, 'shared-home')
    mkdirSync(join(sharedHome, 'sessions'), { recursive: true })
    writeFileSync(join(sharedHome, 'sessions', 'old.jsonl'), 'old')
    writeFileSync(join(sharedHome, 'settings.json'), 'shared-settings')
    const appData = join(root, 'appdata')
    const home = join(appData, DESKTOP_PRODUCT_DATA_DIR, 'home')
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'settings.json'), 'product-settings')
    adoptDesktopProductData(appData, {}, { home: sharedHome, agents: join(root, 'missing-agents') })
    expect(readFileSync(join(home, 'settings.json'), 'utf8')).toBe('product-settings')
    expect(readFileSync(join(home, 'sessions', 'old.jsonl'), 'utf8')).toBe('old')
  })

  it('copies an earlier Mac-style product directory into DeepWorker', () => {
    const root = scratch()
    const appData = join(root, 'appdata')
    const legacy = join(appData, 'miaoWorker')
    mkdirSync(join(legacy, 'home', 'sessions'), { recursive: true })
    writeFileSync(join(legacy, 'home', 'sessions', 'one.jsonl'), 'session')
    mkdirSync(join(legacy, 'agents'), { recursive: true })
    writeFileSync(join(legacy, 'agents', 'AGENTS.md'), 'agents')
    mkdirSync(join(legacy, 'desktop'), { recursive: true })
    writeFileSync(join(legacy, 'desktop', 'settings.json'), 'shell')
    mkdirSync(join(legacy, 'Cache'), { recursive: true })
    writeFileSync(join(legacy, 'Cache', 'blob'), 'cache')
    const display = join(appData, '深度Work')
    mkdirSync(join(display, 'home', 'credentials'), { recursive: true })
    writeFileSync(join(display, 'home', 'credentials', 'token'), 'display')
    adoptDesktopProductData(appData, {}, { home: join(root, 'missing-home'), agents: join(root, 'missing-agents') }, ['深度Work'])
    const product = join(appData, DESKTOP_PRODUCT_DATA_DIR)
    expect(readFileSync(join(product, 'home', 'sessions', 'one.jsonl'), 'utf8')).toBe('session')
    expect(readFileSync(join(product, 'home', 'credentials', 'token'), 'utf8')).toBe('display')
    expect(readFileSync(join(product, 'agents', 'AGENTS.md'), 'utf8')).toBe('agents')
    expect(readFileSync(join(product, 'desktop', 'settings.json'), 'utf8')).toBe('shell')
    expect(() => readFileSync(join(product, 'Cache', 'blob'), 'utf8')).toThrow()
    expect(readFileSync(join(legacy, 'home', 'sessions', 'one.jsonl'), 'utf8')).toBe('session')
  })

  it('treats an earlier user-data directory that holds profiles as the home', () => {
    const root = scratch()
    const appData = join(root, 'appdata')
    const legacy = join(appData, 'MindaWork')
    mkdirSync(join(legacy, 'profiles', 'desktop'), { recursive: true })
    writeFileSync(join(legacy, 'profiles', 'desktop', 'marker'), 'profile')
    mkdirSync(join(legacy, 'desktop'), { recursive: true })
    writeFileSync(join(legacy, 'desktop', 'settings.json'), 'shell')
    adoptDesktopProductData(appData, {}, { home: join(root, 'missing-home'), agents: join(root, 'missing-agents') })
    const product = join(appData, DESKTOP_PRODUCT_DATA_DIR)
    expect(readFileSync(join(product, 'home', 'profiles', 'desktop', 'marker'), 'utf8')).toBe('profile')
    expect(readFileSync(join(product, 'desktop', 'settings.json'), 'utf8')).toBe('shell')
    expect(() => readFileSync(join(product, 'profiles', 'desktop', 'marker'), 'utf8')).toThrow()
  })

  it('does not copy into a custom data root', () => {
    const root = scratch()
    const sharedHome = join(root, 'shared-home')
    mkdirSync(sharedHome, { recursive: true })
    writeFileSync(join(sharedHome, 'settings.json'), 'shared')
    const custom = join(root, 'custom-home')
    mkdirSync(custom, { recursive: true })
    adoptDesktopProductData(join(root, 'appdata'), { DSH_HOME: custom, DSH_AGENTS_HOME: join(root, 'custom-agents') }, {
      home: sharedHome,
      agents: join(root, 'shared-agents'),
    })
    expect(readFileSync(join(sharedHome, 'settings.json'), 'utf8')).toBe('shared')
    expect(() => readFileSync(join(root, 'appdata', DESKTOP_PRODUCT_DATA_DIR, 'home', 'settings.json'), 'utf8')).toThrow()
  })

  it('stops when the destination parent is not a directory and leaves the source', () => {
    const root = scratch()
    const source = join(root, 'source')
    mkdirSync(source, { recursive: true })
    writeFileSync(join(source, 'settings.json'), 'shared')
    const parent = join(root, 'blocked')
    writeFileSync(parent, 'not a directory')
    const target = join(parent, 'home')
    expect(() => migrateDesktopProductDirectory(source, target)).toThrow(DesktopProductDataMigrationError)
    expect(readFileSync(join(source, 'settings.json'), 'utf8')).toBe('shared')
    expect(readFileSync(parent, 'utf8')).toBe('not a directory')
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
