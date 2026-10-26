/**
 * Contact QR popup behavior: the window carries the bundled image inline, and
 * both failure paths (a missing asset, an unloadable document) report through
 * the native dialog instead of opening an empty window.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { contactQrDocument, showContactQr } from '../src/main/desktop/contact-qr.ts'

interface FakePopup {
  options: Record<string, unknown>
  webContents: { on: ReturnType<typeof vi.fn> }
  loadURL: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

const state = vi.hoisted(() => ({
  readFile: vi.fn(),
  showMessageBox: vi.fn(async () => ({ response: 0 })),
  loadError: false,
  popups: [] as FakePopup[],
}))

vi.mock('electron', () => {
  class FakeBrowserWindow {
    webContents = { on: vi.fn() }
    loadURL = vi.fn(async (_url: string) => {
      if (state.loadError) throw new Error('load failed')
    })
    show = vi.fn()
    destroy = vi.fn()
    close = vi.fn()
    constructor(readonly options: Record<string, unknown>) {
      state.popups.push(this)
    }
  }
  return { BrowserWindow: FakeBrowserWindow, dialog: { showMessageBox: state.showMessageBox } }
})

vi.mock('node:fs/promises', () => ({
  readFile: state.readFile,
}))

/** Locale lookup returning the key itself, so assertions read the key. */
const t = (key: string): string => key

beforeEach(() => {
  state.popups.length = 0
  state.readFile.mockReset()
  state.showMessageBox.mockClear()
  state.loadError = false
})

describe('contact QR popup', () => {
  it('opens a modal popup with the bundled image inlined and closes on Escape', async () => {
    state.readFile.mockResolvedValue(Buffer.from('png'))
    const parent = {} as BrowserWindow

    await showContactQr(parent, t)

    const popup = state.popups[0]
    expect(popup?.options).toMatchObject({ parent, modal: true, width: 380, height: 480 })
    const url = popup?.loadURL.mock.calls[0]?.[0] as string
    expect(url.startsWith('data:text/html;base64,')).toBe(true)
    const html = Buffer.from(url.slice('data:text/html;base64,'.length), 'base64').toString('utf8')
    expect(html).toContain('data:image/png;base64,cG5n')
    expect(html).toContain('contact.hint')
    expect(popup?.show).toHaveBeenCalledOnce()

    const [channel, handler] = popup?.webContents.on.mock.calls[0] as [
      string,
      (event: unknown, input: { type: string; key: string }) => void,
    ]
    expect(channel).toBe('before-input-event')
    handler({}, { type: 'keyDown', key: 'Escape' })
    expect(popup?.close).toHaveBeenCalledOnce()
  })

  it('reports a missing bundle image instead of opening an empty popup', async () => {
    state.readFile.mockRejectedValue(new Error('ENOENT'))

    await showContactQr(undefined, t)

    expect(state.popups).toHaveLength(0)
    expect(state.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ message: 'contact.missing' }))
  })

  it('destroys the popup and reports when the document cannot load', async () => {
    state.readFile.mockResolvedValue(Buffer.from('png'))
    state.loadError = true

    await showContactQr(undefined, t)

    expect(state.popups[0]?.destroy).toHaveBeenCalledOnce()
    expect(state.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ message: 'contact.failed' }))
  })

  it('escapes localized copy in the generated document', () => {
    const html = contactQrDocument('QUJD', '<扫码 & 联系我们>', '关"闭"')
    expect(html).toContain('src="data:image/png;base64,QUJD"')
    expect(html).toContain('&lt;扫码 &amp; 联系我们&gt;')
    expect(html).toContain('关&quot;闭&quot;')
    expect(html).not.toContain('<扫码')
  })
})
