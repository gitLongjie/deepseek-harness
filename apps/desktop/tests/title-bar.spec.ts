// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installTitleBar, MENU_POPUP_CHANNEL, TITLE_BAR_HEIGHT_PX, WINDOW_CHANNELS } from '../src/render/title-bar.ts'

/** Fresh body/head per test; jsdom shares one window across the file. */
beforeEach(() => {
  document.head.replaceChildren()
  document.body.replaceChildren()
})

describe('desktop title bar', () => {
  it('injects the app-shift stylesheet, the logo-only brand, menus, and three controls', () => {
    const ipc = { send: vi.fn() }
    installTitleBar(document, ipc, './favicon.ico')

    const style = document.getElementById('dsh-desktop-titlebar-style')
    expect(style?.textContent).toContain(`padding-top: ${TITLE_BAR_HEIGHT_PX}px`)
    expect(document.body.firstElementChild?.id).toBe('dsh-desktop-titlebar')

    const bar = document.getElementById('dsh-desktop-titlebar')!
    // Logo only: the brand span carries no text node next to the mark.
    expect(bar.querySelector('.dsh-titlebar-brand img')?.getAttribute('src')).toBe('./favicon.ico')
    expect(bar.querySelector('.dsh-titlebar-brand')?.textContent).toBe('')
    expect(bar.querySelector('[role="dialog"]')).toBeNull()

    const menuButtons = [...bar.querySelectorAll<HTMLButtonElement>('.dsh-titlebar-menu-btn')]
    expect(menuButtons.map(button => button.textContent)).toEqual(['编辑', '视图', '窗口', '帮助'])
    expect(menuButtons.every(button => button.getAttribute('aria-haspopup') === 'menu')).toBe(true)

    const controls = [...bar.querySelectorAll<HTMLButtonElement>('.dsh-titlebar-controls button')]
    expect(controls.map(button => button.getAttribute('aria-label'))).toEqual(['最小化', '最大化', '关闭'])
  })

  it('routes each control click over its own IPC channel', () => {
    const ipc = { send: vi.fn() }
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
    const ipc = { send: vi.fn() }
    installTitleBar(document, ipc, './favicon.ico')
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.dsh-titlebar-menu-btn')]
    buttons[0].click()
    buttons[3].click()
    // jsdom rects are zero-sized at 0,0, so the anchor sits 4px below origin.
    expect(ipc.send).toHaveBeenNthCalledWith(1, MENU_POPUP_CHANNEL, { id: 'edit', x: 0, y: 4 })
    expect(ipc.send).toHaveBeenNthCalledWith(2, MENU_POPUP_CHANNEL, { id: 'help', x: 0, y: 4 })
  })

  it('defers the install past DOMContentLoaded while the document is still in its head phase', () => {
    // The transport IIFE executes before <body> is parsed; shadowing body with
    // null reproduces that head phase (the crash this regression pins). The
    // install must neither throw nor touch the missing body.
    const body = document.body
    Object.defineProperty(document, 'body', { value: null, configurable: true })
    try {
      const ipc = { send: vi.fn() }
      installTitleBar(document, ipc, './favicon.ico')
      expect(document.getElementById('dsh-desktop-titlebar')).toBeNull()
    } finally {
      Object.defineProperty(document, 'body', { value: body, configurable: true })
    }
    // By DOMContentLoaded the body exists again (as in the real document), so
    // the deferred install lands the bar.
    document.dispatchEvent(new Event('DOMContentLoaded'))
    expect(document.getElementById('dsh-desktop-titlebar')).not.toBeNull()
  })
})
