/**
 * In-app update badge: a "new version" pill beside the signed-in account row
 * in the sidebar footer. The main process pushes update status over
 * `dsh:update:status`; clicking the pill asks it to prompt the download or to
 * restart and apply, over `dsh:update:action`. Desktop-only — the page-world
 * script lives in the render bundle, never in the shared web app.
 * @module @deepseek-ai/dsh-desktop/render/update-badge
 */

/** The IPC channels the badge uses (main-process side in updater.ts). */
export const UPDATE_STATUS_CHANNEL = 'dsh:update:status'
export const UPDATE_ACTION_CHANNEL = 'dsh:update:action'

/** Locale change channel reused from title-bar for copy re-render. */
const LOCALE_CHANGE_CHANNEL = 'dsh:locale:change'

/** The generic preload bridge the badge rides (already exposed page-world). */
type IpcSender = {
  send(channel: string, payload?: unknown): void
  on?(channel: string, listener: (payload: unknown) => void): () => void
}

/** Badge chrome: a compact pill that flips to an accent state when ready. */
const STYLE_TEXT = `
#dsh-update-badge {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  margin-left: 8px;
  padding: 2px 8px;
  border: 1px solid var(--dsw-alias-border-subtle, rgba(0, 0, 0, 0.12));
  border-radius: 999px;
  background: var(--dsw-alias-bg-surface, #fff);
  color: var(--dsw-alias-label-primary, #0f1115);
  font: inherit;
  font-size: 11px;
  line-height: 16px;
  cursor: pointer;
  white-space: nowrap;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
}
#dsh-update-badge:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
}
#dsh-update-badge.dsh-update-ready {
  border-color: var(--dsw-alias-accent, #6187d8);
  color: var(--dsw-alias-accent, #6187d8);
}
`

/** Badge copy; the version interpolates into the available label. */
const UPDATE_BADGE_LOCALES = {
  zh: {
    available: (version: string): string => `新版本 ${version}`,
    downloaded: '重启更新',
  },
  en: {
    available: (version: string): string => `New version ${version}`,
    downloaded: 'Restart to update',
  },
} as const

type UpdateBadgeLocale = keyof typeof UPDATE_BADGE_LOCALES

/** The wire status payload sent by the main process. */
interface UpdateStatusPayload {
  status?: string
  version?: string
}

/**
 * Install the update badge into the sidebar footer's account row. The main
 * process seeds/updates status over `dsh:update:status`; the badge shows only
 * once an update is known and the account slot has mounted (React renders it
 * asynchronously, so a MutationObserver waits for the slot).
 * @param doc - the live document.
 * @param ipc - the preload bridge.
 */
export function installUpdateBadge(doc: Document, ipc: IpcSender): void {
  const style = doc.createElement('style')
  style.id = 'dsh-update-badge-style'
  style.textContent = STYLE_TEXT
  doc.head.appendChild(style)

  let badge: HTMLButtonElement | undefined
  let locale: UpdateBadgeLocale = 'zh'
  let ready = false
  let version: string | undefined

  function renderBadge(): void {
    if (badge === undefined || version === undefined) return
    const strings = UPDATE_BADGE_LOCALES[locale]
    badge.textContent = ready ? strings.downloaded : strings.available(version)
    badge.classList.toggle('dsh-update-ready', ready)
  }

  function ensureBadge(): void {
    if (badge !== undefined) return
    const anchor = doc.querySelector<HTMLElement>('[data-slot="sidebar.footer.action"]')
    if (anchor === null) return
    const button = doc.createElement('button')
    button.type = 'button'
    button.id = 'dsh-update-badge'
    button.setAttribute('aria-label', 'update')
    button.addEventListener('click', () => {
      ipc.send(UPDATE_ACTION_CHANNEL, { action: ready ? 'install' : 'prompt' })
    })
    anchor.appendChild(button)
    badge = button
    renderBadge()
  }

  ipc.on?.(UPDATE_STATUS_CHANNEL, (payload: unknown) => {
    const p = (payload ?? {}) as UpdateStatusPayload
    if (p.status === 'available' && typeof p.version === 'string') {
      version = p.version
      ready = false
      ensureBadge()
      renderBadge()
    } else if (p.status === 'downloaded' && typeof p.version === 'string') {
      version = p.version
      ready = true
      ensureBadge()
      renderBadge()
    }
  })

  ipc.on?.(LOCALE_CHANGE_CHANNEL, (payload: unknown) => {
    locale = payload === 'en' ? 'en' : 'zh'
    renderBadge()
  })

  // The sidebar mounts asynchronously under React; wait for the account-row
  // slot to appear before injecting the badge.
  const observer = new MutationObserver(() => { ensureBadge() })
  observer.observe(doc.documentElement, { childList: true, subtree: true })
}
