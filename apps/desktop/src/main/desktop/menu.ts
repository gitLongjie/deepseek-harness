/**
 * Application menu plus the renderer-driven popup registration. The window is
 * frameless, so Windows/Linux never draw a native menu bar; the custom title
 * bar (render/title-bar.ts) renders the visible 编辑/视图/窗口/帮助 buttons and
 * asks this module to pop the matching native submenu over IPC — accelerators
 * and platform behavior stay native while every label is pinned to Chinese.
 * @module @deepseek-ai/dsh-desktop/desktop/menu
 */

import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { isAutostartEnabled, setAutostart } from './autostart.ts'
import type { DesktopTextKey } from './locales.ts'
import { requestUpdateCheck } from '../updater.ts'

/** Renderer→main channel asking for one application-menu submenu popup. */
export const MENU_POPUP_CHANNEL = 'dsh:menu:popup'

/** The top-level menu ids the title bar may request; anything else is ignored. */
const MENU_IDS = ['edit', 'view', 'window', 'help'] as const
type MenuId = (typeof MENU_IDS)[number]

/**
 * Install the application menu. Labels render through the supplied translate
 * function so the shell follows the stored language preference; rebuilding
 * with a new translate keeps accelerators and behavior unchanged.
 * @param t - locale-bound copy resolver (desktop/locales.ts).
 */
export function installApplicationMenu(t: (key: DesktopTextKey) => string): void {
  const darwinAppMenu: MenuItemConstructorOptions[] = process.platform === 'darwin'
    ? [{ role: 'appMenu' }]
    : []
  const template: MenuItemConstructorOptions[] = [
    ...darwinAppMenu,
    {
      id: 'edit',
      label: t('menu.edit'),
      submenu: [
        // Explicit labels pin the menu language; roles keep their accelerators.
        { role: 'undo', label: t('menu.undo') },
        { role: 'redo', label: t('menu.redo') },
        { type: 'separator' },
        { role: 'cut', label: t('menu.cut') },
        { role: 'copy', label: t('menu.copy') },
        { role: 'paste', label: t('menu.paste') },
        { role: 'pasteAndMatchStyle', label: t('menu.pasteAndMatchStyle') },
        { role: 'delete', label: t('menu.delete') },
        { role: 'selectAll', label: t('menu.selectAll') },
      ],
    },
    {
      id: 'view',
      label: t('menu.view'),
      submenu: [
        { role: 'reload', label: t('menu.reload') },
        { role: 'forceReload', label: t('menu.forceReload') },
        { role: 'toggleDevTools', label: t('menu.toggleDevTools') },
        { type: 'separator' },
        { role: 'resetZoom', label: t('menu.resetZoom') },
        { role: 'zoomIn', label: t('menu.zoomIn') },
        { role: 'zoomOut', label: t('menu.zoomOut') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t('menu.fullscreen') },
      ],
    },
    {
      id: 'window',
      label: t('menu.window'),
      submenu: [
        { role: 'minimize', label: t('menu.minimize') },
        { role: 'zoom', label: t('menu.zoom') },
        { role: 'close', label: t('menu.closeWindow') },
        { type: 'separator' },
        // Closing hides to the tray (desktop/tray.ts), so a restore entry is
        // the keyboard-reachable way back that the tray click cannot serve.
        { id: 'show-main-window', label: t('menu.showMainWindow'), click: () => { showMainWindows() } },
      ],
    },
    {
      id: 'help',
      label: t('menu.help'),
      submenu: [
        {
          label: t('menu.github'),
          click: () => { void shell.openExternal('https://github.com/gitLongjie/deepseek-harness') },
        },
        {
          label: t('menu.feedback'),
          click: () => { void shell.openExternal('https://github.com/gitLongjie/deepseek-harness/issues') },
        },
        { type: 'separator' },
        { label: t('menu.checkUpdates'), click: () => { requestUpdateCheck() } },
        { type: 'separator' },
        { label: t('menu.about'), click: () => { void showAbout(t) } },
      ],
    },
    {
      label: t('menu.app'),
      submenu: [
        {
          label: t('menu.autostart'),
          type: 'checkbox',
          checked: isAutostartEnabled(),
          click: (item) => { setAutostart(item.checked) },
        },
        { type: 'separator' },
        { role: 'toggleDevTools', label: t('menu.toggleDevTools') },
        { type: 'separator' },
        { role: 'quit', label: t('menu.quit') },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/**
 * Register the title bar's popup channel. The renderer sends the requested
 * menu id plus the button position in window coordinates; the wire payload is
 * validated here because it crosses the context bridge from the page world.
 */
export function registerMenuPopupIpc(): void {
  ipcMain.on(MENU_POPUP_CHANNEL, (event, payload) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win === null) return
    const request = parsePopupRequest(payload)
    if (request === undefined) return
    const coordinates = request.x !== undefined && request.y !== undefined ? { x: request.x, y: request.y } : {}
    Menu.getApplicationMenu()?.getMenuItemById(request.id)?.submenu?.popup({ window: win, ...coordinates })
  })
}

/** Validate one untrusted popup payload against the closed menu-id set. */
function parsePopupRequest(payload: unknown): { id: MenuId; x?: number; y?: number } | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const record = payload as Record<string, unknown>
  if (!(MENU_IDS as readonly string[]).includes(record.id as string)) return undefined
  const coordinate = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined
  const x = coordinate(record.x)
  const y = coordinate(record.y)
  // Coordinates are optional as a pair; one present-but-invalid member makes
  // the whole request malformed instead of popping up at a default position.
  if (('x' in record || 'y' in record) && (x === undefined || y === undefined)) return undefined
  if (x === undefined || y === undefined) return { id: record.id as MenuId }
  return { id: record.id as MenuId, x, y }
}

/** Restore, show, and focus every app window (the tray's per-window behavior). */
function showMainWindows(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
}

/** Show the about dialog. */
async function showAbout(t: (key: DesktopTextKey) => string): Promise<void> {
  await dialog.showMessageBox({
    type: 'info',
    title: t('about.title'),
    message: t('about.message'),
    detail: `${t('about.version')} ${app.getVersion()}`,
  })
}
