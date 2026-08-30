/**
 * Auto-update via electron-updater. The OEM build supplies a generic HTTPS
 * feed containing electron-updater metadata and release artifacts.
 *
 * Availability and download-complete events are pushed to the renderer over
 * `dsh:update:status` so the in-app badge (render/update-badge.ts) shows them;
 * the control asks back over `dsh:update:action` to check, download, or restart
 * and apply. Startup checks stay silent; the Help-menu check reports available,
 * up-to-date, and failure outcomes through dialogs.
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

/** Window currently receiving updater status events. */
let updateWindow: BrowserWindow | undefined

/** Durable desktop logger supplied by the main process. */
let reportUpdateError: ((line: string) => void) | undefined

/** Prevent repeated clicks from launching more than one installer. */
let installStarted = false

/** Bounded application cleanup performed before the native installer starts. */
let prepareInstall: () => Promise<void> = async () => {}

/** Select the metadata filename prefix used by electron-updater. */
function resolveUpdateChannel(version: string): string {
  return /^[^-]+-([A-Za-z][0-9A-Za-z-]*)/.exec(version)?.[1] ?? 'latest'
}

/** Substitute the version placeholder in localized update copy. */
function fillVersion(template: string, version: string): string {
  return template.replace('{version}', version)
}

/** Publish one status payload when the desktop window is still alive. */
function sendStatus(payload: Record<string, unknown>): void {
  if (updateWindow !== undefined && !updateWindow.isDestroyed()) {
    updateWindow.webContents.send('dsh:update:status', payload)
  }
}

/**
 * Initialize the updater. Packaged runs check for updates on startup; the
 * result is pushed to the renderer badge instead of auto-showing dialogs.
 * @param t - locale-bound copy resolver (desktop/locales.ts).
 * @param win - the main window whose renderer hosts the update badge.
 * @param updateUrl - generic electron-updater feed base URL.
 * @param log - durable desktop diagnostic sink.
 * @param prepare - bounded application cleanup before installer launch.
 */
export function initUpdater(
  t: (key: DesktopTextKey) => string,
  win: BrowserWindow,
  updateUrl: string,
  log?: (line: string) => void,
  prepare: () => Promise<void> = async () => {},
): void {
  currentT = t
  updateWindow = win
  reportUpdateError = log
  installStarted = false
  prepareInstall = prepare
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: updateUrl,
    channel: resolveUpdateChannel(app.getVersion()),
  })
  if (!app.isPackaged) return
  // Keep the default channel: electron-updater derives the current channel from
  // the installed version's prerelease label (e.g. "beta"). Pinning 'latest'
  // makes prerelease tags in the feed fail to match, so every update check
  // errors out with "No published versions on GitHub".
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    const showManualResult = manualCheck
    manualCheck = false
    // electron-updater already compares semver, but guard against an equal
    // version surfacing here (e.g. a re-published tag); only a genuinely newer
    // version should light up the in-app badge.
    if (info.version === app.getVersion()) {
      sendStatus({ status: 'idle' })
      if (showManualResult) void showDialog('info', currentT('update.upToDate'))
      return
    }
    sendStatus({ status: 'available', version: info.version })
    if (showManualResult) void promptAvailableUpdate(info.version)
  })

  autoUpdater.on('download-progress', (progress) => {
    sendStatus({ status: 'progressing', percent: Math.round(progress.percent) })
  })

  autoUpdater.on('update-downloaded', (info) => {
    sendStatus({ status: 'downloaded', version: info.version })
    void promptDownloadedUpdate(info.version)
  })

  // Startup checks stay silent when there is nothing new; only an explicit
  // Help-menu check reports the all-clear or a failure.
  autoUpdater.on('update-not-available', () => {
    sendStatus({ status: 'idle' })
    if (manualCheck) void showDialog('info', currentT('update.upToDate'))
    manualCheck = false
  })

  autoUpdater.on('error', (error) => {
    reportUpdateError?.(`desktop: update error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
    sendStatus({ status: 'error' })
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
  sendStatus({ status: 'checking' })
  void autoUpdater.checkForUpdates().catch(() => {
    sendStatus({ status: 'error' })
    manualCheck = false
  })
}

/** The badge's action channel, rendered by render/update-badge.ts. */
export const UPDATE_ACTION_CHANNEL = 'dsh:update:action'

/** Register the badge's download/install actions. Call once after app ready. */
export function registerUpdateIpc(): void {
  ipcMain.on(UPDATE_ACTION_CHANNEL, (_event, payload) => {
    const action = parseAction(payload)
    if (action === 'check') requestUpdateCheck()
    else if (action === 'download') void downloadUpdate()
    else if (action === 'install') void beginInstall()
  })
}

/** Publish the handoff state, then launch the native installer visibly once. */
async function beginInstall(): Promise<void> {
  if (installStarted) return
  installStarted = true
  sendStatus({ status: 'installing' })
  try {
    await prepareInstall()
  } catch (error) {
    reportUpdateError?.(`desktop: update cleanup error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
  }
  autoUpdater.quitAndInstall(false, true)
}

/** Validate one badge action payload; unknown actions are ignored. */
function parseAction(payload: unknown): 'check' | 'download' | 'install' | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const record = payload as Record<string, unknown>
  if (record.action === 'check') return 'check'
  if (record.action === 'download') return 'download'
  if (record.action === 'install') return 'install'
  return undefined
}

/** Start the download and expose immediate feedback before the first byte event. */
async function downloadUpdate(): Promise<void> {
  sendStatus({ status: 'progressing', percent: 0 })
  try {
    await autoUpdater.downloadUpdate()
  } catch {
    // electron-updater also emits `error`; this covers rejected implementations.
    sendStatus({ status: 'error' })
  }
}

/** Offer an immediate download after an explicit check discovers a version. */
async function promptAvailableUpdate(version: string): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: currentT('update.availableTitle'),
    message: fillVersion(currentT('update.availableMessage'), version),
    buttons: [currentT('update.download'), currentT('update.later')],
    defaultId: 0,
    cancelId: 1,
  })
  if (response === 0) await downloadUpdate()
}

/** Offer to hand the downloaded release to the visible native installer. */
async function promptDownloadedUpdate(version: string): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: currentT('update.downloadedTitle'),
    message: fillVersion(currentT('update.downloadedMessage'), version),
    buttons: [currentT('update.restart'), currentT('update.later')],
    defaultId: 0,
    cancelId: 1,
  })
  if (response === 0) await beginInstall()
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
