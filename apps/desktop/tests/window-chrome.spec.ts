import { describe, expect, it } from 'vitest'
import { resolveWindowChrome, syncDarwinTrafficLights, toggleWindowZoom, type WindowZoomHost } from '../src/main/desktop/window-chrome.ts'

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
  it('keeps a hidden macOS title bar and a frameless window elsewhere', () => {
    expect(resolveWindowChrome('darwin')).toEqual({ titleBarStyle: 'hidden', trafficLightPosition: { x: 12, y: 12 } })
    expect(resolveWindowChrome('win32')).toEqual({ frame: false })
    expect(resolveWindowChrome('linux')).toEqual({ frame: false })
    expect(resolveWindowChrome('freebsd')).toEqual({ frame: false })
  })

  it('shows native macOS lights only while fullscreen', () => {
    const calls: boolean[] = []
    const win = { setWindowButtonVisibility: (visible: boolean) => { calls.push(visible) } }
    syncDarwinTrafficLights(win, false)
    syncDarwinTrafficLights(win, true)
    expect(calls).toEqual([false, true])
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
