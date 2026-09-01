import { beforeEach, describe, expect, it, vi } from 'vitest'

type IpcHandler = (event: unknown, payload: unknown) => void

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, (payload: unknown) => void>()
  const ipc = { handler: undefined as IpcHandler | undefined }
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(() => Promise.resolve()),
    downloadUpdate: vi.fn(() => Promise.resolve()),
    quitAndInstall: vi.fn(),
    on: vi.fn((event: string, listener: (payload: unknown) => void) => {
      listeners.set(event, listener)
      return updater
    }),
  }
  return {
    listeners,
    updater,
    getVersion: vi.fn(() => '1.0.0'),
    ipc,
    ipcOn: vi.fn((_channel: string, listener: IpcHandler) => {
      ipc.handler = listener
    }),
    showMessageBox: vi.fn(() => Promise.resolve({ response: 0 })),
  }
})

vi.mock('electron', () => ({
  app: { isPackaged: true, getVersion: mocks.getVersion },
  BrowserWindow: vi.fn(),
  dialog: { showMessageBox: mocks.showMessageBox },
  ipcMain: { on: mocks.ipcOn },
}))

vi.mock('electron-updater', () => ({
  default: { autoUpdater: mocks.updater },
}))

import { initUpdater, registerUpdateIpc, requestUpdateCheck } from '../src/main/updater.ts'

function updateActionHandler(): IpcHandler {
  const handler = mocks.ipc.handler
  if (handler === undefined) throw new Error('update action handler was not registered')
  return handler
}

describe('desktop updater status and actions', () => {
  const send = vi.fn()
  const win = {
    isDestroyed: () => false,
    webContents: { send },
  }
  const t = (key: string): string => {
    if (key === 'update.availableMessage') return 'Version {version}'
    if (key === 'update.downloadedMessage') return 'Downloaded {version}'
    return key
  }
  const log = vi.fn()

  beforeEach(() => {
    mocks.listeners.clear()
    mocks.ipc.handler = undefined
    mocks.ipcOn.mockClear()
    mocks.updater.setFeedURL.mockClear()
    mocks.updater.checkForUpdates.mockClear()
    mocks.updater.downloadUpdate.mockClear()
    mocks.updater.quitAndInstall.mockClear()
    mocks.showMessageBox.mockClear()
    mocks.getVersion.mockReturnValue('1.0.0')
    log.mockClear()
    send.mockClear()
    initUpdater(t, win, 'https://updates.example.test', log)
  })

  it('selects the prerelease channel from the installed version', () => {
    mocks.getVersion.mockReturnValue('1.0.0-local.1')
    initUpdater(t, win, 'http://127.0.0.1:43119', log)

    expect(mocks.updater.setFeedURL).toHaveBeenLastCalledWith({
      provider: 'generic',
      url: 'http://127.0.0.1:43119',
      channel: 'local',
    })
  })

  it('publishes available, progress, downloaded, idle, and error states', () => {
    mocks.listeners.get('update-available')!({ version: '1.1.0' })
    mocks.listeners.get('download-progress')!({ percent: 42.4 })
    mocks.listeners.get('update-downloaded')!({ version: '1.1.0' })
    mocks.listeners.get('update-not-available')!({ version: '1.0.0' })

    expect(send).toHaveBeenNthCalledWith(1, 'dsh:update:status', { status: 'available', version: '1.1.0' })
    expect(send).toHaveBeenNthCalledWith(2, 'dsh:update:status', { status: 'progressing', percent: 42 })
    expect(send).toHaveBeenNthCalledWith(3, 'dsh:update:status', { status: 'downloaded', version: '1.1.0' })
    expect(send).toHaveBeenNthCalledWith(4, 'dsh:update:status', { status: 'idle' })
  })

  it('keeps a startup update failure out of the renderer while logging it', () => {
    mocks.listeners.get('error')!(new Error('offline'))

    expect(send).not.toHaveBeenCalledWith('dsh:update:status', { status: 'error' })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('offline'))
  })

  it('shows a failure after an explicit update check', async () => {
    requestUpdateCheck()
    mocks.listeners.get('error')!(new Error('offline'))

    expect(send).toHaveBeenCalledWith('dsh:update:status', { status: 'error' })
    await vi.waitFor(() => {
      expect(mocks.showMessageBox).toHaveBeenCalledWith({
        type: 'error',
        title: 'update.availableTitle',
        message: 'update.error',
        buttons: ['update.ok'],
      })
    })
  })

  it('prompts after a manual check finds an update and downloads on confirmation', async () => {
    requestUpdateCheck()
    mocks.listeners.get('update-available')!({ version: '1.1.0' })

    await vi.waitFor(() => {
      expect(mocks.showMessageBox).toHaveBeenCalledWith({
        type: 'info',
        title: 'update.availableTitle',
        message: 'Version 1.1.0',
        buttons: ['update.download', 'update.later'],
        defaultId: 0,
        cancelId: 1,
      })
      expect(mocks.updater.downloadUpdate).toHaveBeenCalledOnce()
    })
  })

  it('keeps the available state without downloading when the prompt is deferred', async () => {
    mocks.showMessageBox.mockResolvedValueOnce({ response: 1 })
    requestUpdateCheck()
    mocks.listeners.get('update-available')!({ version: '1.1.0' })

    await vi.waitFor(() => { expect(mocks.showMessageBox).toHaveBeenCalledOnce() })
    expect(mocks.updater.downloadUpdate).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith('dsh:update:status', { status: 'available', version: '1.1.0' })
  })

  it('prompts when the download is ready and starts the visible installer on confirmation', async () => {
    mocks.listeners.get('update-downloaded')!({ version: '1.1.0' })

    await vi.waitFor(() => {
      expect(mocks.showMessageBox).toHaveBeenCalledWith({
        type: 'info',
        title: 'update.downloadedTitle',
        message: 'Downloaded 1.1.0',
        buttons: ['update.restart', 'update.later'],
        defaultId: 0,
        cancelId: 1,
      })
      expect(send).toHaveBeenCalledWith('dsh:update:status', { status: 'installing' })
      expect(mocks.updater.quitAndInstall).toHaveBeenCalledWith(false, true)
    })
  })

  it('keeps the restart action when installation is deferred', async () => {
    mocks.showMessageBox.mockResolvedValueOnce({ response: 1 })
    mocks.listeners.get('update-downloaded')!({ version: '1.1.0' })

    await vi.waitFor(() => { expect(mocks.showMessageBox).toHaveBeenCalledOnce() })
    expect(send).toHaveBeenCalledWith('dsh:update:status', { status: 'downloaded', version: '1.1.0' })
    expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('checks, downloads immediately with progress feedback, and visibly installs once from IPC', async () => {
    registerUpdateIpc()
    const handler = updateActionHandler()

    handler({}, { action: 'check' })
    handler({}, { action: 'download' })
    handler({}, { action: 'install' })
    handler({}, { action: 'install' })

    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledWith('dsh:update:status', { status: 'checking' })
    expect(send).toHaveBeenCalledWith('dsh:update:status', { status: 'progressing', percent: 0 })
    expect(send).toHaveBeenCalledWith('dsh:update:status', { status: 'installing' })
    expect(mocks.updater.downloadUpdate).toHaveBeenCalledOnce()
    await vi.waitFor(() => {
      expect(mocks.updater.quitAndInstall).toHaveBeenCalledOnce()
      expect(mocks.updater.quitAndInstall).toHaveBeenCalledWith(false, true)
    })
  })

  it('waits for application cleanup before launching the installer', async () => {
    let finishCleanup!: () => void
    const prepareInstall = vi.fn(() => new Promise<void>((resolve) => { finishCleanup = resolve }))
    initUpdater(t, win, 'https://updates.example.test', log, prepareInstall)
    registerUpdateIpc()
    const handler = updateActionHandler()

    handler({}, { action: 'install' })
    expect(prepareInstall).toHaveBeenCalledOnce()
    expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled()

    finishCleanup()
    await vi.waitFor(() => {
      expect(mocks.updater.quitAndInstall).toHaveBeenCalledWith(false, true)
    })
  })
})
