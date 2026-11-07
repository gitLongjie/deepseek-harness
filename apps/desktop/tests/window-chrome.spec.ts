import { describe, expect, it } from 'vitest'
import { resolveWindowChrome, toggleWindowZoom, type WindowZoomHost } from '../src/main/desktop/window-chrome.ts'

function zoomHost(state: { full: boolean; max: boolean }): WindowZoomHost & { full: boolean; max: boolean } {
  const host = {
    full: state.full,
    max: state.max,
    isFullScreen: () => host.full,
    setFullScreen: (flag: boolean) => { host.full = flag },
    isMaximized: () => host.max,
    maximize: () => { host.max = true },
    unmaximize: () => { host.max = false },
  }
  return host
}

describe('desktop window chrome', () => {
  it('draws a frameless window on every platform, including macOS', () => {
    expect(resolveWindowChrome('darwin')).toEqual({ frame: false })
    expect(resolveWindowChrome('win32')).toEqual({ frame: false })
    expect(resolveWindowChrome('linux')).toEqual({ frame: false })
    expect(resolveWindowChrome('freebsd')).toEqual({ frame: false })
  })

  it('toggles fullscreen on macOS and maximized bounds elsewhere', () => {
    const mac = zoomHost({ full: false, max: false })
    toggleWindowZoom(mac, 'darwin')
    expect(mac.full).toBe(true)
    toggleWindowZoom(mac, 'darwin')
    expect(mac.full).toBe(false)

    const win = zoomHost({ full: false, max: false })
    toggleWindowZoom(win, 'win32')
    expect(win.max).toBe(true)
    toggleWindowZoom(win, 'win32')
    expect(win.max).toBe(false)

    const linux = zoomHost({ full: false, max: true })
    toggleWindowZoom(linux, 'linux')
    expect(linux.max).toBe(false)
    expect(linux.full).toBe(false)
  })
})
