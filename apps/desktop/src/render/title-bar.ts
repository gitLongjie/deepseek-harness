/**
 * Desktop-only custom title bar, installed by the render entry before the web
 * app boots. The window runs frameless; this module draws the branded bar
 * (the brand mark alone — the sidebar owns the product name and the native
 * window title stays pinned to it), the 编辑/视图/窗口/帮助 menu buttons, the
 * drag region, and the window controls; shifts the app below it through a body
 * top padding — the GUI sizes itself with percentage heights, so the padding
 * shrinks every layer cleanly; routes menu clicks to the main-process
 * application menu over IPC and drives the window controls over the existing
 * generic bridge.
 * @module @deepseek-ai/dsh-desktop/render/title-bar
 */

/** Title bar height in px; the body padding and the bar share it. */
export const TITLE_BAR_HEIGHT_PX = 36

/** The IPC channels the main process listens on for window controls. */
export const WINDOW_CHANNELS = {
  minimize: 'dsh:window:minimize',
  toggleMaximize: 'dsh:window:toggle-maximize',
  close: 'dsh:window:close',
} as const

/** The IPC channel asking the main process to pop up one application submenu. */
export const MENU_POPUP_CHANNEL = 'dsh:menu:popup'

/**
 * The visible menus, in order; ids match the top-level template items built by
 * main/desktop/menu.ts, which validates them against the same closed set.
 */
const MENUS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'edit', label: '编辑' },
  { id: 'view', label: '视图' },
  { id: 'window', label: '窗口' },
  { id: 'help', label: '帮助' },
]

/** The generic preload bridge the controls ride (already exposed page-world). */
type IpcSender = { send(channel: string, payload?: unknown): void }

/** Control button metadata: accessible label and its 10x10 glyph path. */
const CONTROLS: ReadonlyArray<{ channel: string; label: string; glyph: string; danger?: boolean }> = [
  {
    channel: WINDOW_CHANNELS.minimize,
    label: '最小化',
    glyph: 'M0 5h10',
  },
  {
    channel: WINDOW_CHANNELS.toggleMaximize,
    label: '最大化',
    glyph: 'M0.5 0.5h9v9h-9z',
  },
  {
    channel: WINDOW_CHANNELS.close,
    label: '关闭',
    glyph: 'M0 0l10 10M10 0L0 10',
    danger: true,
  },
]

/** The injected stylesheet: app shift, bar chrome, drag regions, hover states. */
const STYLE_TEXT = `
html, body { height: 100%; }
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
  z-index: 2147483647;
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
#dsh-desktop-titlebar .dsh-titlebar-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex-shrink: 0;
}
#dsh-desktop-titlebar .dsh-titlebar-brand img {
  width: 20px;
  height: 20px;
  display: block;
  border-radius: 4px;
  opacity: 0.9;
}
#dsh-desktop-titlebar .dsh-titlebar-menubar {
  display: inline-flex;
  align-items: center;
  height: 100%;
  margin-left: 10px;
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
#dsh-desktop-titlebar .dsh-titlebar-controls {
  display: inline-flex;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}
#dsh-desktop-titlebar .dsh-titlebar-controls button {
  width: 46px;
  height: ${TITLE_BAR_HEIGHT_PX}px;
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
#dsh-desktop-titlebar .dsh-titlebar-controls button.dsh-titlebar-close:hover {
  background: #e81123;
  color: #fff;
}
#dsh-desktop-titlebar button:focus-visible {
  outline: 1px solid var(--dsw-alias-interactive-focus, #6187d8);
  outline-offset: -2px;
}
`

/**
 * Install the title bar: inject the stylesheet, build the bar DOM, wire the
 * menu buttons to the popup channel, and the controls to the IPC bridge. The
 * render entry runs as a head script, so the bar's body mount defers to
 * DOMContentLoaded when the body is not parsed yet; everything else (style,
 * listeners) touches only the head and window. Idempotence is not required —
 * the entry runs exactly once per document.
 * @param doc - the live document.
 * @param ipc - the preload bridge used for the menu and control channels.
 * @param markSrc - the brand mark image source (relative to the document).
 */
export function installTitleBar(doc: Document, ipc: IpcSender, markSrc: string): void {
  const style = doc.createElement('style')
  style.id = 'dsh-desktop-titlebar-style'
  style.textContent = STYLE_TEXT
  doc.head.appendChild(style)

  const bar = doc.createElement('div')
  bar.id = 'dsh-desktop-titlebar'

  const brand = doc.createElement('span')
  brand.className = 'dsh-titlebar-brand'
  const mark = doc.createElement('img')
  mark.src = markSrc
  mark.alt = ''
  brand.append(mark)

  const menubar = doc.createElement('span')
  menubar.className = 'dsh-titlebar-menubar'
  for (const menu of MENUS) {
    const button = doc.createElement('button')
    button.type = 'button'
    button.className = 'dsh-titlebar-menu-btn'
    button.textContent = menu.label
    button.setAttribute('aria-haspopup', 'menu')
    button.addEventListener('click', () => {
      // Window coordinates: the popup anchors just below the clicked button.
      const rect = button.getBoundingClientRect()
      ipc.send(MENU_POPUP_CHANNEL, { id: menu.id, x: Math.round(rect.left), y: Math.round(rect.bottom) + 4 })
    })
    menubar.append(button)
  }

  const spacer = doc.createElement('span')
  spacer.className = 'dsh-titlebar-spacer'

  const controlsWrap = doc.createElement('span')
  controlsWrap.className = 'dsh-titlebar-controls'

  for (const control of CONTROLS) {
    const button = doc.createElement('button')
    button.type = 'button'
    button.setAttribute('aria-label', control.label)
    if (control.danger === true) button.className = 'dsh-titlebar-close'
    button.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="${control.glyph}" stroke="currentColor" stroke-width="1"/></svg>`
    button.addEventListener('click', () => {
      ipc.send(control.channel)
    })
    controlsWrap.append(button)
  }

  bar.append(brand, menubar, spacer, controlsWrap)

  // The declared DOM types keep `body` non-null, but a head-phase script
  // really observes it before parse; the omitted-property view keeps the
  // deferral honest to both the runtime and the type pass.
  const docView = doc as Omit<Document, 'body'> & { body?: HTMLElement | null }
  if (docView.body === undefined || docView.body === null) {
    // Re-read at fire time: by DOMContentLoaded the parsed body exists.
    doc.addEventListener('DOMContentLoaded', () => { (docView.body as HTMLElement).prepend(bar) }, { once: true })
  } else {
    docView.body.prepend(bar)
  }
}
