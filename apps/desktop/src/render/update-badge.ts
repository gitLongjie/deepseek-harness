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

/** Badge chrome: a rounded-rectangle accent tag; it shows download progress
    while the update streams and flips to a green "restart to update" tag once
    the download is ready. */
const STYLE_TEXT = `
#dsh-update-badge {
  display: inline-flex;
  align-items: center;
  align-self: center;
  flex-shrink: 0;
  margin-left: 10px;
  padding: 0 5px;
  border: none;
  border-radius: 4px;
  background: var(--dsw-alias-accent, #6187d8);
  color: #fff;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  line-height: 16px;
  position: relative;
  top: 2px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
}
#dsh-update-badge:hover {
  filter: brightness(1.12);
}
#dsh-update-badge.dsh-update-downloading {
  cursor: default;
  background: var(--dsw-alias-accent-muted, #7c95c9);
}
#dsh-update-badge.dsh-update-ready {
  background: #2f9e44;
}
`

/** Badge copy; the version interpolates into the available label. */
const UPDATE_BADGE_LOCALES = {
  zh: {
    available: '更新',
    downloaded: '重启更新',
    downloading: (percent: number): string => `下载中 ${percent}%`,
  },
  en: {
    available: 'Update',
    downloaded: 'Restart to update',
    downloading: (percent: number): string => `Downloading ${percent}%`,
  },
} as const

type UpdateBadgeLocale = keyof typeof UPDATE_BADGE_LOCALES

/** The wire status payload sent by the main process. */
interface UpdateStatusPayload {
  status?: string
  version?: string
  percent?: number
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
  let downloading = false
  let percent = 0
  let version: string | undefined

  function renderBadge(): void {
    if (badge === undefined || version === undefined) return
    const strings = UPDATE_BADGE_LOCALES[locale]
    badge.textContent = downloading
      ? strings.downloading(percent)
      : ready ? strings.downloaded : strings.available
    badge.title = version
    badge.classList.toggle('dsh-update-downloading', downloading)
    badge.classList.toggle('dsh-update-ready', ready)
  }

  function ensureBadge(): void {
    // Only mount the pill once the main process has announced an update; the
    // observer fires on ordinary sidebar mounts too, without any status.
    if (badge !== undefined || version === undefined) return
    const anchor = doc.querySelector<HTMLElement>('[data-slot="sidebar.footer.action"]')
    if (anchor === null) return
    const button = doc.createElement('button')
    button.type = 'button'
    button.id = 'dsh-update-badge'
    button.setAttribute('aria-label', 'update')
    button.addEventListener('click', () => {
      if (downloading) return
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
      downloading = false
      ensureBadge()
      renderBadge()
    } else if (p.status === 'progressing' && typeof p.percent === 'number') {
      if (version === undefined) return
      downloading = true
      percent = p.percent
      ensureBadge()
      renderBadge()
    } else if (p.status === 'downloaded' && typeof p.version === 'string') {
      version = p.version
      ready = true
      downloading = false
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
