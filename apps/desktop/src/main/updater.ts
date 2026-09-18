/**
 * Auto-update via electron-updater. The OEM build supplies a generic HTTPS
 * feed containing electron-updater metadata and release artifacts; an OEM
 * deployment without a feed (oem.config.json without updateUrl) keeps the
 * updater unwired — no checks, no badge, no Help-menu entry.
 *
 * Availability and download-complete events are pushed to the renderer over
 * `dsh:update:status` so the in-app badge (render/update-badge.ts) shows them;
 * the control asks back over `dsh:update:action` to check, download, or restart
 * and apply. Startup and periodic re-checks stay silent; the Help-menu check
 * reports available, up-to-date, and failure outcomes through dialogs.
 * @module @deepseek-ai/dsh-desktop/updater
 */

import { app, BrowserWindow, dialog, ipcMain } from 'electron'
// electron-updater's `autoUpdater` export is a getter, which the ESM-CJS
// named-export interop (cjs-module-lexer) cannot see; read it off the module
// object through the default import instead.
import electronUpdater from 'electron-updater'
import type { DesktopTextKey } from './desktop/locales.ts'
const { autoUpdater } = electronUpdater

/** One badge status published to the renderer; mirrors render/update-badge.ts states. */
type UpdateStatus = 'idle' | 'checking' | 'available' | 'progressing' | 'downloaded' | 'installing' | 'error'

/** Payload shapes for the `dsh:update:status` channel, keyed by {@link UpdateStatus}. */
type UpdateStatusPayload =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'progressing'; percent: number }
  | { status: 'downloaded'; version: string }
  | { status: 'installing' }
  | { status: 'error' }

/** Locale-bound copy resolver; updated when the shell language changes. */
let currentT: (key: DesktopTextKey) => string = key => key

/** True while an explicit Help-menu check is in flight (drives the no-update/error prompts). */
let manualCheck = false

/**
 * Silent re-check cadence while the app stays open; the startup check covers
 * the first look and a failed re-check simply waits for the next tick.
 */
export const UPDATE_RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

/** Handle of the periodic re-check timer so re-initialization replaces it. */
let recheckTimer: NodeJS.Timeout | undefined

/** True from `checkForUpdates` until a terminal updater event resolves it. */
let checkInFlight = false

/** Badge status most recently published to the renderer; drives re-check skipping. */
let lastStatus: UpdateStatus | undefined

/** Window currently receiving updater status events. */
let updateWindow: BrowserWindow | undefined

/** Durable desktop logger supplied by the main process. */
let reportUpdateError: ((line: string) => void) | undefined

/** Prevent repeated clicks from launching more than one installer. */
let installStarted = false

/**
 * True from the latest initUpdater only when a feed URL was supplied; the
 * Help-menu entry and the badge's IPC actions consult it to stay inert on
 * deployments without updates.
 */
let feedConfigured = false

/**
 * Bound on the pre-install cleanup: a stuck host disposal must not strand the
 * badge on the disabled "installing" state forever. Quitting after the timeout
 * is safe — the quit-path disposal runs the same cleanup again.
 */
export const PREPARE_INSTALL_TIMEOUT_MS = 10_000

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
function sendStatus(payload: UpdateStatusPayload): void {
  lastStatus = payload.status
  if (updateWindow !== undefined && !updateWindow.isDestroyed()) {
    updateWindow.webContents.send('dsh:update:status', payload)
  }
}

/** One silent check; terminal outcomes reach the renderer through the events below. */
function silentUpdateCheck(): void {
  checkInFlight = true
  void autoUpdater.checkForUpdates()
    .catch(() => {
      // electron-updater also emits `error`; this covers rejected implementations.
      // A failed check (offline, rate-limited) is not fatal; the next tick or
      // launch retries.
    })
    .finally(() => { checkInFlight = false })
}

/**
 * Re-check on a fixed cadence. Ticks wait while a check is in flight and skip
 * whenever the badge is mid-flow: re-checking past `available` would reset a
 * deferred `downloaded` state, and a `checking` flash belongs to manual checks.
 */
function scheduleUpdateRecheck(): void {
  clearInterval(recheckTimer)
  recheckTimer = setInterval(() => {
    if (checkInFlight) return
    if (lastStatus !== undefined && lastStatus !== 'idle' && lastStatus !== 'error') return
    silentUpdateCheck()
  }, UPDATE_RECHECK_INTERVAL_MS)
  recheckTimer.unref()
}

/**
 * Initialize the updater. Packaged runs check for updates on startup and then
 * re-check silently every {@link UPDATE_RECHECK_INTERVAL_MS}; discovery lights
 * up the renderer badge instead of auto-showing dialogs. With no feed URL the
 * whole updater stays unwired and {@link updateChecksEnabled} reports false.
 * @param t - locale-bound copy resolver (desktop/locales.ts).
 * @param win - the main window whose renderer hosts the update badge.
 * @param updateUrl - generic electron-updater feed base URL, or undefined for
 * deployments that must not check for updates.
 * @param log - durable desktop diagnostic sink.
 * @param prepare - bounded application cleanup before installer launch.
 */
export function initUpdater(
  t: (key: DesktopTextKey) => string,
  win: BrowserWindow,
  updateUrl: string | undefined,
  log?: (line: string) => void,
  prepare: () => Promise<void> = async () => {},
): void {
  currentT = t
  updateWindow = win
  reportUpdateError = log
  installStarted = false
  manualCheck = false
  checkInFlight = false
  lastStatus = undefined
  prepareInstall = prepare
  feedConfigured = updateUrl !== undefined
  if (updateUrl === undefined) return
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
    checkInFlight = false
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
    checkInFlight = false
    sendStatus({ status: 'idle' })
    if (manualCheck) void showDialog('info', currentT('update.upToDate'))
    manualCheck = false
  })

  autoUpdater.on('error', (error) => {
    checkInFlight = false
    reportUpdateError?.(`desktop: update error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
    // An install-phase failure (e.g. Squirrel.Mac rejecting the staged app on
    // signature grounds) must reset the badge — leaving it on the disabled
    // "installing" state strands the user with no retry path.
    if (installStarted) {
      installStarted = false
      sendStatus({ status: 'error' })
      return
    }
    // Startup checks are opportunistic. An offline or slow update host must
    // not create a retry control while the user is working with the product.
    // Explicit Help-menu checks still expose the failure and offer a retry.
    if (manualCheck) {
      sendStatus({ status: 'error' })
      void showDialog('error', currentT('update.error'))
    }
    manualCheck = false
  })

  silentUpdateCheck()
  scheduleUpdateRecheck()
}

/** Swap the locale copy used by the update prompts after a language change. */
export function setUpdaterLocale(t: (key: DesktopTextKey) => string): void {
  currentT = t
}

/** Whether this deployment has a feed and therefore offers update checks. */
export function updateChecksEnabled(): boolean {
  return feedConfigured
}

/** Explicit Help-menu update check; reports no-update/error through dialogs. */
export function requestUpdateCheck(): void {
  if (!feedConfigured) return
  manualCheck = true
  checkInFlight = true
  sendStatus({ status: 'checking' })
  void autoUpdater.checkForUpdates()
    .catch(() => {
      sendStatus({ status: 'error' })
      manualCheck = false
    })
    .finally(() => { checkInFlight = false })
}

/** The badge's action channel, rendered by render/update-badge.ts. */
export const UPDATE_ACTION_CHANNEL = 'dsh:update:action'

/** Register the badge's download/install actions. Call once after app ready. */
export function registerUpdateIpc(): void {
  ipcMain.on(UPDATE_ACTION_CHANNEL, (_event, payload) => {
    if (!feedConfigured) return
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
    await Promise.race([
      prepareInstall(),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, PREPARE_INSTALL_TIMEOUT_MS)
        timer.unref?.()
      }),
    ])
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
