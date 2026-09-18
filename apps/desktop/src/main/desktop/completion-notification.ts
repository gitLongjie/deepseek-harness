/**
 * Native desktop notification for an agent turn that ended in the background.
 *
 * On Windows, clicking a Toast notification can activate the app through the OS
 * shell (AppUserModelId) rather than firing the Electron Notification instance's
 * `click` event. The win32-only static `Notification.handleActivation` covers
 * every activation path — including cold starts where no in-memory Notification
 * object exists — so the centralized callback registered by
 * `installNotificationActivation` is the authoritative click handler there, and
 * instance-level `notification.on('click')` is intentionally not used to avoid
 * double-firing. On macOS and Linux `handleActivation` does not exist, so the
 * instance `click` event is the only activation path and notifyTurnCompletion
 * wires it there.
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
 * Bring the desktop window to the front and tell the renderer which session to
 * open. Shared by the win32 centralized activation handler and the non-Windows
 * instance `click` handler so both activation paths behave identically.
 *
 * @param win - the current main window (may be undefined or already destroyed).
 * @param sessionId - the session to open, when the activation follows a shown notification.
 */
function revealSession(win: BrowserWindow | undefined, sessionId: string | undefined): void {
  if (win === undefined || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  if (sessionId !== undefined) {
    win.webContents.send('dsh:notification:open-session', sessionId)
  }
}

/**
 * Register the centralized notification-activation callback. Must be called once
 * after `app.whenReady()` and before any notifications are shown. Windows only:
 * `Notification.handleActivation` is a win32-only Electron static, and calling
 * it elsewhere crashes startup with `TypeError: ... is not a function`. The
 * callback fires for every notification click regardless of whether the
 * originating Notification object is still alive, and also replays activations
 * that occurred before registration (cold-start from a notification click). On
 * macOS and Linux this is a no-op; notifyTurnCompletion wires the instance
 * `click` event instead.
 *
 * @param getWin - returns the current main window (may be undefined during early boot).
 */
export function installNotificationActivation(
  getWin: () => BrowserWindow | undefined,
): void {
  if (process.platform !== 'win32' || !Notification.isSupported()) return
  Notification.handleActivation(() => {
    revealSession(getWin(), lastNotifiedSessionId)
  })
}

/**
 * Notify and beep when a live turn finishes while the desktop window is away.
 * On Windows the click-to-focus behavior is handled centrally by
 * `installNotificationActivation`; elsewhere the instance `click` event is the
 * only activation path, so this function wires it to the same focus logic.
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
      if (process.platform !== 'win32') {
        notification.on('click', () => revealSession(win, sessionId))
      }
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
