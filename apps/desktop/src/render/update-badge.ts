/**
 * In-app update control in the desktop title bar. The main process pushes
 * update status over `dsh:update:status`; clicking the control downloads,
 * retries, or restarts and applies over `dsh:update:action`. Desktop-only — the page-world
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

/** Compact title-bar update control with an inline download progress fill. */
const STYLE_TEXT = `
#dsh-update-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: center;
  flex-shrink: 0;
  min-width: 76px;
  max-width: 136px;
  height: 24px;
  margin-right: 6px;
  padding: 0 9px;
  border: none;
  border-radius: 4px;
  background: var(--dsw-alias-accent, #6187d8);
  color: #fff;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  line-height: 24px;
  position: relative;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  -webkit-app-region: no-drag;
}
#dsh-update-badge:hover {
  filter: brightness(1.12);
}
#dsh-update-badge:disabled {
  filter: none;
}
#dsh-update-badge.dsh-update-downloading {
  cursor: default;
  background: linear-gradient(
    to right,
    var(--dsw-alias-accent, #6187d8) var(--dsh-update-progress),
    var(--dsw-alias-accent-muted, #7c95c9) var(--dsh-update-progress)
  );
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
    retry: '重试更新',
    checking: '检查中',
    installing: '正在启动安装',
    downloading: (percent: number): string => `下载中 ${percent}%`,
    downloadLabel: (version: string): string => `下载版本 ${version}`,
    installLabel: (version: string): string => `安装版本 ${version}`,
  },
  en: {
    available: 'Update',
    downloaded: 'Restart to update',
    retry: 'Retry update',
    checking: 'Checking',
    installing: 'Starting installer',
    downloading: (percent: number): string => `Downloading ${percent}%`,
    downloadLabel: (version: string): string => `Download version ${version}`,
    installLabel: (version: string): string => `Install version ${version}`,
  },
} as const

type UpdateBadgeLocale = keyof typeof UPDATE_BADGE_LOCALES

/** The wire status payload sent by the main process. */
interface UpdateStatusPayload {
  status?: string
  version?: string
  percent?: number
}

type UpdateBadgeState = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error'

/**
 * Install the update control into the desktop title bar. The main
 * process seeds/updates status over `dsh:update:status`; the badge shows only
 * once an update or error is known. A MutationObserver handles the title bar's
 * deferred head-phase mount.
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
  let state: UpdateBadgeState = 'idle'
  let percent = 0
  let version: string | undefined

  function renderBadge(): void {
    if (badge === undefined) return
    const strings = UPDATE_BADGE_LOCALES[locale]
    badge.textContent = state === 'downloading'
      ? strings.downloading(percent)
      : state === 'downloaded' ? strings.downloaded
        : state === 'installing' ? strings.installing
          : state === 'error' ? strings.retry
            : state === 'checking' ? strings.checking : strings.available
    badge.title = version ?? strings.retry
    badge.disabled = state === 'downloading' || state === 'checking' || state === 'installing'
    badge.classList.toggle('dsh-update-downloading', state === 'downloading')
    badge.classList.toggle('dsh-update-ready', state === 'downloaded')
    if (state === 'downloading') {
      badge.setAttribute('role', 'progressbar')
      badge.setAttribute('aria-valuemin', '0')
      badge.setAttribute('aria-valuemax', '100')
      badge.setAttribute('aria-valuenow', String(percent))
      badge.style.setProperty('--dsh-update-progress', `${percent}%`)
    } else {
      badge.removeAttribute('role')
      badge.removeAttribute('aria-valuemin')
      badge.removeAttribute('aria-valuemax')
      badge.removeAttribute('aria-valuenow')
      badge.style.removeProperty('--dsh-update-progress')
      const labelVersion = version ?? ''
      badge.setAttribute('aria-label', state === 'downloaded'
        ? strings.installLabel(labelVersion)
        : state === 'error' ? strings.retry : strings.downloadLabel(labelVersion))
    }
  }

  function ensureBadge(): void {
    if (badge !== undefined || state === 'idle') return
    const anchor = doc.querySelector<HTMLElement>('.dsh-titlebar-update-slot')
    if (anchor === null) return
    const button = doc.createElement('button')
    button.type = 'button'
    button.id = 'dsh-update-badge'
    button.addEventListener('click', () => {
      if (state === 'downloading' || state === 'installing') return
      const action = state === 'downloaded' ? 'install' : state === 'error' ? 'check' : 'download'
      ipc.send(UPDATE_ACTION_CHANNEL, { action })
    })
    anchor.appendChild(button)
    badge = button
    renderBadge()
  }

  ipc.on?.(UPDATE_STATUS_CHANNEL, (payload: unknown) => {
    const p = (payload ?? {}) as UpdateStatusPayload
    if (p.status === 'available' && typeof p.version === 'string') {
      version = p.version
      state = 'available'
      ensureBadge()
      renderBadge()
    } else if (p.status === 'progressing' && typeof p.percent === 'number') {
      if (version === undefined) return
      state = 'downloading'
      percent = Math.min(100, Math.max(0, Math.round(p.percent)))
      ensureBadge()
      renderBadge()
    } else if (p.status === 'downloaded' && typeof p.version === 'string') {
      version = p.version
      state = 'downloaded'
      ensureBadge()
      renderBadge()
    } else if (p.status === 'installing') {
      state = 'installing'
      ensureBadge()
      renderBadge()
    } else if (p.status === 'error') {
      state = 'error'
      ensureBadge()
      renderBadge()
    } else if (p.status === 'checking') {
      state = 'checking'
      ensureBadge()
      renderBadge()
    } else if (p.status === 'idle') {
      state = 'idle'
      badge?.remove()
      badge = undefined
      version = undefined
    }
  })

  ipc.on?.(LOCALE_CHANGE_CHANNEL, (payload: unknown) => {
    locale = payload === 'en' ? 'en' : 'zh'
    renderBadge()
  })

  // The title bar may mount after this head script reaches the document.
  const observer = new MutationObserver(() => { ensureBadge() })
  observer.observe(doc.documentElement, { childList: true, subtree: true })
}
