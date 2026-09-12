// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FULLSCREEN_CHANGE_CHANNEL,
  installTitleBar,
  MACOS_TRAFFIC_LIGHTS_INSET_PX,
  MENU_POPUP_CHANNEL,
  normalizeTitleBarPlatform,
  TITLE_BAR_HEIGHT_PX,
  WINDOW_CHANNELS,
} from '../src/render/title-bar.ts'

/** Fresh body/head per test; jsdom shares one window across the file. */
beforeEach(() => {
  document.head.replaceChildren()
  document.body.replaceChildren()
})

/** The preload-bridge mock installTitleBar consumes; the platform picks the chrome. */
function ipcMock(platform: string): { platform: string; send: ReturnType<typeof vi.fn> } {
  return { platform, send: vi.fn() }
}

function installedBar(platform: string): HTMLElement {
  installTitleBar(document, ipcMock(platform), './favicon.ico')
  return document.getElementById('dsh-desktop-titlebar')!
}

describe('desktop title bar', () => {
  it('injects the app-shift stylesheet, the logo-only brand, menus, and three controls on Windows', () => {
    const bar = installedBar('win32')

    const style = document.getElementById('dsh-desktop-titlebar-style')
    expect(style?.textContent).toContain(`padding-top: ${TITLE_BAR_HEIGHT_PX}px`)
    expect(style?.textContent).toContain(`--dsh-shell-top-inset: ${TITLE_BAR_HEIGHT_PX}px`)
    expect(document.body.firstElementChild?.id).toBe('dsh-desktop-titlebar')

    // Logo only: the brand span carries no text node next to the mark.
    expect(bar.querySelector('.dsh-titlebar-brand img')?.getAttribute('src')).toBe('./favicon.ico')
    expect(bar.querySelector('.dsh-titlebar-brand')?.textContent).toBe('')
    expect(bar.querySelector('[role="dialog"]')).toBeNull()

    const menuButtons = [...bar.querySelectorAll<HTMLButtonElement>('.dsh-titlebar-menu-btn')]
    expect(menuButtons.map(button => button.textContent)).toEqual(['编辑', '视图', '窗口', '帮助'])
    expect(menuButtons.every(button => button.getAttribute('aria-haspopup') === 'menu')).toBe(true)

    const controls = [...bar.querySelectorAll<HTMLButtonElement>('.dsh-titlebar-controls button')]
    expect(controls.map(button => button.getAttribute('aria-label'))).toEqual(['最小化', '最大化', '关闭'])
    expect(style?.textContent).toContain('width: 46px')
    expect(style?.textContent).toContain('#e81123')
    expect(bar.querySelector('.dsh-titlebar-spacer + .dsh-titlebar-update-slot')).not.toBeNull()
    expect(bar.querySelector('.dsh-titlebar-update-slot + .dsh-titlebar-controls')).not.toBeNull()
  })

  it('renders the macOS chrome: drag-only bar past the traffic-light inset, no brand, menus, or controls', () => {
    const bar = installedBar('darwin')

    expect(bar.querySelector('.dsh-titlebar-menu-btn')).toBeNull()
    expect(bar.querySelector('.dsh-titlebar-controls')).toBeNull()
    expect(bar.querySelector('.dsh-titlebar-brand')).toBeNull()
    expect(bar.querySelector('.dsh-titlebar-spacer + .dsh-titlebar-update-slot')).not.toBeNull()

    const style = document.getElementById('dsh-desktop-titlebar-style')
    expect(style?.textContent).toContain(`padding-left: ${MACOS_TRAFFIC_LIGHTS_INSET_PX}px`)
    expect(style?.textContent).not.toContain('#e81123')
  })

  it('hides the bar and the body top shift while the window is fullscreen', () => {
    const listeners = new Map<string, (payload: unknown) => void>()
    const ipc = {
      platform: 'darwin',
      send: vi.fn(),
      on: (channel: string, listener: (payload: unknown) => void) => {
        listeners.set(channel, listener)
        return () => {}
      },
    }
    installTitleBar(document, ipc, './favicon.ico')

    const style = document.getElementById('dsh-desktop-titlebar-style')
    expect(style?.textContent).toContain("body[data-dsh-fullscreen='true'] #dsh-desktop-titlebar")
    expect(style?.textContent).toContain('--dsh-shell-top-inset: 0px')

    listeners.get(FULLSCREEN_CHANGE_CHANNEL)!(true)
    expect(document.body.getAttribute('data-dsh-fullscreen')).toBe('true')
    listeners.get(FULLSCREEN_CHANGE_CHANNEL)!(false)
    expect(document.body.hasAttribute('data-dsh-fullscreen')).toBe(false)
  })

  it('renders the Linux chrome: menus kept and circular controls without the red close fill', () => {
    const bar = installedBar('linux')

    const menuButtons = [...bar.querySelectorAll<HTMLButtonElement>('.dsh-titlebar-menu-btn')]
    expect(menuButtons.map(button => button.textContent)).toEqual(['编辑', '视图', '窗口', '帮助'])
    const controls = [...bar.querySelectorAll<HTMLButtonElement>('.dsh-titlebar-controls button')]
    expect(controls.map(button => button.getAttribute('aria-label'))).toEqual(['最小化', '最大化', '关闭'])

    const style = document.getElementById('dsh-desktop-titlebar-style')
    expect(style?.textContent).toContain('border-radius: 50%')
    expect(style?.textContent).not.toContain('#e81123')
  })

  it('routes each control click over its own IPC channel', () => {
    const ipc = ipcMock('win32')
    installTitleBar(document, ipc, './favicon.ico')
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('#dsh-desktop-titlebar .dsh-titlebar-controls button')]
    buttons[0].click()
    buttons[1].click()
    buttons[2].click()
    expect(ipc.send).toHaveBeenNthCalledWith(1, WINDOW_CHANNELS.minimize)
    expect(ipc.send).toHaveBeenNthCalledWith(2, WINDOW_CHANNELS.toggleMaximize)
    expect(ipc.send).toHaveBeenNthCalledWith(3, WINDOW_CHANNELS.close)
  })

  it('asks the main process to pop up each menu next to its button', () => {
    const ipc = ipcMock('win32')
    installTitleBar(document, ipc, './favicon.ico')
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.dsh-titlebar-menu-btn')]
    buttons[0].click()
    buttons[3].click()
    // jsdom rects are zero-sized at 0,0, so the anchor sits 4px below origin.
    expect(ipc.send).toHaveBeenNthCalledWith(1, MENU_POPUP_CHANNEL, { id: 'edit', x: 0, y: 4 })
    expect(ipc.send).toHaveBeenNthCalledWith(2, MENU_POPUP_CHANNEL, { id: 'help', x: 0, y: 4 })
  })

  it('narrows preload platforms to the styled set, falling unknown ones through to linux', () => {
    expect(normalizeTitleBarPlatform('darwin')).toBe('darwin')
    expect(normalizeTitleBarPlatform('win32')).toBe('win32')
    expect(normalizeTitleBarPlatform('linux')).toBe('linux')
    expect(normalizeTitleBarPlatform('freebsd')).toBe('linux')
  })

  it('defers the install past DOMContentLoaded while the document is still in its head phase', () => {
    // The transport IIFE executes before <body> is parsed; shadowing body with
    // null reproduces that head phase (the crash this regression pins). The
    // install must neither throw nor touch the missing body.
    const body = document.body
    Object.defineProperty(document, 'body', { value: null, configurable: true })
    try {
      const ipc = ipcMock('win32')
      installTitleBar(document, ipc, () => document.querySelector<HTMLLinkElement>('link[rel~="icon"]')!.href)
      expect(document.getElementById('dsh-desktop-titlebar')).toBeNull()
    } finally {
      Object.defineProperty(document, 'body', { value: body, configurable: true })
    }
    const favicon = document.createElement('link')
    favicon.rel = 'icon'
    favicon.href = './brand.ico'
    document.head.append(favicon)
    // By DOMContentLoaded the body exists again (as in the real document), so
    // the deferred install lands the bar and resolves the parsed favicon.
    document.dispatchEvent(new Event('DOMContentLoaded'))
    expect(document.getElementById('dsh-desktop-titlebar')).not.toBeNull()
    expect(document.querySelector<HTMLImageElement>('.dsh-titlebar-brand img')?.src).toBe(favicon.href)
  })
})
