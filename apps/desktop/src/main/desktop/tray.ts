/**
 * System tray. Clicking toggles the main window; closing the window hides to
 * the tray; the tray menu quits the app (which runs the host disposal through
 * the before-quit hook).
 * @module @deepseek-ai/dsh-desktop/desktop/tray
 */

import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron'

/** Tray icon, beside this app's build assets in both layouts. */
const TRAY_ICON = fileURLToPath(new URL('../../../build/tray.png', import.meta.url))

/** Install the tray and the hide-to-tray close behavior. */
export function installTray(win: BrowserWindow): void {
  const icon = nativeImage.createFromPath(TRAY_ICON)
  const tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip('DeepSeek Harness')
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Show main window',
      click: () => { showWindow(win) },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => { app.quit() },
    },
  ]))
  tray.on('click', () => {
    if (win.isVisible() && !win.isMinimized()) {
      win.hide()
    } else {
      showWindow(win)
    }
  })

  // Closing the window hides to the tray; real quit goes through the tray menu
  // → app.quit() → before-quit → host disposal → app.exit, which never fires
  // the window close event (before-quit is intercepted first).
  win.on('close', (event) => {
    event.preventDefault()
    win.hide()
  })
}

function showWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}
