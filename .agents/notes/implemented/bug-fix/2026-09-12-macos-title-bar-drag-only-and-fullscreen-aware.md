# Agent Note: the macOS title bar follows native fullscreen

Status: implemented

English | [中文](2026-09-12-macos-title-bar-drag-only-and-fullscreen-aware.zh.md)

## Problem

The per-platform chrome split (2026-09-07-desktop-title-bar-per-platform-chrome) still had two macOS-convention gaps. The darwin branch kept drawing the brand mark, while a macOS title bar carries only the traffic lights over a drag region — no logo. And the bar ignored fullscreen: macOS hides all window chrome in fullscreen, but the fixed-position bar stayed on top and the body's 36px top shift kept the app pushed down below an empty strip.

## Decision

`apps/desktop/src/render/title-bar.ts` renders no brand mark when the platform is darwin. The traffic lights are drawn in the page, not left as an empty inset; that chrome is recorded in [renderer-drawn title bars](2026-11-07-renderer-drawn-desktop-title-bar.md). `apps/desktop/src/main/index.ts` createWindow forwards `enter-full-screen`/`leave-full-screen` over `dsh:window:fullscreen-change`, and the renderer toggles `body[data-dsh-fullscreen]` and `html[data-fullscreen]`. Those rules hide the bar, zero the body's top padding, and zero the published top insets so fixed client overlays fill the window for the duration. The macOS zoom light calls `setFullScreen`, so this path is what that control drives.

## Alternatives considered

**Detecting fullscreen in CSS with the `:fullscreen` pseudo-class.** Rejected: Electron's native window fullscreen does not set the DOM fullscreen pseudo-class, so the selector never matches the state it must describe.

**Hiding the bar on every platform from one renderer heuristic.** Rejected: nothing drives Windows/Linux into window fullscreen today, so the branch would be dead code with no failing case; the channel is platform-agnostic and those platforms can adopt it by emitting the same push.

## Verification

`apps/desktop/tests/title-bar.spec.ts` asserts the darwin install renders traffic lights and no menu buttons, and that fullscreen payloads toggle `data-dsh-fullscreen` and `data-fullscreen` with the hide/zero rules present in the injected style text.

## Consequences

The macOS bar draws traffic lights, the drag region, and the update slot, and it does not resolve a brand mark. The fullscreen push is wired on every platform. The macOS zoom control calls `setFullScreen`, and a `win.setFullScreen` caller on Windows or Linux gets the same bar hiding.
