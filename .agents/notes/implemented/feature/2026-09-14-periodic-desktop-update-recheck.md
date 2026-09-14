# Agent Note: Periodic silent desktop update re-checks

Status: implemented

English | [中文](2026-09-14-periodic-desktop-update-recheck.zh.md)

## Problem

The desktop updater checked for updates exactly once per launch. An install left running for days never learned about a newer release: the only in-session re-check was the manual Help-menu item, so the in-app badge could stay absent indefinitely while a published update was already available to that machine.

## Decision

`initUpdater` schedules a silent re-check every 4 hours (`UPDATE_RECHECK_INTERVAL_MS`) after the startup check in packaged runs. Ticks run the same silent path as the startup check: discovery lights the renderer badge, and dialogs remain exclusive to the Help-menu check. A tick is skipped while a check is in flight (`checkInFlight`, cleared by the terminal updater events and by the check promise's `finally`) or while the badge is mid-flow (`lastStatus`): re-checking past `available` would reset a deferred `downloaded` state, and a `checking` flash belongs to manual checks. Re-initialization resets the per-run state (`manualCheck`, `checkInFlight`, `lastStatus`) and replaces the previous timer.

## Alternatives considered

**Renderer-owned polling.** Rejected: the renderer is rebuilt on locale changes and window recreation, so the cadence would live in fragile UI code; the main process already owns every updater interaction and the timer belongs next to it.

**A configurable interval (env or OEM manifest field).** Rejected for now: no deployment has asked for a different cadence, and the desktop keeps exactly one tunable in this area — the feed URL. Revisit if an OEM requests it.

**Notifying (toast/dialog) on periodic discovery.** Rejected: mid-work interruptions are what the silent badge design avoids; periodic discovery reuses the badge flow, and prompting stays manual-check-only.

## Consequences

A long-running desktop now surfaces a new release within one re-check interval without user action, and a failed re-check retries silently on the next tick instead of waiting for the next launch. The feed host gains one metadata request per 4 hours per running install. A user who defers an available update keeps a stable badge — ticks stay skipped until they download, install, or restart — so discovery never fights the deferred state.

## Verification

`apps/desktop/tests/updater.spec.ts` pins the cadence and both skip conditions (in-flight check, mid-flow badge state) with fake timers, alongside the manual-check dialog behavior that stays untouched.
