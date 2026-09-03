import { beforeEach, describe, expect, it, vi } from 'vitest'

const { beep, isSupported, notification } = vi.hoisted(() => ({
  beep: vi.fn(),
  isSupported: vi.fn(() => true),
  notification: vi.fn(function (this: object, _title: string, _options: object) {
    return Object.assign(this, { show: vi.fn(), on: vi.fn() })
  }),
}))

vi.mock('electron', () => ({
  Notification: Object.assign(notification, { isSupported }),
  shell: { beep },
}))

import { notifyTurnCompletion } from '../src/main/desktop/completion-notification.ts'
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

  it('opens the completed session when the notification is clicked', () => {
    const win = windowStub()
    notifyTurnCompletion(win, 'zh', 'session-42', event('completed'))
    const instance = notification.mock.results[0]?.value as { on: ReturnType<typeof vi.fn> }
    const click = instance.on.mock.calls[0]?.[1] as (() => void) | undefined
    click?.()
    expect(win.show).toHaveBeenCalledOnce()
    expect(win.focus).toHaveBeenCalledOnce()
    expect(win.webContents.send).toHaveBeenCalledWith('dsh:notification:open-session', 'session-42')
  })
})
