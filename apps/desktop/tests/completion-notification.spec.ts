import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { beep, isSupported, notification, on, show, handleActivation } = vi.hoisted(() => ({
  beep: vi.fn(),
  isSupported: vi.fn(() => true),
  notification: vi.fn(function (this: object, _options: object) {
    return Object.assign(this, { show, on })
  }),
  on: vi.fn(),
  show: vi.fn(),
  handleActivation: vi.fn(),
}))

vi.mock('electron', () => ({
  Notification: Object.assign(notification, { isSupported, handleActivation }),
  shell: { beep },
}))

import { installNotificationActivation, notifyTurnCompletion } from '../src/main/desktop/completion-notification.ts'
import type { BrowserWindow } from 'electron'

const realPlatform = process.platform

/** Pin process.platform for the current test; restored in afterEach. */
function stubPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value })
}

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
  beforeEach(() => {
    vi.clearAllMocks()
    isSupported.mockReturnValue(true)
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform })
  })

  it('notifies and beeps only when an answer ends while the window is inactive', () => {
    notifyTurnCompletion(windowStub(), 'zh', 'session-1', event('completed'))
    expect(notification).toHaveBeenCalledWith({ title: '民大工作台', body: '回答已完成' })
    expect(beep).toHaveBeenCalledOnce()
  })

  it('uses a system notification for a model response error', () => {
    notifyTurnCompletion(windowStub(), 'zh', 'session-error', errorEvent('模型服务暂时不可用'))
    expect(notification).toHaveBeenCalledWith({ title: '民大工作台', body: '模型回答失败：模型服务暂时不可用' })
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

  it('registers the win32 centralized activation handler without an instance click subscription', () => {
    stubPlatform('win32')
    const win = windowStub()
    installNotificationActivation(() => win)
    expect(handleActivation).toHaveBeenCalledOnce()
    notifyTurnCompletion(win, 'zh', 'session-1', event('completed'))
    expect(on).not.toHaveBeenCalled()
  })

  it('shows and focuses the window when the centralized activation handler fires', () => {
    stubPlatform('win32')
    const win = windowStub()
    installNotificationActivation(() => win)
    const callback = handleActivation.mock.calls[0]?.[0] as (() => void) | undefined
    callback?.()
    expect(win.show).toHaveBeenCalledOnce()
    expect(win.focus).toHaveBeenCalledOnce()
  })

  it('sends the session id to the renderer when the activation handler fires after a notification', () => {
    stubPlatform('win32')
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
    stubPlatform('win32')
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
    stubPlatform('win32')
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
    stubPlatform('win32')
    installNotificationActivation(() => undefined)
    const callback = handleActivation.mock.calls[0]?.[0] as (() => void) | undefined
    // Should not throw
    callback?.()
    expect(handleActivation).toHaveBeenCalledOnce()
  })

  it('does not register activation handler when notifications are unsupported', () => {
    stubPlatform('win32')
    isSupported.mockReturnValue(false)
    installNotificationActivation(() => windowStub())
    expect(handleActivation).not.toHaveBeenCalled()
  })

  it('never touches the win32-only handleActivation on macOS', () => {
    stubPlatform('darwin')
    expect(() => installNotificationActivation(() => windowStub())).not.toThrow()
    expect(handleActivation).not.toHaveBeenCalled()
  })

  it('focuses the window and opens the session through the instance click on macOS', () => {
    stubPlatform('darwin')
    const win = windowStub()
    notifyTurnCompletion(win, 'zh', 'session-42', event('completed'))
    expect(on).toHaveBeenCalledWith('click', expect.any(Function))
    const callback = on.mock.calls[0]?.[1] as (() => void) | undefined
    callback?.()
    expect(win.show).toHaveBeenCalledOnce()
    expect(win.focus).toHaveBeenCalledOnce()
    expect(win.webContents.send).toHaveBeenCalledWith('dsh:notification:open-session', 'session-42')
  })

  it('uses the instance click path on Linux too', () => {
    stubPlatform('linux')
    const win = windowStub()
    notifyTurnCompletion(win, 'zh', 'session-1', event('completed'))
    expect(on).toHaveBeenCalledWith('click', expect.any(Function))
    expect(handleActivation).not.toHaveBeenCalled()
  })

  it('ignores an instance click after the window was destroyed', () => {
    stubPlatform('darwin')
    const win = {
      isDestroyed: () => true,
      isFocused: () => false,
      isMinimized: () => false,
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      webContents: { send: vi.fn() },
    } as unknown as BrowserWindow
    notifyTurnCompletion(win, 'zh', 'session-1', event('completed'))
    const callback = on.mock.calls[0]?.[1] as (() => void) | undefined
    callback?.()
    expect(win.show).not.toHaveBeenCalled()
  })
})
