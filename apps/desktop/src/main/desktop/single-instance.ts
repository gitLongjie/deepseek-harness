/**
 * Single-instance lock: a second launch focuses the existing window instead of
 * mounting a second host tree.
 * @module @deepseek-ai/dsh-desktop/desktop/single-instance
 */

import { app, BrowserWindow } from 'electron'

/**
 * Acquire the single-instance lock and focus the existing window on a second
 * launch.
 * @returns whether this instance owns the lock and should run the app.
 */
export function installSingleInstanceLock(): boolean {
  const got = app.requestSingleInstanceLock()
  if (got) {
    app.on('second-instance', () => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win === undefined) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    })
  }
  return got
}
