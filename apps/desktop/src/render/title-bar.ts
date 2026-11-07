/**
 * Desktop-only custom title bar, installed by the render entry before the web
 * app boots. The window is frameless on every platform, so this module draws
 * the bar inside the page: Windows and Linux lead with the 编辑/视图/窗口/帮助
 * menu buttons (no brand mark — the sidebar owns the product identity), the
 * drag region, and the window controls; macOS draws traffic-light controls on
 * the left (the system menu bar owns the menus) and the same drag region.
 * The bar sits below portaled menus, toasts, and modal layers, and it publishes
 * the top inset those overlays already clear, so popup content is not trapped
 * under a native caption. Linux keeps the menu buttons and swaps the Windows
 * control stack for Adwaita-style circular controls without the red close
 * fill. The main process pushes native fullscreen state over
 * dsh:window:fullscreen-change and the bar hides itself, with the body shift
 * and the published insets, while the window is fullscreen.
 * @module @deepseek-ai/dsh-desktop/render/title-bar
 */

/** Title bar height in px; the body padding and the bar share it. */
export const TITLE_BAR_HEIGHT_PX = 36

/**
 * Stacking level of the bar. Modal backdrops, portaled menus, and toasts start
 * at 1000, and the sidebar column is 30, so popup content paints over the bar
 * while ordinary page chrome stays under it.
 */
const TITLE_BAR_Z_INDEX = 40

/** Extra air overlays keep below the bar, matching the frame's overlay inset. */
const OVERLAY_CLEARANCE_GAP_PX = 20

/** The platforms the title bar styles for. */
export type TitleBarPlatform = 'darwin' | 'win32' | 'linux'

/**
 * Narrow the preload bridge's `process.platform` to the styled set. Anything
 * beyond Electron's shipped desktop platforms falls through to the linux
 * chrome — the only fully renderer-drawn variant that collaborates with no
 * native title bar.
 * @param platform - the raw `process.platform` string from the preload bridge.
 * @returns the chrome variant to render.
 */
export function normalizeTitleBarPlatform(platform: string): TitleBarPlatform {
  if (platform === 'darwin' || platform === 'win32') return platform
  return 'linux'
}

/** The IPC channels the main process listens on for window controls. */
export const WINDOW_CHANNELS = {
  minimize: 'dsh:window:minimize',
  toggleMaximize: 'dsh:window:toggle-maximize',
  close: 'dsh:window:close',
} as const

/** The IPC channel asking the main process to pop up one application submenu. */
export const MENU_POPUP_CHANNEL = 'dsh:menu:popup'

/** The IPC channel the main process pushes a locale change over. */
export const LOCALE_CHANGE_CHANNEL = 'dsh:locale:change'

/**
 * The IPC channel the main process pushes native fullscreen state over: `true`
 * on enter-full-screen, `false` on leave-full-screen (wired in
 * main/index.ts createWindow). While fullscreen, the bar and the body's top
 * shift hide so the web app fills the window and the published top inset
 * reads 0.
 */
export const FULLSCREEN_CHANGE_CHANNEL = 'dsh:window:fullscreen-change'

/** Renderer title-bar copy: menu buttons and window-control accessible labels. */
const TITLE_BAR_LOCALES = {
  zh: {
    'menu.edit': '编辑',
    'menu.view': '视图',
    'menu.window': '窗口',
    'menu.help': '帮助',
    'control.minimize': '最小化',
    'control.maximize': '最大化',
    'control.zoom': '全屏',
    'control.close': '关闭',
  },
  en: {
    'menu.edit': 'Edit',
    'menu.view': 'View',
    'menu.window': 'Window',
    'menu.help': 'Help',
    'control.minimize': 'Minimize',
    'control.maximize': 'Maximize',
    'control.zoom': 'Full screen',
    'control.close': 'Close',
  },
} as const

/** Locale ids the title bar understands. */
type TitleBarLocale = keyof typeof TITLE_BAR_LOCALES

/** One localized string key used by the title bar. */
type TitleBarKey = keyof typeof TITLE_BAR_LOCALES.zh

/**
 * The visible menus, in order; ids match the top-level template items built by
 * main/desktop/menu.ts, which validates them against the same closed set.
 */
const MENUS: ReadonlyArray<{ id: string; labelKey: 'menu.edit' | 'menu.view' | 'menu.window' | 'menu.help' }> = [
  { id: 'edit', labelKey: 'menu.edit' },
  { id: 'view', labelKey: 'menu.view' },
  { id: 'window', labelKey: 'menu.window' },
  { id: 'help', labelKey: 'menu.help' },
]

/** The generic preload bridge the chrome rides (already exposed page-world). */
type IpcSender = {
  /** The preload process's `process.platform`; normalizeTitleBarPlatform narrows it. */
  readonly platform: string
  send(channel: string, payload?: unknown): void
  on?(channel: string, listener: (payload: unknown) => void): () => void
}

/** Control button metadata: accessible-label key and its 10x10 glyph path. */
interface TitleBarControl {
  channel: string
  labelKey: 'control.minimize' | 'control.maximize' | 'control.zoom' | 'control.close'
  glyph: string
  danger?: boolean
  light?: 'close' | 'minimize' | 'zoom'
}

/** Windows and Linux controls, trailing the bar: minimize, maximize, close. */
const CONTROLS: ReadonlyArray<TitleBarControl> = [
  {
    channel: WINDOW_CHANNELS.minimize,
    labelKey: 'control.minimize',
    glyph: 'M0 5h10',
  },
  {
    channel: WINDOW_CHANNELS.toggleMaximize,
    labelKey: 'control.maximize',
    glyph: 'M0.5 0.5h9v9h-9z',
  },
  {
    channel: WINDOW_CHANNELS.close,
    labelKey: 'control.close',
    glyph: 'M0 0l10 10M10 0L0 10',
    danger: true,
  },
]

/**
 * macOS traffic lights, leading the bar. Close, minimize, then zoom — the
 * green light toggles fullscreen through the shared zoom channel.
 */
const MACOS_CONTROLS: ReadonlyArray<TitleBarControl> = [
  {
    channel: WINDOW_CHANNELS.close,
    labelKey: 'control.close',
    glyph: 'M0 0l10 10M10 0L0 10',
    light: 'close',
  },
  {
    channel: WINDOW_CHANNELS.minimize,
    labelKey: 'control.minimize',
    glyph: 'M0 5h10',
    light: 'minimize',
  },
  {
    channel: WINDOW_CHANNELS.toggleMaximize,
    labelKey: 'control.zoom',
    glyph: 'M5 1v8M1 5h8',
    light: 'zoom',
  },
]

/** Re-render the localized text of the menu buttons and window controls. */
function applyTitleBarLocale(locale: TitleBarLocale, doc: Document): void {
  doc.querySelectorAll<HTMLButtonElement>('#dsh-desktop-titlebar .dsh-titlebar-menu-btn').forEach((button) => {
    const key = button.dataset.labelKey as TitleBarKey
    button.textContent = TITLE_BAR_LOCALES[locale][key]
  })
  doc.querySelectorAll<HTMLButtonElement>(
    '#dsh-desktop-titlebar .dsh-titlebar-controls button, #dsh-desktop-titlebar .dsh-titlebar-traffic button',
  ).forEach((button) => {
    const key = button.dataset.labelKey as TitleBarKey
    button.setAttribute('aria-label', TITLE_BAR_LOCALES[locale][key])
  })
}

/** The injected stylesheet: app shift, bar chrome, drag regions, hover states. */
const SHARED_STYLE_TEXT = `
html, body { height: 100%; }
html {
  --dsh-shell-top-inset: ${TITLE_BAR_HEIGHT_PX}px;
  --dsh-frame-chrome-top: ${TITLE_BAR_HEIGHT_PX}px;
  --dsh-frame-overlay-top: ${TITLE_BAR_HEIGHT_PX + OVERLAY_CLEARANCE_GAP_PX}px;
}
body {
  box-sizing: border-box;
  padding-top: ${TITLE_BAR_HEIGHT_PX}px;
}
#dsh-desktop-titlebar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: ${TITLE_BAR_HEIGHT_PX}px;
  z-index: ${TITLE_BAR_Z_INDEX};
  display: flex;
  align-items: center;
  box-sizing: border-box;
  padding: 0 4px 0 12px;
  background: var(--dsw-alias-bg-base, #fff);
  border-bottom: 1px solid var(--dsw-alias-border-subtle, rgba(0, 0, 0, 0.08));
  color: var(--dsw-alias-label-primary, #0f1115);
  font-family: var(--dsw-font-family, 'Segoe UI', 'Microsoft YaHei', sans-serif);
  font-size: 12px;
  user-select: none;
  -webkit-app-region: drag;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
/* Portaled overlays follow the bar in document order. no-drag on them wins
   the overlap, so a popup that paints over the bar still receives the click. */
body > :not(#root):not(#dsh-desktop-titlebar) {
  -webkit-app-region: no-drag;
}
html body #dsh-desktop-titlebar,
html[data-platform='darwin'] body #dsh-desktop-titlebar {
  -webkit-app-region: drag;
}
#dsh-desktop-titlebar .dsh-titlebar-menubar {
  display: inline-flex;
  align-items: center;
  height: 100%;
  margin-left: -8px;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}
#dsh-desktop-titlebar .dsh-titlebar-menu-btn {
  height: 100%;
  padding: 0 10px;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: default;
  transition: background-color 0.08s ease;
}
#dsh-desktop-titlebar .dsh-titlebar-menu-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
}
#dsh-desktop-titlebar .dsh-titlebar-spacer {
  flex: 1;
  height: 100%;
  min-width: 4px;
}
#dsh-desktop-titlebar .dsh-titlebar-update-slot {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  height: 100%;
  -webkit-app-region: no-drag;
}
#dsh-desktop-titlebar .dsh-titlebar-controls {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}
#dsh-desktop-titlebar .dsh-titlebar-controls button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  cursor: default;
  transition: background-color 0.08s ease, color 0.08s ease;
}
#dsh-desktop-titlebar .dsh-titlebar-controls button:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
}
#dsh-desktop-titlebar button:focus-visible {
  outline: 1px solid var(--dsw-alias-interactive-focus, #6187d8);
  outline-offset: -2px;
}
body[data-dsh-fullscreen='true'] {
  padding-top: 0;
}
html:has(body[data-dsh-fullscreen='true']) {
  --dsh-shell-top-inset: 0px;
  --dsh-frame-chrome-top: 0px;
  --dsh-frame-overlay-top: ${OVERLAY_CLEARANCE_GAP_PX}px;
}
body[data-dsh-fullscreen='true'] #dsh-desktop-titlebar {
  display: none;
}
`

/** Windows control geometry: full-height rectangles and the red close fill. */
const WINDOWS_STYLE_TEXT = `
#dsh-desktop-titlebar .dsh-titlebar-controls button {
  width: 46px;
  height: ${TITLE_BAR_HEIGHT_PX}px;
}
#dsh-desktop-titlebar .dsh-titlebar-controls button.dsh-titlebar-close:hover {
  background: #e81123;
  color: #fff;
}
`

/**
 * Linux control geometry: Adwaita-style header-bar buttons — circular neutral
 * hover indicators with a gap between them; no red close fill.
 */
const LINUX_STYLE_TEXT = `
#dsh-desktop-titlebar .dsh-titlebar-controls {
  gap: 6px;
  padding-right: 6px;
}
#dsh-desktop-titlebar .dsh-titlebar-controls button {
  width: 26px;
  height: 26px;
  border-radius: 50%;
}
`

/**
 * macOS traffic lights: 12px circles inside a 20px hit target, leading the bar.
 * The glyph stays hidden until hover, matching the system lights.
 */
const MACOS_STYLE_TEXT = `
#dsh-desktop-titlebar .dsh-titlebar-traffic {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  height: 100%;
  gap: 8px;
  margin-left: 8px;
  margin-right: 4px;
  -webkit-app-region: no-drag;
}
#dsh-desktop-titlebar .dsh-titlebar-traffic button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 4px;
  border: none;
  border-radius: 50%;
  background-clip: content-box;
  color: transparent;
  cursor: default;
}
#dsh-desktop-titlebar .dsh-titlebar-traffic button:hover {
  color: rgb(0 0 0 / 0.55);
}
#dsh-desktop-titlebar .dsh-titlebar-traffic button[data-light='close'] { background-color: #ff5f57; }
#dsh-desktop-titlebar .dsh-titlebar-traffic button[data-light='minimize'] { background-color: #febc2e; }
#dsh-desktop-titlebar .dsh-titlebar-traffic button[data-light='zoom'] { background-color: #28c840; }
`

/**
 * Compose the stylesheet for one chrome variant. The platform blocks only add
 * geometry and the Windows close fill; layout, drag, and hover behavior stay in
 * the shared block.
 * @param platform - the narrowed chrome variant.
 * @returns the full stylesheet text to inject.
 */
function titleBarStyleText(platform: TitleBarPlatform): string {
  if (platform === 'darwin') return SHARED_STYLE_TEXT + MACOS_STYLE_TEXT
  if (platform === 'win32') return SHARED_STYLE_TEXT + WINDOWS_STYLE_TEXT
  return SHARED_STYLE_TEXT + LINUX_STYLE_TEXT
}

/** Append one platform's window-control buttons and wire each to its IPC channel. */
function appendWindowButtons(doc: Document, parent: HTMLElement, controls: ReadonlyArray<TitleBarControl>, ipc: IpcSender): void {
  for (const control of controls) {
    const button = doc.createElement('button')
    button.type = 'button'
    button.dataset.labelKey = control.labelKey
    button.setAttribute('aria-label', TITLE_BAR_LOCALES.zh[control.labelKey])
    if (control.danger === true) button.className = 'dsh-titlebar-close'
    if (control.light !== undefined) button.dataset.light = control.light
    button.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="${control.glyph}" stroke="currentColor" stroke-width="1"/></svg>`
    button.addEventListener('click', () => {
      ipc.send(control.channel)
    })
    parent.append(button)
  }
}

/**
 * Install the title bar: inject the platform's stylesheet, build the bar DOM,
 * wire the menu buttons to the popup channel, and the controls to the IPC
 * bridge. The render entry runs as a head script, so the bar's body mount
 * defers to DOMContentLoaded when the body is not parsed yet; everything else
 * (style, listeners) touches only the head and window. Idempotence is not
 * required — the entry runs exactly once per document.
 * @param doc - the live document.
 * @param ipc - the preload bridge used for the platform, the menu channel, and
 *   the control channels.
 */
export function installTitleBar(doc: Document, ipc: IpcSender): void {
  const platform = normalizeTitleBarPlatform(ipc.platform)
  const style = doc.createElement('style')
  style.id = 'dsh-desktop-titlebar-style'
  style.textContent = titleBarStyleText(platform)
  doc.head.appendChild(style)

  const bar = doc.createElement('div')
  bar.id = 'dsh-desktop-titlebar'

  // macOS keeps menus in the system menu bar and draws traffic lights here.
  // Windows and Linux draw the in-window menus because they have no system bar.
  if (platform === 'darwin') {
    const traffic = doc.createElement('span')
    traffic.className = 'dsh-titlebar-traffic'
    appendWindowButtons(doc, traffic, MACOS_CONTROLS, ipc)
    bar.append(traffic)
  } else {
    const menubar = doc.createElement('span')
    menubar.className = 'dsh-titlebar-menubar'
    for (const menu of MENUS) {
      const button = doc.createElement('button')
      button.type = 'button'
      button.className = 'dsh-titlebar-menu-btn'
      button.dataset.labelKey = menu.labelKey
      button.textContent = TITLE_BAR_LOCALES.zh[menu.labelKey]
      button.setAttribute('aria-haspopup', 'menu')
      button.addEventListener('click', () => {
        // Window coordinates: the popup anchors just below the clicked button.
        const rect = button.getBoundingClientRect()
        ipc.send(MENU_POPUP_CHANNEL, { id: menu.id, x: Math.round(rect.left), y: Math.round(rect.bottom) + 4 })
      })
      menubar.append(button)
    }
    bar.append(menubar)
  }

  const spacer = doc.createElement('span')
  spacer.className = 'dsh-titlebar-spacer'

  const updateSlot = doc.createElement('span')
  updateSlot.className = 'dsh-titlebar-update-slot'

  bar.append(spacer, updateSlot)

  if (platform !== 'darwin') {
    const controlsWrap = doc.createElement('span')
    controlsWrap.className = 'dsh-titlebar-controls'
    appendWindowButtons(doc, controlsWrap, CONTROLS, ipc)
    bar.append(controlsWrap)
  }

  bar.addEventListener('dblclick', (event) => {
    const target = event.target
    if (target instanceof Element && target.closest('button') !== null) return
    ipc.send(WINDOW_CHANNELS.toggleMaximize)
  })

  // The declared DOM types keep `body` non-null, but a head-phase script
  // really observes it before parse; the omitted-property view keeps the
  // deferral honest to both the runtime and the type pass.
  const docView = doc as Omit<Document, 'body'> & { body?: HTMLElement | null }
  const mount = (): void => {
    (docView.body as HTMLElement).prepend(bar)
  }
  if (docView.body === undefined || docView.body === null) {
    // Re-read at fire time: by DOMContentLoaded the parsed body exists.
    doc.addEventListener('DOMContentLoaded', mount, { once: true })
  } else {
    mount()
  }

  // Follow the main process's locale pushes so the bar text matches the
  // application menu. The main process seeds the current locale after load.
  ipc.on?.(LOCALE_CHANGE_CHANNEL, (payload: unknown) => {
    applyTitleBarLocale(payload === 'en' ? 'en' : 'zh', doc)
  })

  // Native fullscreen covers the system chrome, so the bar goes with it; the
  // body shift and the published top inset follow so client overlays fill the
  // full height. Read at event time: the head-phase install precedes <body>.
  ipc.on?.(FULLSCREEN_CHANGE_CHANNEL, (payload: unknown) => {
    if (payload === true) {
      doc.body.dataset.dshFullscreen = 'true'
      doc.documentElement.setAttribute('data-fullscreen', '')
    } else {
      delete doc.body.dataset.dshFullscreen
      doc.documentElement.removeAttribute('data-fullscreen')
    }
  })
}
