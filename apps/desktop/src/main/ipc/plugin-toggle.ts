/**
 * Plugin enable/disable toggle via the home patch layer. Reads and writes
 * `$DSH_HOME/cordis.patch.yml` to add or remove a `disabled: true` entry for
 * a given plugin id. The desktop boot re-reads this file on HMR, so toggling
 * takes effect without a full restart when config-only HMR is active; otherwise
 * the next launch picks it up.
 * @module @deepseek-ai/dsh-desktop/ipc/plugin-toggle
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { ipcMain } from 'electron'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

const HOME_PATCH_FILENAME = 'cordis.patch.yml'

/** Resolve the absolute path of the home-level user patch file. */
function homePatchPath(): string {
  return `${resolveDshHome()}/${HOME_PATCH_FILENAME}`
}

/**
 * Parse the home patch YAML into an array of patch entries.
 * Minimal parser: handles only the flat `- id: ... / disabled: ...` form
 * (and the serialized empty layer `[]`) that this module itself writes.
 * Falls back to an empty list on any parse failure so a hand-edited file is
 * never silently destroyed.
 */
function parseHomePatch(content: string): Array<{ id: string; disabled?: boolean }> {
  const entries: Array<{ id: string; disabled?: boolean }> = []
  let current: { id: string; disabled?: boolean } | null = null
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trimEnd()
    if (line.startsWith('#') || line.trim() === '') continue
    // The empty layer serializes as a flow `[]`; it carries no entries.
    if (line === '[]') continue
    const idMatch = line.match(/^-\s+id:\s*(.+)$/)
    if (idMatch !== null) {
      if (current !== null) entries.push(current)
      const id = idMatch[1]
      // The capture group above is non-optional, so the id is always present.
      current = { id: id === undefined ? '' : id.trim() }
      continue
    }
    const disabledMatch = line.match(/^\s+disabled:\s*(true|false)\s*$/)
    if (disabledMatch !== null && current !== null) {
      current.disabled = disabledMatch[1] === 'true'
      continue
    }
    // Unrecognized line — bail out to avoid corrupting a hand-edited file.
    return []
  }
  if (current !== null) entries.push(current)
  return entries
}

/** Serialize patch entries back to the minimal YAML form. */
function serializeHomePatch(entries: ReadonlyArray<{ id: string; disabled?: boolean }>): string {
  // Every state must serialize as a top-level YAML array: the app-boot patch
  // loader rejects any other shape, and that rejection fails desktop startup.
  if (entries.length === 0) {
    return '# User-level patch layer: overrides applied over every profile\'s own layers.\n[]\n'
  }
  const lines: string[] = [
    '# User-level patch layer: overrides applied over every profile\'s own layers.',
  ]
  for (const entry of entries) {
    lines.push(`- id: ${entry.id}`)
    if (entry.disabled === true) lines.push('  disabled: true')
  }
  lines.push('')
  return lines.join('\n')
}

/**
 * Register the plugin-toggle IPC handlers.
 * @returns a disposer that removes the handlers.
 */
export function registerPluginToggleIpc(): () => void {
  /**
   * Read whether a plugin is currently disabled in the home patch.
   * Returns `true` if the plugin has `disabled: true`, `false` otherwise.
   */
  ipcMain.handle('dsh:plugin:isEnabled', (_event, pluginId: string): boolean => {
    const patchPath = homePatchPath()
    if (!existsSync(patchPath)) return true // no patch → enabled by default
    try {
      const content = readFileSync(patchPath, 'utf8')
      const entries = parseHomePatch(content)
      const entry = entries.find(e => e.id === pluginId)
      return entry?.disabled !== true
    } catch {
      return true // parse failure → assume enabled
    }
  })

  /**
   * Toggle a plugin's enabled state in the home patch.
   * Writes `disabled: true` to disable, removes the entry to enable.
   */
  ipcMain.handle('dsh:plugin:setEnabled', (_event, pluginId: string, enabled: boolean): void => {
    const patchPath = homePatchPath()
    let entries: Array<{ id: string; disabled?: boolean }> = []
    if (existsSync(patchPath)) {
      try {
        entries = parseHomePatch(readFileSync(patchPath, 'utf8'))
      } catch {
        entries = []
      }
    }
    const existingIndex = entries.findIndex(e => e.id === pluginId)
    if (enabled) {
      // Remove the disable entry (or the whole entry) to enable.
      if (existingIndex >= 0) entries.splice(existingIndex, 1)
    } else {
      // Add or update with disabled: true.
      if (existingIndex >= 0) {
        entries[existingIndex] = { id: pluginId, disabled: true }
      } else {
        entries.push({ id: pluginId, disabled: true })
      }
    }
    mkdirSync(dirname(patchPath), { recursive: true })
    writeFileSync(patchPath, serializeHomePatch(entries), 'utf8')
  })

  return () => {
    ipcMain.removeHandler('dsh:plugin:isEnabled')
    ipcMain.removeHandler('dsh:plugin:setEnabled')
  }
}
