/**
 * Frame chrome for the main BrowserWindow. Windows and Linux are frameless:
 * the renderer draws the title bar (render/title-bar.ts) and drives it over
 * the window-control IPC channels. macOS uses a hidden title bar instead of
 * `frame: false`. Electron treats any non-`normal` title-bar style as
 * frameless, but only that style creates the traffic-light proxy. Entering
 * fullscreen makes a frameless title bar opaque; without the proxy the bar
 * that slides down with the menu is empty and the menu contents are gone.
 * Native lights still composite above the page, so they stay hidden while the
 * renderer draws them and return only in fullscreen, where the system menu
 * bar hosts them.
 * @module @deepseek-ai/dsh-desktop/main/desktop/window-chrome
 */

/** The frame options spread into `new BrowserWindow(...)`. */
export type WindowChromeOptions =
  | { readonly frame: false }
  | {
    readonly titleBarStyle: 'hidden'
    /** Centers the 12px lights in the 36px renderer bar when they are visible. */
    readonly trafficLightPosition: { readonly x: number; readonly y: number }
  }

/** The zoom operations a frameless window exposes to the title bar. */
export interface WindowZoomHost {
  isFullScreen(): boolean
  setFullScreen(flag: boolean): void
  isMaximized(): boolean
  maximize(): void
  unmaximize(): void
}

/** The window whose native traffic lights follow fullscreen. */
export interface DarwinTrafficLightHost {
  setWindowButtonVisibility(visible: boolean): void
}

/**
 * Resolve the frame chrome for a platform. macOS keeps a hidden title bar so
 * fullscreen can restore the menu bar; every other platform is frameless.
 * @param platform - the main process's `process.platform`.
 * @returns the options object to spread into `new BrowserWindow(...)`.
 */
export function resolveWindowChrome(platform: NodeJS.Platform): WindowChromeOptions {
  if (platform === 'darwin') {
    return { titleBarStyle: 'hidden', trafficLightPosition: { x: 12, y: 12 } }
  }
  return { frame: false }
}

/**
 * Show or hide the native macOS traffic lights. Visible only while fullscreen,
 * so the sliding menu bar keeps them and windowed popups are not covered.
 * @param win - the window that owns the lights.
 * @param fullscreen - whether the window is in native fullscreen.
 */
export function syncDarwinTrafficLights(win: DarwinTrafficLightHost, fullscreen: boolean): void {
  win.setWindowButtonVisibility(fullscreen)
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
