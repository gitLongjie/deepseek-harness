/**
 * Frame chrome for the main BrowserWindow. Every platform is frameless: the
 * renderer draws the title bar (render/title-bar.ts) and drives it over the
 * window-control IPC channels. A native caption, including macOS
 * `hiddenInset` traffic lights, composites above the page, so popup content
 * that reaches the top of the window stays covered.
 * @module @deepseek-ai/dsh-desktop/main/desktop/window-chrome
 */

/** The frame options spread into `new BrowserWindow(...)`. */
export type WindowChromeOptions = { readonly frame: false }

/** The zoom operations a frameless window exposes to the title bar. */
export interface WindowZoomHost {
  isFullScreen(): boolean
  setFullScreen(flag: boolean): void
  isMaximized(): boolean
  maximize(): void
  unmaximize(): void
}

/**
 * Resolve the frame chrome for a platform. Every platform is frameless; the
 * argument stays so a native caption has to be an explicit branch here.
 * @param platform - the main process's `process.platform`.
 * @returns the options object to spread into `new BrowserWindow(...)`.
 */
export function resolveWindowChrome(_platform: NodeJS.Platform): WindowChromeOptions {
  return { frame: false }
}

/**
 * Toggle the platform zoom control. macOS enters or leaves fullscreen (the
 * green light); every other platform toggles maximized bounds.
 * @param win - the window that owns the control.
 * @param platform - the main process's `process.platform`.
 */
export function toggleWindowZoom(win: WindowZoomHost, platform: NodeJS.Platform): void {
  if (platform === 'darwin') {
    win.setFullScreen(!win.isFullScreen())
    return
  }
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
}
