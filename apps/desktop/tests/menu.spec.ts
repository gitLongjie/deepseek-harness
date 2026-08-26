/**
 * Unit tests for the application menu and its renderer-driven popup channel.
 * Electron is mocked: the template assertions pin the closed id set and the
 * valid-role invariant, and the popup handler tests pin wire validation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MENU_POPUP_CHANNEL, installApplicationMenu, registerMenuPopupIpc } from '../src/main/desktop/menu.ts'

/** The role union shipped by electron.d.ts; an unknown role fails at runtime. */
const VALID_ROLES = new Set([
  'undo', 'redo', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'delete', 'selectAll',
  'reload', 'forceReload', 'toggleDevTools', 'resetZoom', 'zoomIn', 'zoomOut',
  'toggleSpellChecker', 'togglefullscreen', 'window', 'minimize', 'close', 'help',
  'about', 'services', 'hide', 'hideOthers', 'unhide', 'quit', 'startSpeaking',
  'stopSpeaking', 'zoom', 'front', 'appMenu', 'fileMenu', 'editMenu', 'viewMenu',
  'shareMenu', 'recentDocuments', 'toggleTabBar', 'selectNextTab', 'selectPreviousTab',
  'showAllTabs', 'mergeAllWindows', 'clearRecentDocuments', 'moveTabToNewWindow', 'windowMenu',
])

/** What the tests read out of the fake Menu/ipcMain surfaces. */
interface MenuItemOptions {
  id?: string
  label?: string
  role?: string
  click?: (item: unknown, win: unknown) => void
  submenu?: MenuItemOptions[]
}

/** The slice of the built application menu the code under test touches. */
interface ApplicationMenu {
  getMenuItemById(id: string): { submenu?: { popup(options: unknown): void } } | undefined
}

const state = vi.hoisted(() => ({
  template: [] as MenuItemOptions[],
  menu: undefined as ApplicationMenu | undefined,
  popup: vi.fn(),
  ipcOn: vi.fn(),
  fromWebContents: vi.fn(),
  getAllWindows: vi.fn(() => [] as Array<Record<string, unknown>>),
  openExternal: vi.fn(async () => {}),
}))

vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0-test' },
  BrowserWindow: {
    fromWebContents: state.fromWebContents,
    getAllWindows: state.getAllWindows,
  },
  dialog: { showMessageBox: vi.fn(async () => ({ response: 0 })) },
  ipcMain: { on: state.ipcOn },
  Menu: {
    buildFromTemplate: (template: MenuItemOptions[]) => {
      state.template = template
      return {
        getMenuItemById: (id: string) => {
          const item = findItem(template, id)
          return item === undefined ? undefined : { ...item, submenu: { popup: state.popup } }
        },
      }
    },
    setApplicationMenu: (menu: ApplicationMenu) => { state.menu = menu },
    getApplicationMenu: (): ApplicationMenu | undefined => state.menu,
  },
  shell: { openExternal: state.openExternal },
}))

vi.mock('../src/main/desktop/autostart.ts', () => ({
  isAutostartEnabled: () => false,
  setAutostart: vi.fn(),
}))

/** Depth-first search of one template subtree for an item with the given id. */
function findItem(items: MenuItemOptions[], id: string): MenuItemOptions | undefined {
  for (const item of items) {
    if (item.id === id) return item
    if (item.submenu !== undefined) {
      const hit = findItem(item.submenu, id)
      if (hit !== undefined) return hit
    }
  }
  return undefined
}

beforeEach(() => {
  state.popup.mockClear()
  state.ipcOn.mockClear()
  state.fromWebContents.mockReset().mockReturnValue(null)
  state.getAllWindows.mockReturnValue([])
  state.openExternal.mockClear()
  state.menu = undefined
  installApplicationMenu()
})

describe('application menu template', () => {
  it('installs top-level menus addressable by the title bar ids', () => {
    expect(state.menu).toBeDefined()
    for (const id of ['edit', 'view', 'window', 'help']) {
      expect(findItem(state.template, id)).toBeDefined()
    }
  })

  it('keeps every leaf item on a role Electron actually ships', () => {
    const collect = (items: MenuItemOptions[]): void => {
      for (const item of items) {
        if (item.role !== undefined) expect(VALID_ROLES).toContain(item.role)
        if (item.submenu !== undefined) collect(item.submenu)
      }
    }
    collect(state.template)
  })

  it('restores the hidden main window from the window menu', () => {
    const show = vi.fn()
    const focus = vi.fn()
    state.getAllWindows.mockReturnValue([{ isMinimized: () => false, show, focus }])
    const entry = findItem(state.template, 'show-main-window')
    expect(entry?.label).toBe('显示主窗口')
    entry?.click?.({}, undefined)
    expect(show).toHaveBeenCalledTimes(1)
    expect(focus).toHaveBeenCalledTimes(1)
  })

  it('opens only the real repository surfaces from the help menu', () => {
    const items = findItem(state.template, 'help')?.submenu ?? []
    for (const item of items) {
      item.click?.({}, undefined)
    }
    const urls = state.openExternal.mock.calls.map(call => call[0] as string)
    expect(urls).toContain('https://github.com/deepseek-ai/deepseek-harness')
    expect(urls).toContain('https://github.com/deepseek-ai/deepseek-harness/discussions')
    expect(urls.every(url => url.startsWith('https://github.com/deepseek-ai/deepseek-harness'))).toBe(true)
  })
})

describe('menu popup channel', () => {
  /** Grab the single registered channel listener. */
  function listener(): (event: unknown, payload: unknown) => void {
    registerMenuPopupIpc()
    expect(state.ipcOn).toHaveBeenCalledTimes(1)
    expect(state.ipcOn).toHaveBeenCalledWith(MENU_POPUP_CHANNEL, expect.any(Function))
    return state.ipcOn.mock.calls[0]?.[1] as (event: unknown, payload: unknown) => void
  }

  it('pops up the requested submenu anchored at the button coordinates', () => {
    const onMessage = listener()
    const win = {}
    state.fromWebContents.mockReturnValue(win)

    onMessage({ sender: {} }, { id: 'edit', x: 120, y: 30 })
    expect(state.popup).toHaveBeenCalledWith({ window: win, x: 120, y: 30 })

    onMessage({ sender: {} }, { id: 'help', x: 300, y: 30 })
    expect(state.popup).toHaveBeenCalledWith({ window: win, x: 300, y: 30 })
  })

  it('ignores unknown ids and malformed payloads from the page world', () => {
    const onMessage = listener()
    state.fromWebContents.mockReturnValue({})

    onMessage({ sender: {} }, { id: 'file', x: 0, y: 0 })
    onMessage({ sender: {} }, 'edit')
    onMessage({ sender: {} }, null)
    onMessage({ sender: {} }, { id: 42 })
    onMessage({ sender: {} }, { id: 'edit', x: Number.POSITIVE_INFINITY, y: 1 })
    expect(state.popup).not.toHaveBeenCalled()
  })

  it('ignores requests whose sender is not a known window', () => {
    const onMessage = listener()
    onMessage({ sender: {} }, { id: 'edit', x: 1, y: 2 })
    expect(state.popup).not.toHaveBeenCalled()
  })
})
