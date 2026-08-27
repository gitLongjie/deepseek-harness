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

/** Mount the account-row slot the badge waits for. */
function mountAnchor(): HTMLElement {
  const anchor = document.createElement('div')
  anchor.dataset.slot = 'sidebar.footer.action'
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

  it('shows a badge once an update is available and the account slot exists', async () => {
    const { ipc, listeners } = makeIpc()
    installUpdateBadge(document, ipc)
    mountAnchor()
    listeners.get(UPDATE_STATUS_CHANNEL)!({ status: 'available', version: '1.2.3' })
    await flush()
    const badge = document.getElementById('dsh-update-badge')
    expect(badge).not.toBeNull()
    expect(badge?.textContent).toBe('新版本 1.2.3')
    expect(badge?.classList.contains('dsh-update-ready')).toBe(false)
  })

  it('sends a prompt action when clicked while available', async () => {
    const { ipc, listeners } = makeIpc()
    installUpdateBadge(document, ipc)
    mountAnchor()
    listeners.get(UPDATE_STATUS_CHANNEL)!({ status: 'available', version: '1.2.3' })
    await flush()
    document.getElementById('dsh-update-badge')!.click()
    expect(ipc.send).toHaveBeenCalledWith(UPDATE_ACTION_CHANNEL, { action: 'prompt' })
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

  it('renders English copy and follows the locale channel', async () => {
    const { ipc, listeners } = makeIpc()
    installUpdateBadge(document, ipc)
    mountAnchor()
    listeners.get(UPDATE_STATUS_CHANNEL)!({ status: 'available', version: '1.0.0' })
    await flush()
    listeners.get('dsh:locale:change')!('en')
    await flush()
    expect(document.getElementById('dsh-update-badge')?.textContent).toBe('New version 1.0.0')
  })
})
