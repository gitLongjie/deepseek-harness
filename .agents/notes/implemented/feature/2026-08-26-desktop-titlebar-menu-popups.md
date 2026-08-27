# Agent Note: Desktop title bar menu buttons popping native submenus

Status: implemented

English | [中文](2026-08-26-desktop-titlebar-menu-popups.zh.md)

## Problem

The desktop shell runs frameless, so Windows and Linux never draw a native menu bar; the application menu that `installApplicationMenu()` installs was reachable only through its accelerators. The visible chrome was the brand mark and three window controls, leaving a new user no discoverable path to reload, zoom, dev tools, autostart, or about. The hidden template had also drifted away from anything usable on the primary platform: a Window entry calling the macOS-only dock API, help entries pointing at sites this project does not own, and a File menu whose single item duplicated the window close affordance. Closing the window hides it to the tray, and the tray click was the only way back.

## Decision

The application menu keeps a native template with stable top-level ids — `edit` (standard editing roles), `view` (reload, dev tools, zoom, fullscreen), `window` (minimize, zoom, close, plus 显示主窗口, which restores, shows, and focuses every app window), `help` (GitHub repository, GitHub Discussions feedback, about), the darwin `appMenu` role, and an App menu holding 登录时启动, dev tools, and 退出. Every item pins an explicit Chinese `label`; roles keep their accelerators and platform behavior while display text no longer follows the OS locale. Help links only to surfaces this repository actually owns.

The title bar draws the brand mark alone — no title text; the sidebar owns the product name and the native window title is pinned to it (see [Desktop window title pinned to the bare product name](2026-08-26-desktop-window-title-pinned.md)) — plus the 编辑/视图/窗口/帮助 buttons between the mark and the window controls. A click sends `dsh:menu:popup` with `{ id, x, y }` — the top-level menu id and the button position in window coordinates — over the same generic preload bridge the window controls ride. `registerMenuPopupIpc()` validates the wire payload (id against the closed `{ edit, view, window, help }` set; coordinates optional but valid as a pair, otherwise the request is dropped), then anchors the matching native submenu at those coordinates with `Menu.getApplicationMenu()?.getMenuItemById(id)?.submenu?.popup({ window })`, targeting the sender's own window like every other fire-and-forget desktop channel. Menu accelerators stay registered globally whether or not a popup is open.

## Alternatives considered

**Render the whole menu system in HTML inside the renderer.** Rejected because it would reimplement keyboard accelerators, role localization, and platform submenu behavior that Electron already owns; popping the native submenu keeps those for free.

**Un-frame selectively (`titleBarStyle`, `autoHideMenuBar`) to reveal a native menu bar.** Rejected because Windows frameless windows have no menu bar to reveal and the alternatives trade away the branded custom bar this shell exists to draw.

**Keep the menu accelerator-only.** Rejected because the gap was discoverability: invisible menus answer none of what a first-time user looks for.

**A settings gear in the title bar dispatching a custom DOM event.** Rejected for now because the GUI opens its settings panel through the slot-system trigger owned by ui-settings-general, and no page-world programmatic opener exists — the button would be dead chrome. It returns when such an extension point exists.

## Verification

`apps/desktop/tests/menu.spec.ts` pins the closed id set, a valid-role invariant collected against the Electron 44 role union (the class of bug where a mistyped role fails at runtime), the restore-hidden-windows click, the help-link allowlist, and popup-channel validation including unknown ids, non-object payloads, half-invalid coordinate pairs, and unknown senders. `apps/desktop/tests/title-bar.spec.ts` pins the logo-only brand (no text node beside the mark), the button order and `aria-haspopup` labels, the popup payload shape, control-channel routing, and the head-phase mount deferral. `tsc -p apps/desktop` passes.

## Consequences

Every platform now shows working 编辑/视图/窗口/帮助 menus with native accelerators and pinned Chinese text, and a tray-hidden session regains a keyboard-reachable restore path through 窗口 → 显示主窗口. A page can only pop menus into its own window, preserving the sender-scoped trust pattern of the existing channels. The bar carries four more buttons and no text; the body-padding layout mechanism is untouched. The File menu is gone; its single item remains available as 窗口 → 关闭窗口 and the title bar ✕. Menus no longer follow an English OS locale — intended, because product copy is Chinese.
