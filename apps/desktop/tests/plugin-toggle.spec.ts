/**
 * Unit tests for the home-patch plugin toggle. The serialized patch layer must
 * stay a top-level YAML array in every state: the app-boot patch loader
 * rejects any other shape, and that rejection fails desktop startup. The
 * disabled-entry form is validated with the same js-yaml parser app-boot uses.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import yaml from 'js-yaml'

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: never[]) => unknown>(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: never[]) => unknown) => {
      state.handlers.set(channel, handler)
    },
    removeHandler: (channel: string) => {
      state.handlers.delete(channel)
    },
  },
}))

import { registerPluginToggleIpc } from '../src/main/ipc/plugin-toggle.ts'

const HOME_PATCH_FILENAME = 'cordis.patch.yml'
const PLUGIN_ID = 'xmanrui-dsh-business-entry'

let home: string
let dispose: (() => void) | undefined

function callHandler(channel: string, ...args: unknown[]): unknown {
  const handler = state.handlers.get(channel)
  if (handler === undefined) throw new Error(`handler not registered: ${channel}`)
  return handler(undefined, ...args)
}

function readHomePatch(): string {
  return readFileSync(join(home, HOME_PATCH_FILENAME), 'utf8')
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dsh-plugin-toggle-'))
  process.env.DSH_HOME = home
  dispose = registerPluginToggleIpc()
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  delete process.env.DSH_HOME
  rmSync(home, { recursive: true, force: true })
  state.handlers.clear()
})

describe('plugin toggle home patch', () => {
  it('reports plugins enabled when no patch file exists', () => {
    expect(callHandler('dsh:plugin:isEnabled', PLUGIN_ID)).toBe(true)
  })

  it('serializes a disable toggle as a top-level YAML array', () => {
    callHandler('dsh:plugin:setEnabled', PLUGIN_ID, false)

    expect(yaml.load(readHomePatch())).toEqual([{ id: PLUGIN_ID, disabled: true }])
    expect(callHandler('dsh:plugin:isEnabled', PLUGIN_ID)).toBe(false)
  })

  it('serializes the re-enabled empty state as a top-level YAML array', () => {
    callHandler('dsh:plugin:setEnabled', PLUGIN_ID, false)
    callHandler('dsh:plugin:setEnabled', PLUGIN_ID, true)

    const content = readHomePatch()
    expect(yaml.load(content)).toEqual([])
    expect(callHandler('dsh:plugin:isEnabled', PLUGIN_ID)).toBe(true)
  })

  it('keeps sibling entries when toggling one plugin', () => {
    callHandler('dsh:plugin:setEnabled', 'other-plugin', false)
    callHandler('dsh:plugin:setEnabled', PLUGIN_ID, false)
    callHandler('dsh:plugin:setEnabled', PLUGIN_ID, true)

    expect(yaml.load(readHomePatch())).toEqual([{ id: 'other-plugin', disabled: true }])
    expect(callHandler('dsh:plugin:isEnabled', 'other-plugin')).toBe(false)
    expect(callHandler('dsh:plugin:isEnabled', PLUGIN_ID)).toBe(true)
  })

  it('creates the home directory when missing', () => {
    rmSync(home, { recursive: true, force: true })

    callHandler('dsh:plugin:setEnabled', PLUGIN_ID, false)

    expect(existsSync(join(home, HOME_PATCH_FILENAME))).toBe(true)
  })
})
