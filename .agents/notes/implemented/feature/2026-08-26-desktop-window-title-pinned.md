# Agent Note: Desktop window title pinned to the bare product name

Status: implemented

English | [中文](2026-08-26-desktop-window-title-pinned.zh.md)

## Problem

The desktop shell never set a native window title, so Electron adopted whatever
the loaded page carried: first the dist index's `<title>` (深度Works Local Build),
then every projection of the selected session title (`<session title> —
<product title>` from DocumentTitle). On Windows those strings are shell-visible:
hovering the taskbar button shows the window title as a tooltip, and alt-tab
lists it too — build jargon and per-session text where the user expects the
product name.

## Decision

`createWindow()` constructs the BrowserWindow with `title: DESKTOP_WINDOW_TITLE`
(深度Works) and `pinWindowTitle()` prevents every `page-title-updated` event, so
the native title stays the bare product name for the window's whole life. The
tray tooltip carries the same string. The renderer keeps full ownership of
`document.title` — browser tabs still show session titles — but that value no
longer reaches any native shell surface.

## Alternatives considered

**Change the renderer instead (DSH_CLIENT_TITLE / drop the session suffix).**
Rejected because it trades away the browser GUI's title behavior to fix a
desktop-shell surface; the main process already owns the native window, so
blocking adoption there leaves every other consumer untouched.

**Keep adopting document.title and reset it on a timer / focus events.**
Rejected as racy bookkeeping around an event Electron provides precisely for
this choice.

## Verification

`apps/desktop/tests/window-title.spec.ts` pins DESKTOP_WINDOW_TITLE to 深度Works
and asserts every emitted page-title-updated is preventDefault-ed.
`pnpm --filter @deepseek-ai/dsh-desktop run test` passes.

## Consequences

Windows taskbar hover tooltips and alt-tab show only 深度Works regardless of the
open session; losing the at-a-glance session identity there is accepted — the
sidebar and the web app still project it. Multi-window futures inherit the same
pinned name per window.