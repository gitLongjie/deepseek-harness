/**
 * Unit tests for the pinned native window title. Electron is mocked away by
 * stubbing the listener surface: the assertions pin the exact product string
 * and that page titles can never adopt into the native title.
 */
import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { DESKTOP_WINDOW_TITLE, pinWindowTitle } from '../src/main/desktop/window-title.ts'

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
  it('pins exactly the bare product name', () => {
    expect(DESKTOP_WINDOW_TITLE).toBe('深度Works')
  })

  it('prevents every page-title-updated so the constructor title survives', () => {
    const { win, emit } = fakeWindow()
    pinWindowTitle(win)
    const preventDefault = vi.fn()
    emit('page-title-updated', { title: '会话名 — 深度Works Local Build', preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })
})
