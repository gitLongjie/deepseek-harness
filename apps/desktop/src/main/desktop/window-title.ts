/**
 * The native window title the desktop shell shows. Windows reads this string
 * for the taskbar hover tooltip and alt-tab, so it stays the bare product
 * name; the renderer keeps document.title (session projections) for the
 * browser surface only.
 * @module @deepseek-ai/dsh-desktop/desktop/window-title
 */

import type { BrowserWindow } from 'electron'

/** The only text the native window title ever carries. */
export const DESKTOP_WINDOW_TITLE = '深度Works'

/**
 * Pin the native window title to DESKTOP_WINDOW_TITLE for the window's whole
 * life. Electron adopts each page's document.title into the window title
 * unless the page-title-updated event is prevented; preventing it here keeps
 * the constructor title in place while the page world keeps using its own
 * document.title freely.
 * @param win - the window to pin.
 */
export function pinWindowTitle(win: BrowserWindow): void {
  win.on('page-title-updated', (event) => { event.preventDefault() })
}
