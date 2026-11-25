/**
 * Desktop main process entry. Boots the dsh host in-process, registers the IPC
 * transport, serves the frontend dist over a custom app scheme (the runtime
 * renders the injection table into the index document), and wires Electron
 * lifetime to the host's disposal. Tray, autostart, application menu, and the
 * single-instance lock are mounted here.
 * @module @deepseek-ai/dsh-desktop/main
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { cpus } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron'
import type { Context } from '@deepseek-ai/cordis'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import type { TypertGateway } from '@deepseek-ai/dsh-api-gateway/types'
import { runDesktopBoot } from './boot.ts'
import {
  BOOT_RELAUNCH_ARG,
  BOOT_STATE_FILENAME,
  HOST_BOOT_AUTO_RELAUNCHES,
  classifyInstallLocation,
  clearBootState,
  createHostBootWatchdog,
  hostBootWatchdogEnabled,
  inheritedStuckBoots,
  inspectBootEntries,
  readBootState,
  stuckBootAction,
  writeBootState,
  type BootEntrySource,
  type BootStage,
  type HostBootWatchdogOptions,
  type StuckBootReport,
} from './desktop/boot-watchdog.ts'
import { mountDesktopOffice, resolveBundledSkillDir } from './desktop/office.ts'
import { installOfficeEngineResolution } from './desktop/office-engine.ts'
import { comfyuiLocalDir, deployBundledComfyUI } from './desktop/comfyui-bootstrap.ts'
import type { ProcessShutdown } from './process-shutdown.ts'
import { dispatchTransportFetch, registerTransportIpc, transportRequestBytes, type TransportFetchRequest } from './ipc/transport.ts'
import { registerBundleIpc } from './ipc/bundle.ts'
import { registerPluginToggleIpc } from './ipc/plugin-toggle.ts'
import { renderDesktopIndex } from './ipc/index-html.ts'
import { isWebHostProxyPath } from './web-host-proxy.ts'
import { LOOPBACK_AUTHORITY } from './ipc/loopback-authority.ts'
import { installSingleInstanceLock } from './desktop/single-instance.ts'
import { installTray, type TrayHandle } from './desktop/tray.ts'
import { copy, normalizeLocale, type DesktopLocaleId, type DesktopTextKey } from './desktop/locales.ts'
import { pinWindowTitle, resolveDesktopWindowTitle } from './desktop/window-title.ts'
import { conflictingDevTaskbarShortcuts, resolveAppUserModelId } from './desktop/app-user-model-id.ts'
import { installApplicationMenu, registerMenuPopupIpc } from './desktop/menu.ts'
import { darwinRendererSwitches } from './desktop/darwin-renderer.ts'
import { resolveWindowChrome, syncDarwinTrafficLights, toggleWindowZoom } from './desktop/window-chrome.ts'
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
  applyGatewayProviderNameEnvironment, resolveDesktopGatewayProviderName,
  type DesktopProviderNameManifest,
} from './desktop/provider-name.ts'
import { resolveDesktopContactUrl, resolveDesktopHelpDocsUrl, type DesktopHelpManifest } from './desktop/help-links.ts'
import {
  findMissingPackagedResources,
  type MissingPackagedResource,
  type PackagedResourceLabel,
} from './desktop/packaged-resources.ts'
import { runPackagedSmoke } from './desktop/packaged-smoke.ts'
import { desktopWebDistDir, resolveDesktopPreloadPath } from './desktop-paths.ts'
import { adoptDesktopProductData, DESKTOP_PRODUCT_DATA_DIR, pinDesktopProductDataRoots } from './product-data-home.ts'

/** Absolute path of this desktop app's package.json (the OEM resolution anchor). */
const INSTALL_ANCHOR = fileURLToPath(new URL('../../package.json', import.meta.url))

/** The app scheme serving the frontend dist (a standard, secure, fetch-capable scheme). */
const WEB_SCHEME = 'dshapp'

// Privileges must be registered before app-ready.
protocol.registerSchemesAsPrivileged([
  { scheme: WEB_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

// Chromium starts the GPU process on the ready event and ignores switches
// appended later. Host boot awaits before the window is created, so ready can
// fire before main() reaches that point. M1 and M2 otherwise present no frame
// and the hidden window never appears (desktop/darwin-renderer.ts).
const DARWIN_RENDERER_SWITCHES = darwinRendererSwitches(process.platform, cpus()[0]?.model ?? '')
for (const flag of DARWIN_RENDERER_SWITCHES) app.commandLine.appendSwitch(flag)

// Windows keys the taskbar entry, Alt+Tab label, and Task Manager's Apps row off
// the app name and AppUserModelId (desktop/app-user-model-id.ts owns the id).
// The name must be set before any userData path (the single-instance lock below).
const DESKTOP_PRODUCT_NAME = resolveDesktopWindowTitle(app.getName())
const DESKTOP_UPDATE_URL: string | undefined = readDesktopUpdateUrl()
app.setName(DESKTOP_PRODUCT_NAME)
if (process.platform === 'win32') app.setAppUserModelId(resolveAppUserModelId(process.env, app.getAppPath()))
// The userData directory stays on the ASCII file-system id, not the localized
// display name `setName` installs: users and support scripts navigate
// %APPDATA% (and macOS Application Support) by the product's file-system id
// (DeepWorker), and the display name belongs to the window and tray, not the
// disk layout.
app.setPath('userData', join(app.getPath('appData'), DESKTOP_PRODUCT_DATA_DIR))
// The smoke harness must never contend with a real instance's lock: the
// single-instance lock is scoped to userData, so the harness points it at its
// own directory. Must run before installSingleInstanceLock() below.
const smokeUserData = process.env.DSH_PACKAGED_SMOKE_USER_DATA
if (smokeUserData !== undefined && smokeUserData !== '') app.setPath('userData', smokeUserData)

/**
 * Brand icon for the window and the dev taskbar shortcut.
 * Windows draws the taskbar button from the shortcut, and it caches an
 * executable's icon by path. The dev executable is a copy of Electron, so the
 * shortcut must name this ICO file rather than the executable.
 */
const DESKTOP_TASKBAR_ICON = fileURLToPath(new URL('../../build/icon.ico', import.meta.url))

/**
 * Publish this checkout's Start Menu shortcut, then remove every other
 * shortcut that carries the same AppUserModelId.
 * Windows draws the taskbar button from one shortcut with that id. A leftover
 * shortcut whose icon is empty uses the executable, and Windows keeps the
 * original Electron icon cached for that path. The update preserves the toast
 * activator. A missing shortcut is created here, before the window, so the
 * taskbar does not bind a shortcut that has no brand icon.
 */
function syncWindowsDevTaskbarShortcut(): void {
  if (process.platform !== 'win32' || process.env.DSH_DESKTOP_DEV !== '1') return
  const programs = join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  const shortcutName = `${DESKTOP_PRODUCT_NAME}.lnk`
  const shortcut = join(programs, shortcutName)
  const appUserModelId = resolveAppUserModelId(process.env, app.getAppPath())
  const wrote = shell.writeShortcutLink(shortcut, existsSync(shortcut) ? 'update' : 'create', {
    target: process.execPath,
    appUserModelId,
    description: DESKTOP_PRODUCT_NAME,
    icon: DESKTOP_TASKBAR_ICON,
    iconIndex: 0,
  })
  if (!wrote) console.warn('desktop: failed to refresh the dev taskbar shortcut')
  let names: string[]
  try {
    names = readdirSync(programs)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`desktop: failed to read Start Menu shortcuts: ${message}`)
    return
  }
  const published: { name: string; appUserModelId?: string | undefined }[] = []
  for (const name of names) {
    if (!name.endsWith('.lnk') || name === shortcutName) continue
    const path = join(programs, name)
    try {
      published.push({ name, appUserModelId: shell.readShortcutLink(path).appUserModelId })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`desktop: skipped unreadable Start Menu shortcut ${name}: ${message}`)
    }
  }
  for (const name of conflictingDevTaskbarShortcuts(published, shortcutName, appUserModelId)) {
    try {
      rmSync(join(programs, name))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`desktop: failed to remove the conflicting taskbar shortcut ${name}: ${message}`)
    }
  }
}

/** Directory of the built frontend dist under the desktop package root. */
const WEB_DIST_DIR = desktopWebDistDir(import.meta.url)

/** The settled host context and its shutdown controller, filled after boot. */
const host: { ctx?: Context; shutdown?: ProcessShutdown } = {}

/** The tray handle once installed; rebuilt on locale change. */
let trayHandle: TrayHandle | undefined

/** The active desktop-shell locale (defaults to Chinese). */
let currentLocale: DesktopLocaleId = 'zh'

/** The Help menu's documentation URL, resolved once at startup. */
let helpDocsUrl: string | undefined

/** The Help menu's contact page, resolved once at startup. Absent keeps the QR popup. */
let contactUrl: string | undefined

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
  return new Promise((resolve) => {
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
  installApplicationMenu(t, helpDocsUrl, contactUrl)
  trayHandle?.rebuild(t)
  setUpdaterLocale(t)
  if (win !== undefined && !win.isDestroyed()) {
    win.webContents.send('dsh:locale:change', currentLocale)
  }
}

/** The desktop log file: `DSH_DESKTOP_LOG` overrides the default userData log for headless diagnosis. */
function desktopLogPath(): string {
  return process.env.DSH_DESKTOP_LOG ?? join(app.getPath('userData'), 'desktop.log')
}

/**
 * Append a startup line to the desktop log under userData; GUI apps do not
 * surface process stderr, so failures need a durable sink for diagnosis.
 */
function log(line: string): void {
  const text = `${new Date().toISOString()} ${line}\n`
  console.error(text.trimEnd())
  try {
    const logPath = desktopLogPath()
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
  // String(args) would render every structured diagnostic as "[object Object]".
  const render = (value: unknown): string => {
    if (typeof value === 'string') return value
    try { return JSON.stringify(value) ?? String(value) } catch { return String(value) }
  }
  for (const method of ['error', 'warn'] as const) {
    const original = console[method].bind(console)
    console[method] = (...args: readonly unknown[]): void => {
      original(...args)
      try {
        const text = args.map(render).join(' ')
        appendFileSync(desktopLogPath(), `${new Date().toISOString()} host ${method}: ${text}\n`)
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
    // The OEM Deepagens display name joins the same trusted environment on the
    // same if-unset terms, ahead of the layered snapshot freezing it.
    const gatewayProviderName = resolveDesktopGatewayProviderName(
      INSTALL_ANCHOR,
      JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as DesktopProviderNameManifest,
    )
    if (gatewayProviderName !== undefined) {
      applyGatewayProviderNameEnvironment(process.env, gatewayProviderName)
    }
    // The Help menu's documentation and contact links follow the same dual
    // route: the source oem.config.json in a checkout, the packaged manifest
    // otherwise.
    const helpManifest = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as DesktopHelpManifest
    helpDocsUrl = resolveDesktopHelpDocsUrl(INSTALL_ANCHOR, helpManifest)
    contactUrl = resolveDesktopContactUrl(INSTALL_ANCHOR, helpManifest)
    // The running release version backs every client-identity reader (the
    // platform-view headers, product analytics `serviceVersion`) the way the
    // official build's inlined value would; an explicit build value wins.
    process.env.DSH_CLIENT_VERSION ??= app.getVersion()
    // Copy a previous shared home before publishing the product roots. Host boot
    // and the layered environment snapshot then read DSH_HOME.
    adoptDesktopProductData(app.getPath('appData'), process.env, undefined, [DESKTOP_PRODUCT_NAME])
    pinDesktopProductDataRoots(app.getPath('appData'), process.env)
    const bundledSkills = resolveBundledSkillDir({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
    })
    if (bundledSkills !== undefined) process.env.DSH_BUNDLED_SKILL_DIR ??= bundledSkills
    const environment = loadLayeredEnv('desktop')
    log(`desktop: product home ${process.env.DSH_HOME ?? ''} agents ${process.env.DSH_AGENTS_HOME ?? ''}`)
    log(`desktop: booting (packaged=${String(app.isPackaged)}) execArgv=${JSON.stringify(process.execArgv)} node=${process.versions.node}`)
    if (process.platform === 'darwin') {
      const applied = DARWIN_RENDERER_SWITCHES.join(' ')
      log(`desktop: macOS cpu ${cpus()[0]?.model ?? ''} renderer switches: ${applied === '' ? '(none)' : applied}`)
    }
    app.on('child-process-gone', (_event, details) => {
      if (details.type !== 'GPU') return
      log(`desktop: gpu process gone reason=${details.reason} exitCode=${details.exitCode}`)
    })
    // Office preview spawns the native helper. electron-builder leaves that helper
    // in app.asar.unpacked, and the kit resolves it while the host profile loads.
    if (app.isPackaged && installOfficeEngineResolution(app.getAppPath()) !== undefined) {
      log('desktop: office preview engine resolver installed')
    }
    log(`desktop: install location ${classifyInstallLocation(process.execPath)} (${process.execPath})`)
    const bootStatePath = join(app.getPath('userData'), BOOT_STATE_FILENAME)
    const previousBoot = readBootState(bootStatePath)
    const stuckBoots = inheritedStuckBoots(process.argv, previousBoot)
    if (previousBoot !== undefined) {
      log(`desktop: previous launch (started ${previousBoot.startedAt}) did not reach its window; stuck launches before this one: ${String(stuckBoots)}`)
    }
    const bootStartedAt = Date.now()
    let bootTree: BootEntrySource | undefined
    let bootStage: BootStage | undefined
    // The window waits for the whole host tree, so an entry that never settles
    // leaves a menu bar and no window. The watchdog logs the stage and the
    // entries still unsettled, relaunches the first stuck launches, and asks
    // once its budget is spent (desktop/boot-watchdog.ts).
    const watchdogOptions: HostBootWatchdogOptions = {
      log,
      inspect: () => inspectBootEntries(bootTree),
      onStuck: (report) => { void recoverFromStuckBoot(report, bootStatePath, stuckBoots) },
    }
    const watchdog = hostBootWatchdogEnabled(process.env, app.isPackaged)
      ? createHostBootWatchdog(watchdogOptions)
      : undefined
    if (watchdog !== undefined) writeBootState(bootStatePath, { startedAt: new Date().toISOString(), stuckBoots })
    const enterStage = (stage: BootStage, tree?: BootEntrySource): void => {
      if (tree !== undefined) bootTree = tree
      // The tree stage is reported again once the root context exists; it logs once.
      if (stage === bootStage) return
      bootStage = stage
      log(`desktop: startup stage ${stage} (+${String(Date.now() - bootStartedAt)}ms)`)
      watchdog?.stage(stage)
    }
    const result = await runDesktopBoot({
      environment,
      args: ['--no-open', '--port', '0'],
      // app.getAppPath() is a filesystem path; the loader's bare import resolves
      // against a file:// parent URL, so convert it before appending the slash.
      ...(app.isPackaged ? { bareModuleBaseUrl: pathToFileURL(app.getAppPath()).href + '/' } : {}),
      forceExit: (code) => { app.exit(code) },
      complete: (code) => { app.exit(code) },
      onStage: (stage, ctx) => { enterStage(stage, ctx?.loader) },
    })
    host.ctx = result.ctx
    host.shutdown = result.shutdown
    log('desktop: host booted')
    enterStage('office')
    // Office create tools and skills live on the in-process host (not only the
    // legacy child dsh-desktop-host). Without this mount, chat never sees
    // create_pptx / create_docx / create_xlsx and falls back to text scripts.
    await mountDesktopOffice(result.ctx, {
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
    })
    log('desktop: office tools mounted')
    // First-launch ComfyUI deployment runs beside the shell, never blocking it:
    // copying the bundled program tree takes minutes, the app works without it
    // (the remote MiniMax backend), and the module's own logging owns progress.
    if (app.isPackaged) {
      void deployBundledComfyUI({
        appRoot: app.getAppPath(),
        resourcesDir: process.resourcesPath,
        localDir: comfyuiLocalDir(process.env.LOCALAPPDATA),
        log,
      })
    }
    // The composed client graph decides what the renderer can boot: a graph
    // without application entries renders a page stuck on plugin loading
    // forever, so name its shape here. Structural read: a composition without
    // the registry must log "0 entries" instead of crashing this diagnostic.
    const modules = host.ctx.get('clientModules') as
      | { graph(): { entries: unknown[]; batches: readonly { phase: string; entries: readonly string[] }[] } }
      | undefined
    const graph = modules?.graph()
    const applicationBatches = graph?.batches.filter(batch => batch.phase === 'application').length ?? 0
    log(
      `desktop: client graph: ${String(graph?.entries.length ?? 0)} entries, `
      + `${String(applicationBatches)} application batches`,
    )

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
    registerBundleIpc(() => host.ctx?.get('clientModules'), log)
    registerPluginToggleIpc()

    // Protocol handlers and the menu must register after the app is ready.
    await app.whenReady()
    syncWindowsDevTaskbarShortcut()
    registerWebProtocol(log)
    currentLocale = readLocalePreference()
    registerMenuPopupIpc()
    registerUpdateIpc()
    registerWindowControlsIpc()

    enterStage('window')
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
    installApplicationMenu(shellT(currentLocale), helpDocsUrl, contactUrl)
    host.ctx?.on('session/event', (session, event) => {
      notifyTurnCompletion(win, currentLocale, DESKTOP_PRODUCT_NAME, String(session.id), event)
    })
    win.webContents.on('preload-error', (_event, preloadPath, error) => {
      log(`desktop: preload error ${preloadPath}: ${error.message}`)
    })
    win.webContents.on('console-message', (event) => {
      if (event.level === 'warning' || event.level === 'error') {
        log(`desktop: renderer console[${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`)
      } else if (event.level === 'info' && event.message.startsWith('[boot]')) {
        // The client boot chain's own progress lines (@deepseek-ai/dsh-client-web
        // boot-log): a wedged renderer boot must name its stuck stage in the log.
        log(`desktop: renderer ${event.message}`)
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
    // A launch declared stuck leaves its record to the recovery dialog.
    if (watchdog?.settle() === true) clearBootState(bootStatePath)
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
    log(`desktop: startup failed:\n${flattenError(error)}${startupDiagnostic(error)}`)
    app.exit(1)
  }
}

/** Dump the boot collector's warn/error records the StartupError carries, if any. */
function startupDiagnostic(error: unknown): string {
  type StartupMessages = {
    startup?: { messages?: readonly { name: string; type: string; args: readonly unknown[] }[] }
  }
  type CompositionPlugins = {
    composition?: { plugins?: readonly { id: string; module: string; state: string; missing?: readonly string[] }[] }
  }
  const lines: string[] = []
  const messages = (error as StartupMessages).startup?.messages
  if (messages !== undefined) {
    lines.push(...messages.map(({ name, type, args }) => `startup ${type} ${name}: ${args.map(String).join(' ')}`))
  }
  const plugins = (error as CompositionPlugins).composition?.plugins
  if (plugins !== undefined) {
    for (const row of plugins.filter(plugin => plugin.state !== 'active')) {
      lines.push(`entry ${row.id} (${row.module}): ${row.state}${row.missing?.length ? ` missing ${row.missing.join(', ')}` : ''}`)
    }
  }
  return lines.length === 0 ? '' : '\n' + lines.join('\n')
}

/**
 * Answer a startup the watchdog declared stuck. The first ones relaunch the
 * app, because the stall does not repeat on every launch; once the automatic
 * budget is spent, a native dialog offers one more attempt, since no window
 * exists to report through. Every path ends this process.
 * @param report - The declaring observation.
 * @param bootStatePath - Launch record that carries the budget to the next launch.
 * @param stuckBoots - Consecutive stuck launches before this one.
 */
async function recoverFromStuckBoot(report: StuckBootReport, bootStatePath: string, stuckBoots: number): Promise<void> {
  const attempts = stuckBoots + 1
  try {
    writeBootState(bootStatePath, { startedAt: new Date().toISOString(), stuckBoots: attempts })
    if (stuckBootAction(attempts) === 'relaunch') {
      log(`desktop: relaunching after the stuck startup (automatic relaunch ${String(attempts)} of ${String(HOST_BOOT_AUTO_RELAUNCHES + 1)})`)
      app.relaunch({ args: [BOOT_RELAUNCH_ARG] })
      app.exit(0)
      return
    }
    // The dialog is the only surface of a launch that has no window; bring the app forward so it is not hidden behind others.
    app.focus({ steal: true })
    const t = shellT(currentLocale)
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: t('boot.stuckTitle'),
      message: t('boot.stuckMessage'),
      detail: t('boot.stuckDetail')
        .replace('{count}', String(attempts))
        .replace('{logPath}', desktopLogPath()),
      buttons: [t('boot.stuckRetry'), t('boot.stuckQuit')],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    log(`desktop: stuck startup dialog answered ${String(response)}; last stage ${report.stage}`)
    if (response === 0) {
      clearBootState(bootStatePath)
      app.relaunch({ args: [BOOT_RELAUNCH_ARG] })
    }
    app.exit(response === 0 ? 0 : 1)
  } catch (error) {
    log(`desktop: stuck startup recovery failed:\n${flattenError(error)}`)
    app.exit(1)
  }
}

/** Read packaged metadata and resolve the desktop update feed (undefined disables updates). */
function readDesktopUpdateUrl(): string | undefined {
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

/** Delay after the page load at which a window still hidden is shown without `ready-to-show`. */
const WINDOW_SHOW_FALLBACK_MS = 3_000

/** Compose a window loading the injected index over the app scheme. */
function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    // Taskbar/alt-tab art on Windows and Linux (macOS uses the app bundle icon).
    icon: DESKTOP_TASKBAR_ICON,
    // The native title stays the OEM product name for life: Windows surfaces it as the
    // taskbar hover tooltip and alt-tab label; page-title-updated must not
    // leak session projections there (pinWindowTitle blocks adoption).
    title: DESKTOP_PRODUCT_NAME,
    // Windows and Linux are frameless; macOS keeps a hidden title bar
    // (desktop/window-chrome.ts). The renderer draws the title bar
    // (render/title-bar.ts) and drives it over the window-control IPC
    // channels below, so popup content can paint over the bar instead of
    // sitting under native traffic lights.
    ...resolveWindowChrome(process.platform),
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: resolveDesktopPreloadPath(import.meta.url),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  pinWindowTitle(win)
  // Native lights stay hidden while the renderer draws them. Fullscreen shows
  // them in the system menu bar; a hidden title bar with no lights slides
  // down empty and the menu contents are gone.
  if (process.platform === 'darwin') syncDarwinTrafficLights(win, false)
  // Native fullscreen hides the system chrome, so the renderer bar must follow:
  // render/title-bar.ts listens on this channel and hides the bar (with the
  // body's top shift) while the window is fullscreen.
  win.on('enter-full-screen', () => {
    if (win.isDestroyed()) return
    if (process.platform === 'darwin') syncDarwinTrafficLights(win, true)
    win.webContents.send('dsh:window:fullscreen-change', true)
  })
  win.on('leave-full-screen', () => {
    if (win.isDestroyed()) return
    if (process.platform === 'darwin') syncDarwinTrafficLights(win, false)
    win.webContents.send('dsh:window:fullscreen-change', false)
  })
  win.once('ready-to-show', () => { win.show() })
  // `ready-to-show` needs a first renderer frame. A renderer that presents none
  // would keep the window hidden for good, so the first page load also shows a
  // window that is still hidden shortly after.
  win.webContents.once('did-finish-load', () => {
    const fallback = setTimeout(() => {
      if (win.isDestroyed() || win.isVisible()) return
      log(`desktop: window shown ${String(WINDOW_SHOW_FALLBACK_MS)}ms after load without ready-to-show`)
      win.show()
    }, WINDOW_SHOW_FALLBACK_MS)
    fallback.unref()
  })
  return win
}

/**
 * Window-control channels the renderer's title bar sends over the generic IPC
 * bridge. Each targets the sender's own window, so a malicious page can only
 * affect the window it lives in. The zoom channel is fullscreen on macOS and
 * maximize elsewhere (toggleWindowZoom).
 */
const WINDOW_CONTROL_CHANNELS: ReadonlyArray<{ channel: string; action: (win: BrowserWindow) => void }> = [
  { channel: 'dsh:window:minimize', action: (win) => { win.minimize() } },
  { channel: 'dsh:window:toggle-maximize', action: (win) => { toggleWindowZoom(win, process.platform) } },
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
          injected = await renderDesktopIndex(ctx, WEB_DIST_DIR, undefined, undefined, writeLog)
          writeLog(`desktop: index rendered (${injected.length} chars)`)
        }
        return new Response(injected, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      }
      // Keep the app scheme usable even when a renderer request reaches the
      // protocol directly instead of the IPC fetch hook. API paths belong to
      // the in-process Host connection; they are never frontend files.
      if (pathname.startsWith('/api/')) {
        const body = await transportRequestBytes(request)
        const headers: Record<string, string> = {}
        request.headers.forEach((value, key) => { headers[key] = value })
        const req: TransportFetchRequest = {
          requestId: `protocol-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          path: `${pathname}${url.search}`,
          method: request.method,
          headers,
          ...(body === undefined ? {} : { body }),
        }
        const response = await dispatchTransportFetch(
          { connection: host.ctx?.get('connection'), gateway: host.ctx?.get('typertGateway') },
          req,
          new AbortController().signal,
        )
        const responseBody = new Uint8Array(await response.arrayBuffer())
        const responseHeaders = new Headers()
        // Media elements need the range headers to seek; the body is already buffered here, so
        // the advertised range always describes the bytes this response actually carries.
        for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
          const value = response.headers.get(name)
          if (value !== null) responseHeaders.set(name, value)
        }
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
      // Host web-server routes (open-in-app, skin CSS, previews, and the
      // skin API) live on the profile's ephemeral loopback listener. The
      // page is dshapp://, so the shell proxies those paths and completes
      // that server's token→cookie handshake once.
      if (isWebHostProxyPath(pathname)) {
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
