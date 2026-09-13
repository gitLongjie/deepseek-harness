# Agent Note: The desktop dev build refreshes every client package's emit

Status: implemented

English | [中文](2026-09-13-desktop-dev-refreshes-every-client-package.zh.md)

## Problem

`apps/desktop/scripts/dev.ts` refreshed the TypeScript emit of a hardcoded four-package list (`ui-login`, `ui-conversation`, `ui-brand-official`, `ui-layout`) before its Client-face tsdown step. tsdown bundles each client package from its `lib/types` emit, not its sources, so any client package outside the list — `ui-expert` and every later one — shipped its previous bundle: an edit reached the web sources but never the desktop app, with no error anywhere.

## Decision

The dev script imports `discoverPluginDirs` and `discoverLibraryDirs` from `scripts/dev-web.ts` and spreads both into the `tsc -b` arguments, so the emit refresh covers every client plugin and library package through the same discovery the web devserver path already runs. Adding a client package no longer requires editing the desktop launcher.

## Alternatives considered

**Append `ui-expert` to the hardcoded list.** Rejected: it fixes one instance and guarantees the next package repeats the defect; complete discovery already exists in `scripts/dev-web.ts`, so the desktop build reuses it and deletes the second list rather than maintaining two.

**Bundle tsdown from sources instead of the emit.** Rejected: it changes the shared Client-face build for every consumer to repair a desktop-only staleness defect.

## Verification

`tests/dev-oem.spec.ts` asserts the launcher spreads `discoverPluginDirs(repoRoot)` and `discoverLibraryDirs(repoRoot)` into the tsc step, ordered before the tsdown bundle step.

## Consequences

Cold desktop dev builds now compile every client package on each run, so the full emit cost is paid up front; correct output no longer depends on remembering to extend a list.
