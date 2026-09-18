# Agent Note: The desktop userData directory stays on the ASCII exe id

Status: implemented

English | [中文](2026-09-18-desktop-userdata-ascii-id.zh.md)

## Problem

The desktop shell calls `app.setName(<localized display name>)` for the window and taskbar identity, and Electron derives the default `%APPDATA%` userData directory from the same name — so the OEM build kept its sessions, settings, and desktop.log under a localized directory (`%APPDATA%\民大工作台`). Users and support scripts navigate `%APPDATA%` by the product's file-system id, and the first diagnostic session of the plugin-loading investigation lost time to the mismatch.

## Decision

`main` pins the userData path explicitly to the ASCII exe id (`%APPDATA%\MindaWork`) right after `setName`; the display name keeps owning the window title, tray, and AppUserModelId. The smoke harness's `DSH_PACKAGED_SMOKE_USER_DATA` override still wins, so its isolation is unchanged.

## Alternatives considered

**Rename via `setName` only (drop the localized name there).** Rejected: the name also feeds notification and tray identity paths that want the display name; separating the disk id from the display name keeps both correct.

**Read the packaged `package.json` `name` field instead of a literal.** Rejected for now: the OEM build is the literal's owner, the literal is grep-able beside the other OEM ids, and an indirection through manifest fields would make the disk layout depend on packaging metadata ordering.

## Consequences

Machines that ran an earlier installer keep their existing state in the old localized directory and start fresh under `MindaWork` — a one-time reset of local sessions and settings per machine, accepted during pre-release. The single-instance lock is scoped to userData, so an old-version instance and a new-version instance can run side by side during the transition.

## Verification

`apps/desktop/src/main/index.ts` sets the path before the single-instance lock and before any log write, with the smoke override applied after it; the desktop log lands at `%APPDATA%\MindaWork\desktop.log` in the packaged run.
