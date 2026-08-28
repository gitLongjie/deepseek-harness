/**
 * Auto-update via electron-updater. Publishes to the GitHub provider configured
 * in electron-builder.yml (gitLongjie/deepseek-harness). All releases (stable
 * and -beta) share the single latest feed; prerelease vs stable is resolved by
 * version comparison and electron-updater's allowPrerelease rule.
 *
 * Availability and download-complete events are pushed to the renderer over
 * `dsh:update:status` so the in-app badge (render/update-badge.ts) shows them;
 * the badge asks back over `dsh:update:action` to prompt the download or to
 * restart and apply. Startup checks stay silent; only the Help-menu check
 * reports the all-clear or a failure through dialogs.
 * @module @deepseek-ai/dsh-desktop/updater
 */

import { app, BrowserWindow, dialog, ipcMain } from 'electron'
// electron-updater's `autoUpdater` export is a getter, which the ESM-CJS
// named-export interop (cjs-module-lexer) cannot see; read it off the module
// object through the default import instead.
import electronUpdater from 'electron-updater'
import type { DesktopTextKey } from './desktop/locales.ts'
const { autoUpdater } = electronUpdater

/** Locale-bound copy resolver; updated when the shell language changes. */
let currentT: (key: DesktopTextKey) => string = key => key

/** True while an explicit Help-menu check is in flight (drives the no-update/error prompts). */
let manualCheck = false

/** The newest version announced by electron-updater, for the prompt dialog. */
let latestVersion: string | undefined

/** Substitute the version placeholder in a template. */
function fill(template: string, version: string): string {
  return template.replace('{version}', version)
}

/**
 * Initialize the updater. Packaged runs check for updates on startup; the
 * result is pushed to the renderer badge instead of auto-showing dialogs.
 * @param t - locale-bound copy resolver (desktop/locales.ts).
 * @param win - the main window whose renderer hosts the update badge.
 */
export function initUpdater(t: (key: DesktopTextKey) => string, win: BrowserWindow): void {
  currentT = t
  if (!app.isPackaged) return
  // Keep the default channel: electron-updater derives the current channel from
  // the installed version's prerelease label (e.g. "beta"). Pinning 'latest'
  // makes prerelease tags in the feed fail to match, so every update check
  // errors out with "No published versions on GitHub".
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    manualCheck = false
    // electron-updater already compares semver, but guard against an equal
    // version surfacing here (e.g. a re-published tag); only a genuinely newer
    // version should light up the in-app badge.
    if (info.version === app.getVersion()) return
    latestVersion = info.version
    if (!win.isDestroyed()) {
      win.webContents.send('dsh:update:status', { status: 'available', version: info.version })
    }
  })

  autoUpdater.on('download-progress', (progress) => {
    if (!win.isDestroyed()) {
      win.webContents.send('dsh:update:status', {
        status: 'progressing',
        percent: Math.round(progress.percent),
      })
    }
  })

  autoUpdater.on('update-downloaded', (info) => {
    latestVersion = info.version
    if (!win.isDestroyed()) {
      win.webContents.send('dsh:update:status', { status: 'downloaded', version: info.version })
    }
  })

  // Startup checks stay silent when there is nothing new; only an explicit
  // Help-menu check reports the all-clear or a failure.
  autoUpdater.on('update-not-available', () => {
    if (manualCheck) void showDialog('info', currentT('update.upToDate'))
    manualCheck = false
  })

  autoUpdater.on('error', () => {
    if (manualCheck) void showDialog('error', currentT('update.error'))
    manualCheck = false
  })

  void autoUpdater.checkForUpdates().catch(() => {
    // A failed check (offline, rate-limited) is not fatal; the next launch retries.
  })
}

/** Swap the locale copy used by the update prompts after a language change. */
export function setUpdaterLocale(t: (key: DesktopTextKey) => string): void {
  currentT = t
}

/** Explicit Help-menu update check; reports no-update/error through dialogs. */
export function requestUpdateCheck(): void {
  manualCheck = true
  void autoUpdater.checkForUpdates().catch(() => {
    manualCheck = false
  })
}

/** The badge's action channel, rendered by render/update-badge.ts. */
export const UPDATE_ACTION_CHANNEL = 'dsh:update:action'

/** Register the badge's download/install actions. Call once after app ready. */
export function registerUpdateIpc(): void {
  ipcMain.on(UPDATE_ACTION_CHANNEL, (_event, payload) => {
    const action = parseAction(payload)
    if (action === 'prompt') void promptDownload()
    else if (action === 'install') autoUpdater.quitAndInstall(true, true)
  })
}

/** Validate one badge action payload; unknown actions are ignored. */
function parseAction(payload: unknown): 'prompt' | 'install' | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const record = payload as Record<string, unknown>
  if (record.action === 'install') return 'install'
  if (record.action === 'prompt') return 'prompt'
  return undefined
}

/** Ask the user to confirm the download, then start it. */
function promptDownload(): Promise<void> {
  const version = latestVersion ?? ''
  return dialog.showMessageBox({
    type: 'info',
    title: currentT('update.availableTitle'),
    message: fill(currentT('update.availableMessage'), version),
    buttons: [currentT('update.download'), currentT('update.later')],
    defaultId: 0,
    cancelId: 1,
  }).then(({ response }) => {
    if (response === 0) void autoUpdater.downloadUpdate()
  })
}

/** One-button info/error dialog for the manual check outcomes. */
async function showDialog(type: 'info' | 'error', message: string): Promise<void> {
  await dialog.showMessageBox({
    type,
    title: currentT('update.availableTitle'),
    message,
    buttons: [currentT('update.ok')],
  })
}
