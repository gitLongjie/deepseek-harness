/**
 * Native desktop notification for an agent turn that ended in the background.
 *
 * On Windows, clicking a Toast notification can activate the app through the OS
 * shell (AppUserModelId) rather than firing the Electron Notification instance's
 * `click` event. `Notification.handleActivation` covers every activation path —
 * including cold starts where no in-memory Notification object exists — so the
 * centralized callback registered by `installNotificationActivation` is the
 * authoritative click handler. Instance-level `notification.on('click')` is
 * intentionally not used to avoid double-firing on Windows.
 */
import { Notification, shell, type BrowserWindow } from 'electron'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { DesktopLocaleId } from './locales.ts'

/** Native turn-end notification copy. */
const COPY: Record<DesktopLocaleId, {
  title: string
  completed: string
  error: (message: string) => string
}> = {
  zh: { title: '深度Work', completed: '回答已完成', error: message => `模型回答失败：${message}` },
  en: { title: '深度Work', completed: 'Answer completed', error: message => `Model response failed: ${message}` },
}

/** Reasons that represent a response that should not alert the operator. */
const SILENT_REASONS = new Set(['aborted', 'cancelled', 'interrupted'])

/**
 * The session id of the most recently shown completion notification. The
 * centralized activation handler reads this to tell the renderer which session
 * to open. A single slot is sufficient because only one turn-end notification is
 * actionable at a time — the user clicks the latest one.
 */
let lastNotifiedSessionId: string | undefined

/**
 * Register the centralized notification-activation callback. Must be called once
 * after `app.whenReady()` and before any notifications are shown. The callback
 * fires for every notification click regardless of whether the originating
 * Notification object is still alive, and also replays activations that occurred
 * before registration (cold-start from a notification click).
 *
 * @param getWin - returns the current main window (may be undefined during early boot).
 */
export function installNotificationActivation(
  getWin: () => BrowserWindow | undefined,
): void {
  if (!Notification.isSupported()) return
  Notification.handleActivation(() => {
    const win = getWin()
    if (win === undefined || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    if (lastNotifiedSessionId !== undefined) {
      win.webContents.send('dsh:notification:open-session', lastNotifiedSessionId)
    }
  })
}

/**
 * Notify and beep when a live turn finishes while the desktop window is away.
 * The click-to-focus behavior is handled centrally by
 * `installNotificationActivation`; this function only creates and shows the
 * notification and plays the completion beep.
 *
 * @param win - The desktop window receiving the session.
 * @param locale - Current desktop shell locale.
 * @param sessionId - The session whose turn ended; stored for the activation handler.
 * @param event - Newly committed session event.
 * @returns nothing; native notification failures are intentionally isolated.
 */
export function notifyTurnCompletion(
  win: BrowserWindow,
  locale: DesktopLocaleId,
  sessionId: string,
  event: SessionEvent,
): void {
  if (event.type !== 'turn/end' || SILENT_REASONS.has(event.data.reason.kind)) return
  if (win.isDestroyed() || win.isFocused()) return

  lastNotifiedSessionId = sessionId

  const copy = COPY[locale]
  const body = event.data.reason.kind === 'error'
    ? copy.error(event.data.reason.error.message)
    : copy.completed
  try {
    if (Notification.isSupported()) {
      const notification = new Notification({ title: copy.title, body })
      notification.show()
    }
  } catch (error) {
    console.warn('desktop: completion notification failed:', error)
  }
  try {
    shell.beep()
  } catch (error) {
    console.warn('desktop: completion beep failed:', error)
  }
}
