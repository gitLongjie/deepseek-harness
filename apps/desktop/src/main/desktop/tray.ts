/**
 * System tray. Clicking toggles the main window; closing the window hides to
 * the tray; the tray menu quits the app (which runs the host disposal through
 * the before-quit hook).
 * @module @deepseek-ai/dsh-desktop/desktop/tray
 */

import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron'
import type { DesktopTextKey } from './locales.ts'

/** Tray icon, beside this app's build assets in both layouts. */
const TRAY_ICON = fileURLToPath(new URL('../../../build/tray.ico', import.meta.url))

/** Tray plus a locale-aware context-menu rebuild handle. */
export interface TrayHandle {
  tray: Tray
  /** Rebuild the context menu with a new locale-bound translate. */
  rebuild(t: (key: DesktopTextKey) => string): void
}

/** Install the tray and the hide-to-tray close behavior. */
export function installTray(win: BrowserWindow, t: (key: DesktopTextKey) => string): TrayHandle {
  const icon = nativeImage.createFromPath(TRAY_ICON)
  const tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  // Same pinned text as the native window title (window-title.ts): one brand
  // name everywhere the shell hovers.
  tray.setToolTip('深度Works')
  const rebuild = (translate: (key: DesktopTextKey) => string): void => {
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: translate('tray.showWindow'),
        click: () => { showWindow(win) },
      },
      { type: 'separator' },
      {
        label: translate('tray.quit'),
        click: () => { app.quit() },
      },
    ]))
  }
  rebuild(t)
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
  return { tray, rebuild }
}

function showWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}
