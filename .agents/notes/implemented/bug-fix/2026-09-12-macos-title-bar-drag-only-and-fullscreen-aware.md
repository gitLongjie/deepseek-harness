# Agent Note: the macOS title bar is drag-only and follows native fullscreen

Status: implemented

English | [中文](2026-09-12-macos-title-bar-drag-only-and-fullscreen-aware.zh.md)

## Problem

The per-platform chrome split (2026-09-07-desktop-title-bar-per-platform-chrome) still had two macOS-convention gaps. The darwin branch kept drawing the brand mark, while a macOS title bar carries only the traffic lights over a drag region — no logo. And the bar ignored fullscreen: macOS hides all window chrome in fullscreen, but the fixed-position bar stayed on top and the body's 36px top shift kept the app pushed down below an empty strip.

## Decision

`apps/desktop/src/render/title-bar.ts` renders no brand mark (and never resolves the mark source) when the platform is darwin: the bar shrinks to the drag region plus the update slot past the 80px traffic-light inset; Windows and Linux keep the branded bar. `apps/desktop/src/main/index.ts` createWindow forwards `enter-full-screen`/`leave-full-screen` over the new `dsh:window:fullscreen-change` channel, and the renderer toggles `body[data-dsh-fullscreen]`, whose stylesheet rules hide the bar, zero the body's top padding, and zero the published `--dsh-shell-top-inset` so fixed client overlays fill the full height for the duration.

## Alternatives considered

**Detecting fullscreen in CSS with the `:fullscreen` pseudo-class.** Rejected: Electron's native window fullscreen does not set the DOM fullscreen pseudo-class, so the selector never matches the state it must describe.

**Hiding the bar on every platform from one renderer heuristic.** Rejected: nothing drives Windows/Linux into window fullscreen today, so the branch would be dead code with no failing case; the channel is platform-agnostic and those platforms can adopt it by emitting the same push.

## Verification

`apps/desktop/tests/title-bar.spec.ts` asserts the darwin install renders no `.dsh-titlebar-brand`, and that the fullscreen payloads toggle `data-dsh-fullscreen` with the hide/zero rules present in the injected style text. `pnpm --filter @deepseek-ai/dsh-desktop run test` (106 tests) and `run typecheck` pass.

## Consequences

The macOS bar is empty except for the update slot, and the OEM favicon resolver no longer runs there — a missing favicon link stops failing loudly on macOS, while the document itself still consumes the link. The fullscreen push is wired on every platform, so a future `win.setFullScreen` caller on Windows or Linux gets the same bar hiding for free.
