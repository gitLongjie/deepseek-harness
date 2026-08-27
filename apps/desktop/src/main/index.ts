/**
 * Desktop main process entry. Boots the dsh host in-process, registers the IPC
 * transport, serves the frontend dist over a custom app scheme (the runtime
 * renders the injection table into the index document), and wires Electron
 * lifetime to the host's disposal. Tray, autostart, application menu, and the
 * single-instance lock are mounted here.
 * @module @deepseek-ai/dsh-desktop/main
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { app, BrowserWindow, ipcMain, protocol } from 'electron'
import type { Context } from '@deepseek-ai/cordis'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { runDesktopBoot } from './boot.ts'
import type { ProcessShutdown } from './process-shutdown.ts'
import { registerTransportIpc } from './ipc/transport.ts'
import { registerBundleIpc } from './ipc/bundle.ts'
import { renderDesktopIndex } from './ipc/index-html.ts'
import { installSingleInstanceLock } from './desktop/single-instance.ts'
import { installTray, type TrayHandle } from './desktop/tray.ts'
import { copy, normalizeLocale, type DesktopLocaleId, type DesktopTextKey } from './desktop/locales.ts'
import { DESKTOP_WINDOW_TITLE, pinWindowTitle } from './desktop/window-title.ts'
import { installApplicationMenu, registerMenuPopupIpc } from './desktop/menu.ts'
import { initUpdater, registerUpdateIpc, setUpdaterLocale } from './updater.ts'

/** The app scheme serving the frontend dist (a standard, secure, fetch-capable scheme). */
const WEB_SCHEME = 'dshapp'

// Privileges must be registered before app-ready.
protocol.registerSchemesAsPrivileged([
  { scheme: WEB_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

/** Directory of the built frontend dist, beside this compiled main in both layouts. */
const WEB_DIST_DIR = fileURLToPath(new URL('../../web/', import.meta.url))

/** Absolute path of the preload script. */
const PRELOAD_PATH = fileURLToPath(new URL('../preload/index.js', import.meta.url))

const gotLock = installSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  void main().catch((error: unknown) => {
    console.error('desktop: fatal startup failure:', error)
    app.exit(1)
  })
}

/** The settled host context and its shutdown controller, filled after boot. */
const host: { ctx?: Context; shutdown?: ProcessShutdown } = {}

/** The tray handle once installed; rebuilt on locale change. */
let trayHandle: TrayHandle | undefined

/** The active desktop-shell locale (defaults to Chinese). */
let currentLocale: DesktopLocaleId = 'zh'

/** The locale-bound translate function for the shell surfaces. */
function shellT(locale: DesktopLocaleId): (key: DesktopTextKey) => string {
  const strings = copy(locale)
  return key => strings[key]
}

/** Read the stored locale preference (default zh); settings may be absent. */
function readLocalePreference(): DesktopLocaleId {
  try {
    const settings = host.ctx?.get('settings') as { get(ns: string): unknown } | undefined
    const locale = settings?.get('locale') as { preference?: unknown } | undefined
    return normalizeLocale(locale?.preference)
  } catch {
    return 'zh'
  }
}

/**
 * Rebuild the native shell surfaces for the current locale: the application
 * menu, the tray context menu, and (via IPC) the renderer title bar.
 * @param win - the main window whose title bar should follow the language.
 */
function rebuildShell(win?: BrowserWindow): void {
  currentLocale = readLocalePreference()
  const t = shellT(currentLocale)
  installApplicationMenu(t)
  trayHandle?.rebuild(t)
  setUpdaterLocale(t)
  if (win !== undefined && !win.isDestroyed()) {
    win.webContents.send('dsh:locale:change', currentLocale)
  }
}

/**
 * Append a startup line to the desktop log under userData; GUI apps do not
 * surface process stderr, so failures need a durable sink for diagnosis.
 */
function log(line: string): void {
  const text = `${new Date().toISOString()} ${line}\n`
  console.error(text.trimEnd())
  try {
    // DSH_DESKTOP_LOG overrides the default userData log for headless diagnosis.
    const logPath = process.env.DSH_DESKTOP_LOG ?? join(app.getPath('userData'), 'desktop.log')
    mkdirSync(dirname(logPath), { recursive: true })
    appendFileSync(logPath, text)
  } catch {
    // Logging must never crash startup.
  }
}

/**
 * Boot the web profile under the desktop overlay and start the app.
 */
async function main(): Promise<void> {
  try {
    const environment = loadLayeredEnv('desktop')
    log(`desktop: booting (packaged=${String(app.isPackaged)}) execArgv=${JSON.stringify(process.execArgv)} node=${process.versions.node}`)
    const result = await runDesktopBoot({
      environment,
      args: ['--no-open', '--port', '0'],
      // app.getAppPath() is a filesystem path; the loader's bare import resolves
      // against a file:// parent URL, so convert it before appending the slash.
      ...(app.isPackaged ? { bareModuleBaseUrl: pathToFileURL(app.getAppPath()).href + '/' } : {}),
      forceExit: (code) => { app.exit(code) },
      complete: (code) => { app.exit(code) },
    })
    host.ctx = result.ctx
    host.shutdown = result.shutdown
    log('desktop: host booted')

    registerTransportIpc(() => ({
      api: host.ctx?.get('apiProxy'),
      connection: host.ctx?.get('connection'),
    }))
    registerBundleIpc(() => host.ctx?.get('clientModules'))

    // Protocol handlers and the menu must register after the app is ready.
    await app.whenReady()
    registerWebProtocol(log)
    currentLocale = readLocalePreference()
    installApplicationMenu(shellT(currentLocale))
    registerMenuPopupIpc()
    registerUpdateIpc()
    registerWindowControlsIpc()

    const win = createWindow()
    win.webContents.on('preload-error', (_event, preloadPath, error) => {
      log(`desktop: preload error ${preloadPath}: ${error.message}`)
    })
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      if (level >= 2) log(`desktop: renderer console[${level}] ${message} (${sourceId}:${line})`)
    })
    log('desktop: loading window')
    // A `localhost` authority keeps the renderer's origin inside the loopback
    // fence, so loopback-only surfaces (settings, credentials) stay available.
    await win.loadURL(`${WEB_SCHEME}://localhost/index.html`)
    log('desktop: window loaded')
    // Seed the title bar with the current shell locale.
    win.webContents.send('dsh:locale:change', currentLocale)

    let disposed = false
    app.on('before-quit', (event) => {
      if (disposed) return
      event.preventDefault()
      disposed = true
      void host.shutdown?.shutdown(0)
    })

    trayHandle = installTray(win, shellT(currentLocale))
    initUpdater(shellT(currentLocale), win)

    // Language preference changes rebuild the native shell and tell the title
    // bar to follow (the web settings General → 语言 row writes this namespace).
    // settings/updated is declared by @deepseek-ai/dsh-settings' ambient Events
    // merge; narrow the host ctx to the one channel here.
    const shellCtx = host.ctx as { on(event: string, listener: (ns: unknown) => void): unknown } | undefined
    shellCtx?.on('settings/updated', (ns: unknown) => {
      if (ns === 'locale') rebuildShell(win)
    })
  } catch (error) {
    log(`desktop: startup failed:\n${flattenError(error)}`)
    app.exit(1)
  }
}

/** Expand an error chain (causes and AggregateError entries) for diagnosis. */
function flattenError(error: unknown, depth = 0): string {
  if (depth > 4) return String(error)
  if (error instanceof AggregateError && error.errors.length > 0) {
    return error.errors.map((entry, index) => `${'  '.repeat(depth)}[${index}] ${flattenError(entry, depth + 1)}`).join('\n')
  }
  if (error instanceof Error) {
    const base = error.stack ?? error.message
    return error.cause === undefined ? base : `${base}\n${'  '.repeat(depth)}cause: ${flattenError(error.cause, depth + 1)}`
  }
  return String(error)
}

/** Compose a window loading the injected index over the app scheme. */
function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    // Taskbar/alt-tab art on Windows and Linux (macOS uses the app bundle icon).
    icon: fileURLToPath(new URL('../../build/icon.png', import.meta.url)),
    // The native title stays 深度Works for life: Windows surfaces it as the
    // taskbar hover tooltip and alt-tab label; page-title-updated must not
    // leak session projections there (pinWindowTitle blocks adoption).
    title: DESKTOP_WINDOW_TITLE,
    // Frameless: the renderer draws the branded title bar (render/title-bar.ts)
    // and drives these controls over the window-control IPC channels below.
    frame: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  pinWindowTitle(win)
  win.once('ready-to-show', () => { win.show() })
  return win
}

/**
 * Window-control channels the renderer's title bar sends over the generic IPC
 * bridge. Each targets the sender's own window, so a malicious page can only
 * affect the window it lives in.
 */
const WINDOW_CONTROL_CHANNELS: ReadonlyArray<{ channel: string; action: (win: BrowserWindow) => void }> = [
  { channel: 'dsh:window:minimize', action: (win) => { win.minimize() } },
  {
    channel: 'dsh:window:toggle-maximize',
    action: (win) => {
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
    },
  },
  { channel: 'dsh:window:close', action: (win) => { win.close() } },
]

/** Register the frameless window's control channels (once, at startup). */
function registerWindowControlsIpc(): void {
  for (const { channel, action } of WINDOW_CONTROL_CHANNELS) {
    ipcMain.on(channel, (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win !== null) action(win)
    })
  }
}

/** Serve the frontend dist over the app scheme, rendering the index on demand. */
function registerWebProtocol(writeLog: (line: string) => void): void {
  let injected: string | undefined
  protocol.handle(WEB_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'localhost') return new Response('not found', { status: 404 })
      const pathname = url.pathname === '/' ? '/index.html' : url.pathname
      const filePath = resolve(WEB_DIST_DIR, `.${pathname}`)
      if (!filePath.startsWith(resolve(WEB_DIST_DIR))) {
        return new Response('forbidden', { status: 403 })
      }
      if (pathname === '/index.html') {
        if (injected === undefined) {
          const ctx = host.ctx
          if (ctx === undefined) throw new Error('desktop: host not ready to render index')
          injected = renderDesktopIndex(ctx, WEB_DIST_DIR)
        }
        return new Response(injected, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      }
      // /plugins/<id>/client.js — dynamic client bundles owned by the module
      // registry, not static web assets. The renderer may reach them by URL
      // when the transport loadBundle path is not in effect.
      if (pathname.startsWith('/plugins/') && pathname.endsWith('/client.js')) {
        const id = decodeURIComponent(pathname.slice('/plugins/'.length, -'/client.js'.length))
        const modules = host.ctx?.get('clientModules') as { clientPath(id: string): string | undefined } | undefined
        const bundlePath = modules?.clientPath(id)
        if (bundlePath === undefined) return new Response('not found', { status: 404 })
        const bundle = await readFile(bundlePath)
        return new Response(bundle, { headers: { 'content-type': 'text/javascript; charset=utf-8' } })
      }
      const data = await readFile(filePath)
      return new Response(data, { headers: { 'content-type': contentTypeFor(pathname) } })
    } catch (error) {
      writeLog(`desktop: web protocol error for ${request.url}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
      return new Response('internal error', { status: 500 })
    }
  })
}

/** Best-effort content type for the frontend assets. */
function contentTypeFor(pathname: string): string {
  if (pathname.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (pathname.endsWith('.css')) return 'text/css; charset=utf-8'
  if (pathname.endsWith('.svg')) return 'image/svg+xml'
  if (pathname.endsWith('.png')) return 'image/png'
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg'
  if (pathname.endsWith('.woff2')) return 'font/woff2'
  if (pathname.endsWith('.json')) return 'application/json; charset=utf-8'
  if (pathname.endsWith('.webmanifest')) return 'application/manifest+json'
  return 'application/octet-stream'
}
