/**
 * Launch-at-login control. Windows and macOS are native via Electron's login
 * item settings; Linux is desktop-environment dependent, so it is best-effort
 * and skipped silently.
 * @module @deepseek-ai/dsh-desktop/desktop/autostart
 */

import { app } from 'electron'

/** Whether the app is currently configured to launch at login. */
export function isAutostartEnabled(): boolean {
  if (process.platform === 'linux') return false
  return app.getLoginItemSettings().openAtLogin
}

/**
 * Set launch-at-login.
 * @param enabled - whether to launch at login.
 */
export function setAutostart(enabled: boolean): void {
  if (process.platform === 'linux') return
  app.setLoginItemSettings({ openAtLogin: enabled })
}
