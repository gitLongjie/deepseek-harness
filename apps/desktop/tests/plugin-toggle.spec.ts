/**
 * Unit tests for the plugin-toggle state store. The state lives in
 * `$DSH_HOME/plugin-settings.json` — deliberately NOT the home patch layer:
 * a loader patch row would unmount the plugin at boot, killing the live
 * toggle. These tests pin the JSON contract the Settings row and the plugin
 * client both ride on.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

const STATE_FILENAME = 'plugin-settings.json'
const PLUGIN_ID = 'xmanrui-dsh-business-entry'

let home: string
let dispose: (() => void) | undefined

function callHandler(channel: string, ...args: unknown[]): unknown {
  const handler = state.handlers.get(channel)
  if (handler === undefined) throw new Error(`handler not registered: ${channel}`)
  return handler(undefined, ...args)
}

function readStateFile(): { plugins: Record<string, { disabled?: boolean }> } {
  return JSON.parse(readFileSync(join(home, STATE_FILENAME), 'utf8'))
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

describe('plugin toggle state store', () => {
  it('reports plugins enabled when no state file exists', () => {
    expect(callHandler('dsh:plugin:isEnabled', PLUGIN_ID)).toBe(true)
  })

  it('persists a disable toggle and reads it back', () => {
    callHandler('dsh:plugin:setEnabled', PLUGIN_ID, false)

    expect(readStateFile()).toEqual({ plugins: { [PLUGIN_ID]: { disabled: true } } })
    expect(callHandler('dsh:plugin:isEnabled', PLUGIN_ID)).toBe(false)
  })

  it('drops the entry on re-enable so the plugin mounts enabled next boot', () => {
    callHandler('dsh:plugin:setEnabled', PLUGIN_ID, false)
    callHandler('dsh:plugin:setEnabled', PLUGIN_ID, true)

    expect(readStateFile()).toEqual({ plugins: {} })
    expect(callHandler('dsh:plugin:isEnabled', PLUGIN_ID)).toBe(true)
  })

  it('keeps sibling entries when toggling one plugin', () => {
    callHandler('dsh:plugin:setEnabled', 'other-plugin', false)
    callHandler('dsh:plugin:setEnabled', PLUGIN_ID, false)
    callHandler('dsh:plugin:setEnabled', PLUGIN_ID, true)

    expect(readStateFile()).toEqual({ plugins: { 'other-plugin': { disabled: true } } })
    expect(callHandler('dsh:plugin:isEnabled', 'other-plugin')).toBe(false)
    expect(callHandler('dsh:plugin:isEnabled', PLUGIN_ID)).toBe(true)
  })

  it('treats a mangled state file as empty instead of failing the toggle', () => {
    writeFileSync(join(home, STATE_FILENAME), '{ not json', 'utf8')

    expect(callHandler('dsh:plugin:isEnabled', PLUGIN_ID)).toBe(true)

    callHandler('dsh:plugin:setEnabled', PLUGIN_ID, false)
    expect(readStateFile()).toEqual({ plugins: { [PLUGIN_ID]: { disabled: true } } })
  })

  it('creates the home directory when missing', () => {
    rmSync(home, { recursive: true, force: true })

    callHandler('dsh:plugin:setEnabled', PLUGIN_ID, false)

    expect(existsSync(join(home, STATE_FILENAME))).toBe(true)
  })
})
