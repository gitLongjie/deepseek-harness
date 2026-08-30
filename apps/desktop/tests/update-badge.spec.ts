// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installUpdateBadge, UPDATE_ACTION_CHANNEL, UPDATE_STATUS_CHANNEL } from '../src/render/update-badge.ts'

/** A preload-like bridge capturing `on` listeners and `send` calls. */
function makeIpc(): {
  ipc: { send: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> }
  listeners: Map<string, (payload: unknown) => void>
} {
  const listeners = new Map<string, (payload: unknown) => void>()
  const ipc = {
    send: vi.fn(),
    on: vi.fn((channel: string, listener: (payload: unknown) => void) => {
      listeners.set(channel, listener)
      return () => { listeners.delete(channel) }
    }),
  }
  return { ipc, listeners }
}

/** Mount the title-bar slot the update control owns. */
function mountAnchor(): HTMLElement {
  const anchor = document.createElement('span')
  anchor.className = 'dsh-titlebar-update-slot'
  document.body.appendChild(anchor)
  return anchor
}

/** Flush the MutationObserver microtask so ensureBadge runs. */
function flush(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0) })
}

beforeEach(() => {
  document.head.replaceChildren()
  document.body.replaceChildren()
})

describe('desktop update badge', () => {
  it('injects the badge stylesheet and listens to both channels', () => {
    const { ipc } = makeIpc()
    installUpdateBadge(document, ipc)
    expect(document.getElementById('dsh-update-badge-style')).not.toBeNull()
    expect(ipc.on).toHaveBeenCalledWith(UPDATE_STATUS_CHANNEL, expect.any(Function))
    expect(ipc.on).toHaveBeenCalledWith('dsh:locale:change', expect.any(Function))
  })

  it('shows an update button in the title bar once an update is available', async () => {
    const { ipc, listeners } = makeIpc()
    installUpdateBadge(document, ipc)
    mountAnchor()
    listeners.get(UPDATE_STATUS_CHANNEL)!({ status: 'available', version: '1.2.3' })
    await flush()
    const badge = document.getElementById('dsh-update-badge')
    expect(badge).not.toBeNull()
    expect(badge?.textContent).toBe('更新')
    expect(badge?.getAttribute('title')).toBe('1.2.3')
    expect(badge?.getAttribute('aria-label')).toBe('下载版本 1.2.3')
    expect(badge?.classList.contains('dsh-update-ready')).toBe(false)
  })

  it('does not mount the badge before any update status arrives', async () => {
    const { ipc } = makeIpc()
    installUpdateBadge(document, ipc)
    mountAnchor()
    await flush()
    expect(document.getElementById('dsh-update-badge')).toBeNull()
  })

  it('shows download progress without sending an action on click', async () => {
    const { ipc, listeners } = makeIpc()
    installUpdateBadge(document, ipc)
    mountAnchor()
    listeners.get(UPDATE_STATUS_CHANNEL)!({ status: 'available', version: '1.2.3' })
    await flush()
    listeners.get(UPDATE_STATUS_CHANNEL)!({ status: 'progressing', percent: 42 })
    await flush()
    const badge = document.getElementById('dsh-update-badge')
    expect(badge?.textContent).toBe('下载中 42%')
    expect(badge?.classList.contains('dsh-update-downloading')).toBe(true)
    expect(badge).toHaveProperty('disabled', true)
    expect(badge?.getAttribute('role')).toBe('progressbar')
    expect(badge?.getAttribute('aria-valuemin')).toBe('0')
    expect(badge?.getAttribute('aria-valuemax')).toBe('100')
    expect(badge?.getAttribute('aria-valuenow')).toBe('42')
    badge!.click()
    expect(ipc.send).not.toHaveBeenCalled()
  })

  it('starts the download directly when clicked while available', async () => {
    const { ipc, listeners } = makeIpc()
    installUpdateBadge(document, ipc)
    mountAnchor()
    listeners.get(UPDATE_STATUS_CHANNEL)!({ status: 'available', version: '1.2.3' })
    await flush()
    document.getElementById('dsh-update-badge')!.click()
    expect(ipc.send).toHaveBeenCalledWith(UPDATE_ACTION_CHANNEL, { action: 'download' })
  })

  it('clamps download progress to a stable percentage', async () => {
    const { ipc, listeners } = makeIpc()
    installUpdateBadge(document, ipc)
    mountAnchor()
    listeners.get(UPDATE_STATUS_CHANNEL)!({ status: 'available', version: '1.2.3' })
    await flush()
    listeners.get(UPDATE_STATUS_CHANNEL)!({ status: 'progressing', percent: 118.7 })
    expect(document.getElementById('dsh-update-badge')?.textContent).toBe('下载中 100%')
    expect(document.getElementById('dsh-update-badge')?.getAttribute('aria-valuenow')).toBe('100')
  })

  it('flips to a restart label and sends an install action when downloaded', async () => {
    const { ipc, listeners } = makeIpc()
    installUpdateBadge(document, ipc)
    mountAnchor()
    listeners.get(UPDATE_STATUS_CHANNEL)!({ status: 'available', version: '1.2.3' })
    await flush()
    listeners.get(UPDATE_STATUS_CHANNEL)!({ status: 'downloaded', version: '1.2.3' })
    await flush()
    const badge = document.getElementById('dsh-update-badge')
    expect(badge?.textContent).toBe('重启更新')
    expect(badge?.classList.contains('dsh-update-ready')).toBe(true)
    badge!.click()
    expect(ipc.send).toHaveBeenCalledWith(UPDATE_ACTION_CHANNEL, { action: 'install' })
  })

  it('shows immediate disabled feedback while the native installer starts', async () => {
    const { ipc, listeners } = makeIpc()
    installUpdateBadge(document, ipc)
    mountAnchor()
    listeners.get(UPDATE_STATUS_CHANNEL)!({ status: 'downloaded', version: '1.2.3' })
    await flush()
    listeners.get(UPDATE_STATUS_CHANNEL)!({ status: 'installing' })

    const badge = document.getElementById('dsh-update-badge') as HTMLButtonElement
    expect(badge.textContent).toBe('正在启动安装')
    expect(badge.disabled).toBe(true)
    badge.click()
    expect(ipc.send).not.toHaveBeenCalled()
  })

  it('renders English copy and follows the locale channel', async () => {
    const { ipc, listeners } = makeIpc()
    installUpdateBadge(document, ipc)
    mountAnchor()
    listeners.get(UPDATE_STATUS_CHANNEL)!({ status: 'available', version: '1.0.0' })
    await flush()
    listeners.get('dsh:locale:change')!('en')
    await flush()
    expect(document.getElementById('dsh-update-badge')?.textContent).toBe('Update')
  })

  it('offers a localized retry after an update error', async () => {
    const { ipc, listeners } = makeIpc()
    installUpdateBadge(document, ipc)
    mountAnchor()
    listeners.get(UPDATE_STATUS_CHANNEL)!({ status: 'available', version: '1.2.3' })
    listeners.get(UPDATE_STATUS_CHANNEL)!({ status: 'error' })
    await flush()
    const badge = document.getElementById('dsh-update-badge')
    expect(badge?.textContent).toBe('重试更新')
    badge!.click()
    expect(ipc.send).toHaveBeenCalledWith(UPDATE_ACTION_CHANNEL, { action: 'check' })
  })

  it('disables the control while checking and hides it when no update exists', async () => {
    const { ipc, listeners } = makeIpc()
    installUpdateBadge(document, ipc)
    mountAnchor()
    listeners.get(UPDATE_STATUS_CHANNEL)!({ status: 'error' })
    listeners.get(UPDATE_STATUS_CHANNEL)!({ status: 'checking' })
    await flush()
    const badge = document.getElementById('dsh-update-badge') as HTMLButtonElement
    expect(badge.textContent).toBe('检查中')
    expect(badge.disabled).toBe(true)

    listeners.get(UPDATE_STATUS_CHANNEL)!({ status: 'idle' })
    expect(document.getElementById('dsh-update-badge')).toBeNull()
  })
})
