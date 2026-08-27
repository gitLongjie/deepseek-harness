/**
 * Auto-update via electron-updater. Publishes to the GitHub provider configured
 * in electron-builder.yml (gitLongjie/deepseek-harness). Prerelease versions
 * (containing a `-`) use the beta channel (latest-beta.yml); stable versions
 * use latest.yml.
 * @module @deepseek-ai/dsh-desktop/updater
 */

import { app, dialog } from 'electron'
// electron-updater's `autoUpdater` export is a getter, which the ESM-CJS
// named-export interop (cjs-module-lexer) cannot see; read it off the module
// object through the default import instead.
import electronUpdater from 'electron-updater'
const { autoUpdater } = electronUpdater

/** Initialize the updater. Packaged runs check for updates on startup; the
 * download and restart are user-confirmed. */
export function initUpdater(): void {
  if (!app.isPackaged) return
  autoUpdater.channel = app.getVersion().includes('-') ? 'beta' : 'latest'
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    void dialog.showMessageBox({
      type: 'info',
      title: 'Update available',
      message: `A new version (${info.version}) is available.`,
      detail: 'Download and install it now?',
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) void autoUpdater.downloadUpdate()
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    void dialog.showMessageBox({
      type: 'info',
      title: 'Update ready',
      message: `Version ${info.version} has been downloaded.`,
      detail: 'Restart now to apply the update?',
      buttons: ['Restart', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      // isSilent keeps the assisted NSIS installer (allowToChangeInstallationDirectory)
      // from showing its dialogs during auto-update; the first install still gets them.
      if (response === 0) autoUpdater.quitAndInstall(true, true)
    })
  })

  void autoUpdater.checkForUpdates().catch(() => {
    // A failed check (offline, rate-limited) is not fatal; the next launch retries.
  })
}
