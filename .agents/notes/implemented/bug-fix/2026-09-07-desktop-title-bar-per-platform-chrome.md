# Agent Note: the desktop title bar styles per platform instead of shipping the Windows chrome everywhere

Status: implemented

English | [中文](2026-09-07-desktop-title-bar-per-platform-chrome.zh.md)

## Problem

`createWindow` built the main window with `frame: false` on every platform, and the renderer title bar (`apps/desktop/src/render/title-bar.ts`) unconditionally drew the Windows chrome: the in-window 编辑/视图/窗口/帮助 menu buttons and the right-hand rectangular minimize/maximize/close stack with the red close fill. Packaged macOS builds therefore had no traffic lights at all — fully frameless windows carry none — while showing Windows controls, and packaged Linux builds wore the Windows look too. Nothing on the renderer side knew which platform it was drawing for.

## Decision

The window factory resolves frame chrome per platform through `apps/desktop/src/main/desktop/window-chrome.ts`. Every platform, including macOS, is frameless; the renderer draws the controls, as recorded in [renderer-drawn title bars](2026-11-07-renderer-drawn-desktop-title-bar.md). The preload bridge exposes `process.platform` as `platform`, and the renderer title bar branches on it: macOS draws traffic-light controls on the left and no in-window menus — the system menu bar owns the menus; Windows keeps the rectangular minimize/maximize/close stack with the red close fill and the in-window menus; Linux keeps the in-window menu buttons (GNOME has no global menu bar) and swaps the Windows rectangles for Adwaita-style circular neutral hover controls without the red close fill. Unknown preload platform strings fall through to the linux chrome.

## Alternatives considered

**Custom-drawing the macOS traffic lights so one code path serves all platforms.** Originally rejected: the native lights carry a secondary-click window menu and option-click close, and replacing them with Windows controls was the defect this note fixed. [Renderer-drawn title bars](2026-11-07-renderer-drawn-desktop-title-bar.md) now draws macOS-shaped lights in the page, because a native caption covers popup content. The lights are not the Windows rectangles.

**Treating Linux like Windows, as VS Code does.** Rejected: the defect report is that the platforms must differ; GNOME/libadwaita header bars use circular neutral controls, and nothing on Linux depends on the red close fill or the full-height rectangles.

## Verification

`apps/desktop/tests/window-chrome.spec.ts` locks frameless chrome for darwin, win32, linux, and an unknown platform. `apps/desktop/tests/title-bar.spec.ts` covers the three renderer variants (macOS: traffic lights, no menus; Windows: rectangular chrome with the red close; Linux: menus plus circular controls without the red fill) and the platform fall-through.

## Consequences

Packaged macOS shows renderer-drawn traffic lights and no in-window menus; Linux visibly diverges from Windows. The window-control and menu-popup IPC channels stay registered on every platform, and macOS sends the window-control channels from its lights. The native-light behaviors given up are recorded in [renderer-drawn title bars](2026-11-07-renderer-drawn-desktop-title-bar.md).
