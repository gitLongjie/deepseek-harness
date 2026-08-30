/** Native desktop notification for a completed agent turn. */
import { Notification, shell, type BrowserWindow } from 'electron'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { DesktopLocaleId } from './locales.ts'

/** Native completion notification copy. */
const COPY: Record<DesktopLocaleId, { title: string; body: string }> = {
  zh: { title: '深度Work', body: '回答已完成' },
  en: { title: '深度Work', body: 'Answer completed' },
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
  try {
    if (Notification.isSupported()) {
      const notification = new Notification({ title: copy.title, body: copy.body })
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
