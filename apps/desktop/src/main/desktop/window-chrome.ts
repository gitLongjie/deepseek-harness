/**
 * Per-platform frame chrome for the main BrowserWindow. Windows and Linux go
 * fully frameless — the renderer draws every control (render/title-bar.ts) and
 * drives them over the window-control IPC channels — while macOS keeps the
 * native traffic lights over the same custom bar via `hiddenInset`, because
 * macOS windows are identified by those lights and they carry the platform's
 * native close/minimize/zoom behaviors.
 * @module @deepseek-ai/dsh-desktop/main/desktop/window-chrome
 */

/**
 * The renderer's custom title bar height (render/title-bar.ts
 * TITLE_BAR_HEIGHT_PX); the traffic lights center in it. tests/window-chrome.spec.ts
 * fails when one side moves without the other.
 */
const CUSTOM_TITLE_BAR_HEIGHT_PX = 36

/** The native traffic-light button diameter macOS renders. */
export const TRAFFIC_LIGHT_DIAMETER_PX = 12

/** Where `hiddenInset` pins the traffic lights inside the custom title bar. */
export const TRAFFIC_LIGHT_POSITION = {
  x: 12,
  y: (CUSTOM_TITLE_BAR_HEIGHT_PX - TRAFFIC_LIGHT_DIAMETER_PX) / 2,
} as const

/** The frame-related BrowserWindow options for one platform. */
export type WindowChromeOptions =
  | { frame: false }
  | { titleBarStyle: 'hiddenInset'; trafficLightPosition: { x: number; y: number } }

/**
 * Resolve the frame chrome for a platform. macOS returns the `hiddenInset`
 * pair (native traffic lights over the renderer's bar); every other platform
 * returns fully frameless and leans on the renderer-drawn controls.
 * @param platform - the main process's `process.platform`.
 * @returns the options object to spread into `new BrowserWindow(...)`.
 */
export function resolveWindowChrome(platform: NodeJS.Platform): WindowChromeOptions {
  if (platform === 'darwin') {
    return { titleBarStyle: 'hiddenInset', trafficLightPosition: { ...TRAFFIC_LIGHT_POSITION } }
  }
  return { frame: false }
}
