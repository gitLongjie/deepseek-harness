/** Native desktop notification for an agent turn that ended in the background. */
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
 * Notify and beep when a live turn finishes while the desktop window is away.
 * @param win - The desktop window receiving the session.
 * @param locale - Current desktop shell locale.
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

  const copy = COPY[locale]
  const body = event.data.reason.kind === 'error'
    ? copy.error(event.data.reason.error.message)
    : copy.completed
  try {
    if (Notification.isSupported()) {
      const notification = new Notification({ title: copy.title, body })
      notification.on('click', () => {
        if (win.isDestroyed()) return
        win.show()
        win.focus()
        win.webContents.send('dsh:notification:open-session', sessionId)
      })
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
