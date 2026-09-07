# Agent Note: the desktop title bar styles per platform instead of shipping the Windows chrome everywhere

Status: implemented

English | [中文](2026-09-07-desktop-title-bar-per-platform-chrome.zh.md)

## Problem

`createWindow` built the main window with `frame: false` on every platform, and the renderer title bar (`apps/desktop/src/render/title-bar.ts`) unconditionally drew the Windows chrome: the in-window 编辑/视图/窗口/帮助 menu buttons and the right-hand rectangular minimize/maximize/close stack with the red close fill. Packaged macOS builds therefore had no traffic lights at all — fully frameless windows carry none — while showing Windows controls, and packaged Linux builds wore the Windows look too. Nothing on the renderer side knew which platform it was drawing for.

## Decision

The window factory resolves frame chrome per platform through `apps/desktop/src/main/desktop/window-chrome.ts`: macOS creates the window with `titleBarStyle: 'hiddenInset'` plus `trafficLightPosition` centering the 12px lights in the 36px bar, so the native traffic lights survive over the custom bar; Windows and Linux stay fully frameless. The preload bridge exposes `process.platform` as `platform`, and the renderer title bar branches on it: macOS renders only the brand, the drag region, and the update slot past an 80px traffic-light inset — the system menu bar owns the menus and the lights own minimize/maximize/close; Windows keeps the existing chrome unchanged; Linux keeps the in-window menu buttons (GNOME has no global menu bar) and swaps the Windows rectangles for Adwaita-style circular neutral hover controls without the red close fill. Unknown preload platform strings fall through to the linux chrome, the only variant drawn entirely by the renderer.

## Alternatives considered

**Custom-drawing the macOS traffic lights so one code path serves all platforms.** Rejected: the native lights carry platform behaviors a redraw cannot keep (secondary-click window menu, option-close quit) and the HIG placement; replacing them with Windows controls is precisely the defect being fixed.

**Treating Linux like Windows, as VS Code does.** Rejected: the defect report is that the platforms must differ; GNOME/libadwaita header bars use circular neutral controls, and nothing on Linux depends on the red close fill or the full-height rectangles.

## Verification

`apps/desktop/tests/window-chrome.spec.ts` locks the per-platform options and the invariant that the pinned lights center in the renderer's `TITLE_BAR_HEIGHT_PX`; `apps/desktop/tests/title-bar.spec.ts` covers all three renderer variants (macOS: no menus, no controls, lights inset; Windows: unchanged chrome with the red close; Linux: menus plus circular controls without the red fill) and the platform fall-through. `pnpm --filter @deepseek-ai/dsh-desktop run test` and `run typecheck` pass.

## Consequences

Packaged macOS shows native traffic lights and no in-window menus; Linux visibly diverges from Windows. The window-control and menu-popup IPC channels stay registered on every platform, but nothing sends them from macOS. The bar height is now restated on the main side for the light geometry, tied to the renderer constant by the centering test rather than a shared import, because the package tsc program compiles only `src/main` and `src/preload`.
