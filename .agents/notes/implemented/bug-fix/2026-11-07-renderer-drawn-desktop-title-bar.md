# Agent Note: the desktop title bar is drawn by the renderer on Windows and macOS

Status: implemented

English | [中文](2026-11-07-renderer-drawn-desktop-title-bar.zh.md)

## Problem

The desktop window still mixed a page-drawn bar with a native caption. Windows and Linux were frameless, but the bar used the maximum z-index, so it painted over menus, toasts, and the top of dialogs. macOS kept native traffic lights with `titleBarStyle: 'hiddenInset'`. That caption is composited above the page, so popup content that reaches the top of the window stays covered no matter which z-index the page assigns.

## Decision

`resolveWindowChrome` returns `{ frame: false }` on every platform, including macOS. `apps/desktop/src/render/title-bar.ts` draws the bar in the page. Windows keeps the in-window menus and the rectangular minimize/maximize/close stack with the red close fill. Linux keeps the menus and the circular controls. macOS draws close, minimize, and zoom lights on the left and no in-window menus; the system menu bar owns the menus, and the green light toggles fullscreen through `toggleWindowZoom`. A double-click on the drag region sends the same zoom channel and ignores clicks that start on a button.

The bar's z-index is 40, below modal backdrops (1000) and portaled menus and toasts (1100), and above ordinary page chrome. It publishes `--dsh-shell-top-inset`, `--dsh-frame-chrome-top`, and `--dsh-frame-overlay-top` on `html`. `overlayTopMargin` uses `--dsh-frame-top-clearance` when the frame sets it, and otherwise the shell inset, so menus clear the 36px bar. Fullscreen still hides the bar and also sets `html[data-fullscreen]`. Body-level overlays other than the bar are `-webkit-app-region: no-drag`, so a popup that overlaps the bar receives the click.

## Alternatives considered

**Keeping the native caption and only insetting popups.** Rejected: a native caption, including `hiddenInset` traffic lights, is not page content. Any popup that must occupy that band stays underneath it. See the earlier split in [per-platform title bar chrome](2026-09-07-desktop-title-bar-per-platform-chrome.md).

**Lowering the bar's z-index while leaving the macOS lights native.** Rejected: the lights composite above every page z-index, so the Windows fix would not apply to macOS.

**Activating `data-windows-titlebar` or `data-platform='darwin'` so the client caption layout supplies the inset.** Rejected: that macOS layout reserves a second strip for native lights inside the page, on top of the renderer bar. The shell publishes the inset variables directly and does not set those attributes.

## Consequences

macOS no longer has the native traffic-light menu (secondary click) or option-click close to quit. The green light enters fullscreen rather than the system zoom. Windows and Linux control appearance is unchanged. Popup content clears the bar through the published inset and paints over the bar when the two overlap. The client `data-platform='darwin'` rules that pad for native lights remain in the page and stay inactive, because the shell does not set that attribute. Fullscreen hiding from [the fullscreen title bar note](2026-09-12-macos-title-bar-drag-only-and-fullscreen-aware.md) still applies, and the macOS zoom control now drives it.

## Verification

`apps/desktop/tests/window-chrome.spec.ts` locks frameless chrome on darwin, win32, linux, and an unknown platform, and locks fullscreen versus maximize. `apps/desktop/tests/title-bar.spec.ts` covers the macOS lights, the Windows and Linux controls, the inset variables, z-index 40, double-click zoom, and the fullscreen attributes. `packages/client/ui-primitives/tests/overlay-top-margin.client.spec.ts` covers the shell-inset fallback.
