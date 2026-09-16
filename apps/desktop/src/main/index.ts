/**
 * Desktop main process entry. Boots the dsh host in-process, registers the IPC
 * transport, serves the frontend dist over a custom app scheme (the runtime
 * renders the injection table into the index document), and wires Electron
 * lifetime to the host's disposal. Tray, autostart, application menu, and the
 * single-instance lock are mounted here.
 * @module @deepseek-ai/dsh-desktop/main
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, protocol } from 'electron'
import type { Context } from '@deepseek-ai/cordis'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import type { TypertGateway } from '@deepseek-ai/dsh-api-gateway/types'
import { runDesktopBoot } from './boot.ts'
import type { ProcessShutdown } from './process-shutdown.ts'
import { dispatchTransportFetch, registerTransportIpc, type TransportFetchRequest } from './ipc/transport.ts'
import { registerBundleIpc } from './ipc/bundle.ts'
import { registerPluginToggleIpc } from './ipc/plugin-toggle.ts'
import { renderDesktopIndex } from './ipc/index-html.ts'
import { LOOPBACK_AUTHORITY } from './ipc/loopback-authority.ts'
import { installSingleInstanceLock } from './desktop/single-instance.ts'
import { installTray, type TrayHandle } from './desktop/tray.ts'
import { copy, normalizeLocale, type DesktopLocaleId, type DesktopTextKey } from './desktop/locales.ts'
import { pinWindowTitle, resolveDesktopWindowTitle } from './desktop/window-title.ts'
import { installApplicationMenu, registerMenuPopupIpc } from './desktop/menu.ts'
import { resolveWindowChrome } from './desktop/window-chrome.ts'
import { initUpdater, registerUpdateIpc, setUpdaterLocale } from './updater.ts'
import { installNotificationActivation, notifyTurnCompletion } from './desktop/completion-notification.ts'
import {
  resolveDesktopUpdateUrl,
  type DesktopUpdateManifest,
} from './desktop/update-url.ts'
import {
  applyKnowledgeBaseEnvironment, desktopKnowledgeBaseEnvironment, resolveDesktopKnowledgeBase,
  type DesktopKnowledgeManifest,
} from './desktop/knowledge-base.ts'
import {
  findMissingPackagedResources,
  type MissingPackagedResource,
  type PackagedResourceLabel,
} from './desktop/packaged-resources.ts'
import { runPackagedSmoke } from './desktop/packaged-smoke.ts'

/** Absolute path of this desktop app's package.json (the OEM resolution anchor). */
const INSTALL_ANCHOR = fileURLToPath(new URL('../../package.json', import.meta.url))

/** The app scheme serving the frontend dist (a standard, secure, fetch-capable scheme). */
const WEB_SCHEME = 'dshapp'

// Privileges must be registered before app-ready.
protocol.registerSchemesAsPrivileged([
  { scheme: WEB_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

// Windows keys the taskbar entry, Alt+Tab label, and Task Manager's Apps row off
// the app name and AppUserModelId; a dev launch runs the literal electron.exe, so
// without these it presents as "electron" with Electron's atom icon. The id must
// match electron-builder.yml's appId so dev and packaged share one identity. The
// name must be set before any userData path (the single-instance lock below).
const DESKTOP_PRODUCT_NAME = resolveDesktopWindowTitle(app.getName())
const DESKTOP_UPDATE_URL = readDesktopUpdateUrl()
app.setName(DESKTOP_PRODUCT_NAME)
if (process.platform === 'win32') app.setAppUserModelId('ai.deepagens.worker')
// The smoke harness must never contend with a real instance's lock: the
// single-instance lock is scoped to userData, so the harness points it at its
// own directory. Must run before installSingleInstanceLock() below.
const smokeUserData = process.env.DSH_PACKAGED_SMOKE_USER_DATA
if (smokeUserData !== undefined && smokeUserData !== '') app.setPath('userData', smokeUserData)

/** Directory of the built frontend dist, beside this compiled main in both layouts. */
const WEB_DIST_DIR = fileURLToPath(new URL('../../web/', import.meta.url))

/** Absolute path of the preload script. */
const PRELOAD_PATH = fileURLToPath(new URL('../preload/index.js', import.meta.url))

/** The settled host context and its shutdown controller, filled after boot. */
const host: { ctx?: Context; shutdown?: ProcessShutdown } = {}

/** The tray handle once installed; rebuilt on locale change. */
let trayHandle: TrayHandle | undefined

/** The active desktop-shell locale (defaults to Chinese). */
let currentLocale: DesktopLocaleId = 'zh'

/** The locale-bound translate function for the shell surfaces. */
function shellT(locale: DesktopLocaleId): (key: DesktopTextKey) => string {
  const strings = copy(locale, DESKTOP_PRODUCT_NAME)
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

/** Resolve when a live profile reload publishes the next Gateway service. */
function waitForTransportGateway(): Promise<TypertGateway> {
  const ctx = host.ctx
  const gateway = ctx?.get('typertGateway')
  if (gateway !== undefined) return Promise.resolve(gateway)
  if (ctx === undefined) return Promise.reject(new Error('desktop: host stopped before Remote streams became available'))
  return new Promise(resolve => {
    const dispose = ctx.on('internal/service', (name: string, value: unknown) => {
      if (name !== 'typertGateway' || value === undefined) return
      dispose()
      resolve(value as TypertGateway)
    })
  })
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
 * Mirror the host's console diagnostics (activation warnings, pending-service
 * reports, fail-loud errors) into the desktop log. The in-process host writes
 * through `console`, and a windowed Electron run has no stderr sink, so a
 * wedged boot or a stuck turn previously left no trace.
 */
function mirrorConsoleToLog(): void {
  for (const method of ['error', 'warn'] as const) {
    const original = console[method].bind(console)
    console[method] = (...args: readonly unknown[]): void => {
      original(...args)
      try {
        const text = args.map(String).join(' ')
        const logPath = process.env.DSH_DESKTOP_LOG ?? join(app.getPath('userData'), 'desktop.log')
        appendFileSync(logPath, `${new Date().toISOString()} host ${method}: ${text}\n`)
      } catch {
        // Logging must never crash the host.
      }
    }
  }
}

/**
 * Boot the web profile under the desktop overlay and start the app.
 */
async function main(): Promise<void> {
  try {
    // Fail loud before anything mounts: a package missing boot-critical on-disk
    // resources (web dist, presets, unpacked twins) must not half-work.
    if (app.isPackaged) {
      const missing = findMissingPackagedResources(app.getAppPath())
      if (missing.length > 0) {
        failMissingPackagedResources(missing)
        return
      }
    }
    // The OEM knowledge-base connection joins the trusted environment before
    // the layered snapshot freezes it, without replacing values the launching
    // environment already owns.
    const knowledgeBase = resolveDesktopKnowledgeBase(
      INSTALL_ANCHOR,
      JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as DesktopKnowledgeManifest,
    )
    if (knowledgeBase !== undefined) {
      applyKnowledgeBaseEnvironment(process.env, desktopKnowledgeBaseEnvironment(knowledgeBase))
    }
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

    // The packaging gate branch: run the boot self-check suite and exit with
    // the verdict instead of starting the shell.
    if (process.env.DSH_PACKAGED_SMOKE === '1') {
      await runPackagedSmokeAndExit()
      return
    }

    registerTransportIpc(() => ({
      gateway: host.ctx?.get('typertGateway'),
      connection: host.ctx?.get('connection'),
    }), waitForTransportGateway)
    registerBundleIpc(() => host.ctx?.get('clientModules'))
    registerPluginToggleIpc()

    // Protocol handlers and the menu must register after the app is ready.
    await app.whenReady()
    registerWebProtocol(log)
    currentLocale = readLocalePreference()
    registerMenuPopupIpc()
    registerUpdateIpc()
    registerWindowControlsIpc()

    const win = createWindow()
    // macOS Dock click after the window was hidden to the tray (tray.ts hides
    // instead of destroying on close): without this handler the app is
    // unreachable from the Dock — icon and menu bar stay up but no window
    // ever returns. The window is never destroyed while running, so the
    // recreate branch only covers abnormal teardown.
    app.on('activate', () => {
      const current = BrowserWindow.getAllWindows()[0]
      if (current === undefined) {
        createWindow()
        return
      }
      if (current.isMinimized()) current.restore()
      current.show()
      current.focus()
    })
    // Centralized notification-activation handler: on Windows a Toast click can
    // activate the app through the OS shell instead of firing the Notification
    // instance's click event. handleActivation covers every path including cold
    // starts, so register it before any notifications are shown.
    installNotificationActivation(() => win.isDestroyed() ? undefined : win)
    let updateInstallPrepared = false
    initUpdater(shellT(currentLocale), win, DESKTOP_UPDATE_URL, log, async () => {
      await host.shutdown?.prepare()
      updateInstallPrepared = true
    })
    installApplicationMenu(shellT(currentLocale))
    host.ctx?.on('session/event', (session, event) => {
      notifyTurnCompletion(win, currentLocale, String(session.id), event)
    })
    win.webContents.on('preload-error', (_event, preloadPath, error) => {
      log(`desktop: preload error ${preloadPath}: ${error.message}`)
    })
    win.webContents.on('console-message', (event) => {
      if (event.level === 'warning' || event.level === 'error') {
        log(`desktop: renderer console[${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`)
      }
    })
    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame) {
        log(`desktop: renderer main-frame load failed ${errorCode} ${errorDescription} (${validatedURL})`)
      }
    })
    win.webContents.on('render-process-gone', (_event, details) => {
      log(`desktop: renderer process gone reason=${details.reason} exitCode=${details.exitCode}`)
    })
    win.webContents.on('unresponsive', () => {
      log('desktop: renderer became unresponsive')
    })
    win.webContents.on('responsive', () => {
      log('desktop: renderer became responsive')
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
      if (updateInstallPrepared) return
      if (disposed) return
      event.preventDefault()
      disposed = true
      void host.shutdown?.shutdown(0)
    })

    trayHandle = installTray(win, shellT(currentLocale), DESKTOP_PRODUCT_NAME)

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

/** Read packaged metadata and resolve the desktop update feed. */
function readDesktopUpdateUrl(): string {
  const manifest = JSON.parse(
    readFileSync(join(app.getAppPath(), 'package.json'), 'utf8'),
  ) as DesktopUpdateManifest
  return resolveDesktopUpdateUrl(process.env.DSH_DESKTOP_UPDATE_URL, manifest)
}

/** Locale key carrying each missing-resource label's copy. */
const RESOURCE_LABEL_KEYS: Record<PackagedResourceLabel, DesktopTextKey> = {
  'web-dist': 'resources.missing.web-dist',
  'agent-presets': 'resources.missing.agent-presets',
  'desktop-patch': 'resources.missing.desktop-patch',
  'windows-acl-runner': 'resources.missing.windows-acl-runner',
  'koffi-binding': 'resources.missing.koffi-binding',
}

/**
 * Report an incomplete package and stop: show the native error dialog (GUI
 * users have no other surface for startup failures), log the full list for
 * diagnosis, and exit non-zero.
 */
function failMissingPackagedResources(missing: MissingPackagedResource[]): void {
  const t = copy(currentLocale, DESKTOP_PRODUCT_NAME)
  const list = missing
    .map(entry => `${t[RESOURCE_LABEL_KEYS[entry.label]]}: ${entry.path}`)
    .join('\n')
  log(`desktop: packaged resources incomplete:\n${missing.map(entry => `${entry.label}: ${entry.path}`).join('\n')}`)
  try {
    dialog.showErrorBox(t['resources.missingTitle'], t['resources.missingMessage'].replace('{list}', list))
  } catch {
    // No display available (headless diagnosis); the log line above carries
    // the failure and the non-zero exit reports it to the launcher.
  }
  app.exit(1)
}

/**
 * Run the packaging-gate smoke suite against the settled host, write the
 * structured verdict for `scripts/packaged-smoke.mjs`, and exit with the
 * verdict. Never starts the shell surfaces.
 */
async function runPackagedSmokeAndExit(): Promise<void> {
  const ctx = host.ctx
  if (ctx === undefined) {
    log('desktop: smoke failed: the host context never settled')
    app.exit(1)
    return
  }
  const result = await runPackagedSmoke({
    appRoot: app.getAppPath(),
    webDistDir: WEB_DIST_DIR,
    ctx,
  })
  const resultPath = process.env.DSH_PACKAGED_SMOKE_RESULT
  if (resultPath !== undefined && resultPath !== '') {
    try {
      writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`)
    } catch {
      // The harness also reads the exit code, so a failed verdict write must
      // not change the outcome.
    }
  }
  for (const check of result.checks) {
    log(`desktop: smoke ${check.ok ? 'ok' : 'FAIL'} ${check.name}: ${check.detail}`)
  }
  log(`desktop: smoke ${result.ok ? 'ok' : 'failed'}`)
  await host.shutdown?.shutdown(result.ok ? 0 : 1)
  app.exit(result.ok ? 0 : 1)
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
    icon: fileURLToPath(new URL('../../build/icon.ico', import.meta.url)),
    // The native title stays the OEM product name for life: Windows surfaces it as the
    // taskbar hover tooltip and alt-tab label; page-title-updated must not
    // leak session projections there (pinWindowTitle blocks adoption).
    title: DESKTOP_PRODUCT_NAME,
    // Per-platform frame chrome (desktop/window-chrome.ts): Windows and Linux
    // draw the whole bar in the renderer (render/title-bar.ts) over the
    // window-control IPC channels below; macOS keeps the native traffic lights
    // over the same bar via hiddenInset.
    ...resolveWindowChrome(process.platform),
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  pinWindowTitle(win)
  // Native fullscreen hides the system chrome, so the renderer bar must follow:
  // render/title-bar.ts listens on this channel and hides the bar (with the
  // body's top shift) while the window is fullscreen.
  win.on('enter-full-screen', () => {
    if (!win.isDestroyed()) win.webContents.send('dsh:window:fullscreen-change', true)
  })
  win.on('leave-full-screen', () => {
    if (!win.isDestroyed()) win.webContents.send('dsh:window:fullscreen-change', false)
  })
  win.once('ready-to-show', () => { win.show() })
  return win
}

/**
 * Window-control channels the renderer's title bar sends over the generic IPC
 * bridge (Windows/Linux only; macOS renders no custom controls). Each targets
 * the sender's own window, so a malicious page can only affect the window it
 * lives in.
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

/** Authenticated loopback origin and cookie of the in-process host web server. */
let webProxySession: { origin: string; cookie: string } | undefined

/**
 * Complete the host web server's token→cookie handshake over the loopback.
 * The profile runs the web server on 127.0.0.1:0 (the connection row binds its
 * gateway there), so its routes — open-in-app among them — are reachable
 * in-process; the exchange mints the authority-bound cookie their trust fence
 * requires, exactly as a browser's first visit would.
 * @returns the proxy session, or undefined while the host has not settled.
 */
async function ensureWebHostSession(): Promise<{ origin: string; cookie: string } | undefined> {
  if (webProxySession !== undefined) return webProxySession
  const ctx = host.ctx
  if (ctx === undefined) return undefined
  const webServer = ctx.get('webServer') as { port: number; host: string } | undefined
  const connection = ctx.get('connection') as
    { authenticatedUrl(baseUrl: string): string } | undefined
  if (webServer === undefined || connection === undefined) return undefined
  const origin = `http://${webServer.host}:${webServer.port}`
  const response = await fetch(connection.authenticatedUrl(origin), { redirect: 'manual' })
  const setCookie = response.headers.get('set-cookie')
  const cookie = setCookie === null ? undefined : setCookie.split(';')[0]
  webProxySession = { origin, cookie: cookie ?? '' }
  return webProxySession
}

/**
 * Forward one host web-server request from the app scheme to the in-process
 * loopback listener. The shell is the local trust boundary (the same tier the
 * /api IPC transport sits in), so its proxy carries the authenticated session
 * cookie rather than re-deriving the browser fence per request; a rejected
 * session is re-established once and the request retried.
 * @param request - the renderer's app-scheme request.
 * @param writeLog - the shell's log sink for proxy failures.
 * @returns the web server's response verbatim.
 */
async function proxyToWebHost(request: Request, writeLog: (line: string) => void): Promise<Response> {
  const incoming = new URL(request.url)
  const attempt = async (session: { origin: string; cookie: string }): Promise<Response> => {
    const headers = new Headers()
    for (const name of ['content-type', 'accept']) {
      const value = request.headers.get(name)
      if (value !== null) headers.set(name, value)
    }
    headers.set('host', session.origin.slice('http://'.length))
    headers.set('origin', session.origin)
    if (session.cookie !== '') headers.set('cookie', session.cookie)
    const body = request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : await request.arrayBuffer()
    return await fetch(`${session.origin}${incoming.pathname}${incoming.search}`, {
      method: request.method,
      headers,
      ...(body === undefined ? {} : { body }),
    })
  }
  let session = await ensureWebHostSession()
  if (session === undefined) return new Response('host not ready', { status: 503 })
  let response = await attempt(session)
  if (response.status === 401) {
    webProxySession = undefined
    session = await ensureWebHostSession()
    if (session === undefined) return new Response('host not ready', { status: 503 })
    response = await attempt(session)
  }
  if (response.status >= 500) {
    writeLog(`desktop: web proxy ${request.method} ${incoming.pathname} -> ${response.status}`)
  }
  const responseHeaders = new Headers()
  for (const name of ['content-type', 'cache-control']) {
    const value = response.headers.get(name)
    if (value !== null) responseHeaders.set(name, value)
  }
  return new Response(await response.arrayBuffer(), { status: response.status, headers: responseHeaders })
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
          injected = await renderDesktopIndex(ctx, WEB_DIST_DIR)
        }
        return new Response(injected, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      }
      // Keep the app scheme usable even when a renderer request reaches the
      // protocol directly instead of the IPC fetch hook. API paths belong to
      // the in-process Host connection; they are never frontend files.
      if (pathname.startsWith('/api/')) {
        const bodyBytes = request.method === 'GET' || request.method === 'HEAD'
          ? undefined
          : await request.arrayBuffer()
        const headers: Record<string, string> = {}
        request.headers.forEach((value, key) => { headers[key] = value })
        const req: TransportFetchRequest = {
          requestId: `protocol-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          path: `${pathname}${url.search}`,
          method: request.method,
          headers,
          ...(bodyBytes === undefined ? {} : { body: new TextDecoder().decode(bodyBytes) }),
        }
        const response = await dispatchTransportFetch(
          { connection: host.ctx?.get('connection'), gateway: host.ctx?.get('typertGateway') },
          req,
          new AbortController().signal,
        )
        const responseBody = new Uint8Array(await response.arrayBuffer())
        const responseHeaders = new Headers()
        const contentType = response.headers.get('content-type')
        if (contentType !== null) responseHeaders.set('content-type', contentType)
        return new Response(responseBody, { status: response.status, headers: responseHeaders })
      }
      // /plugins/* — dynamic client bundles owned by the module registry, not
      // static web assets. The renderer reaches them by URL whenever the
      // transport loadBundle path is not in effect; combo URLs key the
      // registry's precomputed response table verbatim.
      if (pathname.startsWith('/plugins/')) {
        const modules = host.ctx?.get('clientModules')
        if (modules === undefined) return new Response('not found', { status: 404 })
        // The registry reads the resource off the request URL; the app scheme's
        // own origin is not the authority its response table is keyed on.
        return await modules.fetchBundle(new Request(
          new URL(`${pathname}${url.search}`, LOOPBACK_AUTHORITY),
          { method: request.method },
        ))
      }
      // Host web-server routes (open-in-app availability, icons, launches) are
      // live on the profile's ephemeral loopback listener; the shell proxies
      // them there, completing that server's token→cookie trust handshake once.
      if (pathname.startsWith('/open-in-app/')) {
        return await proxyToWebHost(request, writeLog)
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

// The entry invocation must stay the last statement in this module: main() runs
// synchronously up to its first await, and its early exits (the packaged-resource
// check above all) read module-level bindings declared further down — currentLocale,
// host, RESOURCE_LABEL_KEYS. Invoking it any earlier throws a bare ReferenceError
// on the failure path and buries the real startup reason.
const gotLock = installSingleInstanceLock()
if (!gotLock) {
  // app.exit bypasses the before-quit / window-close lifecycle and terminates
  // immediately. On Windows a Toast-notification click can launch a second
  // instance through the OS shell; app.quit() leaves the event loop alive long
  // enough for Electron to flash a default BrowserWindow before the process
  // settles, which is the blank "Electron" window users reported.
  app.exit(0)
} else {
  mirrorConsoleToLog()
  void main().catch((error: unknown) => {
    console.error('desktop: fatal startup failure:', error)
    app.exit(1)
  })
}
