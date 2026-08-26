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

/** Renderer→main channel asking for one application-menu submenu popup. */
export const MENU_POPUP_CHANNEL = 'dsh:menu:popup'

/** The top-level menu ids the title bar may request; anything else is ignored. */
const MENU_IDS = ['edit', 'view', 'window', 'help'] as const
type MenuId = (typeof MENU_IDS)[number]

/** Install the application menu. */
export function installApplicationMenu(): void {
  const darwinAppMenu: MenuItemConstructorOptions[] = process.platform === 'darwin'
    ? [{ role: 'appMenu' }]
    : []
  const template: MenuItemConstructorOptions[] = [
    ...darwinAppMenu,
    {
      id: 'edit',
      label: '编辑',
      submenu: [
        // Explicit labels pin the menu language; roles keep their accelerators.
        { role: 'undo', label: '撤消' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'pasteAndMatchStyle', label: '粘贴并匹配样式' },
        { role: 'delete', label: '删除' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      id: 'view',
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      id: 'window',
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { role: 'close', label: '关闭窗口' },
        { type: 'separator' },
        // Closing hides to the tray (desktop/tray.ts), so a restore entry is
        // the keyboard-reachable way back that the tray click cannot serve.
        { id: 'show-main-window', label: '显示主窗口', click: () => { showMainWindows() } },
      ],
    },
    {
      id: 'help',
      label: '帮助',
      submenu: [
        {
          label: 'GitHub 仓库',
          click: () => { void shell.openExternal('https://github.com/deepseek-ai/deepseek-harness') },
        },
        {
          label: '反馈与讨论',
          click: () => { void shell.openExternal('https://github.com/deepseek-ai/deepseek-harness/discussions') },
        },
        { type: 'separator' },
        { label: '关于 DeepSeek Harness', click: () => { void showAbout() } },
      ],
    },
    {
      label: 'App',
      submenu: [
        {
          label: '登录时启动',
          type: 'checkbox',
          checked: isAutostartEnabled(),
          click: (item) => { setAutostart(item.checked) },
        },
        { type: 'separator' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
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
async function showAbout(): Promise<void> {
  await dialog.showMessageBox({
    type: 'info',
    title: '关于',
    message: 'DeepSeek Harness 桌面版',
    detail: `版本 ${app.getVersion()}`,
  })
}
