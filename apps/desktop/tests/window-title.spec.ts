/**
 * Unit tests for the pinned native window title. Electron is mocked away by
 * stubbing the listener surface: the assertions pin the exact product string
 * and that page titles can never adopt into the native title.
 */
import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { pinWindowTitle, resolveDesktopWindowTitle } from '../src/main/desktop/window-title.ts'

/** A listener-collecting window stub standing in for Electron's BrowserWindow. */
function fakeWindow(): { win: BrowserWindow; emit: (event: string, payload: unknown) => void } {
  const listeners = new Map<string, Array<(payload: unknown) => void>>()
  const win = {
    on(event: string, listener: (payload: unknown) => void): void {
      const existing = listeners.get(event) ?? []
      existing.push(listener)
      listeners.set(event, existing)
    },
  } as unknown as BrowserWindow
  return {
    win,
    emit: (event, payload) => {
      for (const listener of listeners.get(event) ?? []) listener(payload)
    },
  }
}

describe('pinned desktop window title', () => {
  it('uses the OEM development name and falls back to the packaged application name', () => {
    expect(resolveDesktopWindowTitle('Electron', { DSH_DESKTOP_PRODUCT_NAME: '深度Worker' })).toBe('深度Worker')
    expect(resolveDesktopWindowTitle('Packaged Product', {})).toBe('Packaged Product')
  })

  it('prevents every page-title-updated so the constructor title survives', () => {
    const { win, emit } = fakeWindow()
    pinWindowTitle(win)
    const preventDefault = vi.fn()
    emit('page-title-updated', { title: '会话名 - 深度Worker', preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })
})
