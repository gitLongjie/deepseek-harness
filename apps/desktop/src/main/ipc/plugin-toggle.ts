/**
 * Plugin enable/disable toggle persistence. The state lives in
 * `$DSH_HOME/plugin-settings.json` — deliberately NOT the home patch layer:
 * a `disabled: true` patch row makes the Loader skip the plugin at boot, so a
 * plugin disabled in a previous session never runs the client that listens
 * for re-enable, and the Settings toggle could not bring it back without a
 * restart. The plugin always mounts; this state only decides whether its UI
 * surfaces register.
 * @module @deepseek-ai/dsh-desktop/ipc/plugin-toggle
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { ipcMain } from 'electron'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

const STATE_FILENAME = 'plugin-settings.json'

/** Persisted per-plugin UI state. */
interface PluginState {
  plugins?: Record<string, { disabled?: boolean }>
}

/** Resolve the absolute path of the plugin-state file. */
function statePath(): string {
  return `${resolveDshHome()}/${STATE_FILENAME}`
}

/**
 * Read the persisted per-plugin state. Any unreadable file counts as empty,
 * so a hand-mangled file never bricks the toggle (the next write repairs it).
 */
function readState(): Record<string, { disabled?: boolean }> {
  try {
    const parsed = JSON.parse(readFileSync(statePath(), 'utf8')) as PluginState
    return parsed.plugins ?? {}
  } catch {
    return {}
  }
}

function writeState(plugins: Record<string, { disabled?: boolean }>): void {
  mkdirSync(dirname(statePath()), { recursive: true })
  writeFileSync(statePath(), `${JSON.stringify({ plugins }, null, 2)}\n`, 'utf8')
}

/**
 * Register the plugin-toggle IPC handlers.
 * @returns a disposer that removes the handlers.
 */
export function registerPluginToggleIpc(): () => void {
  /**
   * Read whether a plugin is currently disabled. Returns `true` unless the
   * state file marks the plugin `disabled: true`.
   */
  ipcMain.handle('dsh:plugin:isEnabled', (_event, pluginId: string): boolean => {
    return readState()[pluginId]?.disabled !== true
  })

  /**
   * Toggle a plugin's enabled state: enabling drops the entry, disabling
   * writes `disabled: true`.
   */
  ipcMain.handle('dsh:plugin:setEnabled', (_event, pluginId: string, enabled: boolean): void => {
    const plugins = readState()
    const next: Record<string, { disabled?: boolean }> = {}
    for (const [id, state] of Object.entries(plugins)) {
      if (id !== pluginId) next[id] = state
    }
    if (!enabled) next[pluginId] = { disabled: true }
    writeState(next)
  })

  return () => {
    ipcMain.removeHandler('dsh:plugin:isEnabled')
    ipcMain.removeHandler('dsh:plugin:setEnabled')
  }
}
