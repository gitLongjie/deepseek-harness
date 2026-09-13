import { beforeEach, describe, expect, it, vi } from 'vitest'

const { beep, isSupported, notification, handleActivation } = vi.hoisted(() => ({
  beep: vi.fn(),
  isSupported: vi.fn(() => true),
  notification: vi.fn(function (this: object, _options: object) {
    return Object.assign(this, { show: vi.fn(), on: vi.fn() })
  }),
  handleActivation: vi.fn(),
}))

vi.mock('electron', () => ({
  Notification: Object.assign(notification, { isSupported, handleActivation }),
  shell: { beep },
}))

import { installNotificationActivation, notifyTurnCompletion } from '../src/main/desktop/completion-notification.ts'
import type { BrowserWindow } from 'electron'

function event(reason: string): never {
  return { type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: reason } } } as never
}

function errorEvent(message: string): never {
  return { type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'error', error: { message, code: 'SERVER' } } } } as never
}

function windowStub(focused = false): BrowserWindow {
  return {
    isDestroyed: () => false,
    isFocused: () => focused,
    isMinimized: () => false,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: { send: vi.fn() },
  } as unknown as BrowserWindow
}

describe('desktop completion notification', () => {
  beforeEach(() => { vi.clearAllMocks(); isSupported.mockReturnValue(true) })

  it('notifies and beeps only when an answer ends while the window is inactive', () => {
    notifyTurnCompletion(windowStub(), 'zh', 'session-1', event('completed'))
    expect(notification).toHaveBeenCalledWith({ title: '深度Work', body: '回答已完成' })
    expect(beep).toHaveBeenCalledOnce()
  })

  it('uses a system notification for a model response error', () => {
    notifyTurnCompletion(windowStub(), 'zh', 'session-error', errorEvent('模型服务暂时不可用'))
    expect(notification).toHaveBeenCalledWith({ title: '深度Work', body: '模型回答失败：模型服务暂时不可用' })
    expect(beep).toHaveBeenCalledOnce()
  })

  it('stays silent for focused windows, aborted turns, and unsupported notifications', () => {
    notifyTurnCompletion(windowStub(true), 'en', 'session-1', event('completed'))
    notifyTurnCompletion(windowStub(), 'en', 'session-1', event('aborted'))
    isSupported.mockReturnValue(false)
    notifyTurnCompletion(windowStub(), 'en', 'session-1', event('completed'))
    expect(notification).not.toHaveBeenCalled()
    expect(beep).toHaveBeenCalledOnce()
  })

  it('registers a centralized activation handler that shows and focuses the window', () => {
    const win = windowStub()
    installNotificationActivation(() => win)
    expect(handleActivation).toHaveBeenCalledOnce()
    const callback = handleActivation.mock.calls[0]?.[0] as (() => void) | undefined
    callback?.()
    expect(win.show).toHaveBeenCalledOnce()
    expect(win.focus).toHaveBeenCalledOnce()
  })

  it('sends the session id to the renderer when the activation handler fires after a notification', () => {
    const win = windowStub()
    installNotificationActivation(() => win)
    notifyTurnCompletion(win, 'zh', 'session-42', event('completed'))
    const callback = handleActivation.mock.calls[0]?.[0] as (() => void) | undefined
    callback?.()
    expect(win.show).toHaveBeenCalledOnce()
    expect(win.focus).toHaveBeenCalledOnce()
    expect(win.webContents.send).toHaveBeenCalledWith('dsh:notification:open-session', 'session-42')
  })

  it('restores a minimized window on activation', () => {
    const win = {
      isDestroyed: () => false,
      isFocused: () => false,
      isMinimized: () => true,
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      webContents: { send: vi.fn() },
    } as unknown as BrowserWindow
    installNotificationActivation(() => win)
    const callback = handleActivation.mock.calls[0]?.[0] as (() => void) | undefined
    callback?.()
    expect(win.restore).toHaveBeenCalledOnce()
    expect(win.show).toHaveBeenCalledOnce()
  })

  it('skips activation when the window is destroyed', () => {
    const win = {
      isDestroyed: () => true,
      isFocused: () => false,
      isMinimized: () => false,
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      webContents: { send: vi.fn() },
    } as unknown as BrowserWindow
    installNotificationActivation(() => win)
    const callback = handleActivation.mock.calls[0]?.[0] as (() => void) | undefined
    callback?.()
    expect(win.show).not.toHaveBeenCalled()
  })

  it('skips activation when no window is available', () => {
    installNotificationActivation(() => undefined)
    const callback = handleActivation.mock.calls[0]?.[0] as (() => void) | undefined
    // Should not throw
    callback?.()
    expect(handleActivation).toHaveBeenCalledOnce()
  })

  it('does not register activation handler when notifications are unsupported', () => {
    isSupported.mockReturnValue(false)
    installNotificationActivation(() => windowStub())
    expect(handleActivation).not.toHaveBeenCalled()
  })
})
