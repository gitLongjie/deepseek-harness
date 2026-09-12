# Agent Note: The 深度Work brand identity and the cloud-sea mark

Status: implemented

English | [中文](2026-09-13-deepworks-brand-identity.zh.md)

## Problem

The product carried two divergent identities. The runtime display name came from `oem.config.json` (`深度Work`), while the installer identity was a hard-coded ASCII `MeowWork` inside `desktop-oem-config.mjs` and `electron-builder.yml` — so Windows showed `MeowWork` paths, shortcuts, and uninstall entries for a product named 深度Work. Every user-visible copy surface (login title, sidebar brand, harness identity line, Web GUI strings) still said MeowWork, and the app icon was the superseded cat mark.

## Decision

`oem.config.json` `productName` (深度Work) is the single source for both the runtime display name and the installer identity: `createElectronBuilderOemConfig` no longer hard-codes a product name, and `executableName`, `shortcutName`, `uninstallDisplayName`, and all platform `artifactName`s carry the OEM name. The on-disk install directory is pinned to the ASCII `C:\Program Files\DeepagensWork` through `perMachine: true` plus a `customInit` macro in `build/installer.nsh`, so non-ASCII display renames never move the install path. The packaged package `name` is the ASCII `DeepagensWork`: electron-builder derives `APP_FILENAME` from it to sanitize the directory, and an ASCII value keeps that check stable while the display name is non-ASCII.

The mark is the cloud-sea D (`apps/desktop/build/反白上下源文件.png`, 454×454): the ICO is seven PNG entries (16–256), `icon.png` is 512, `MewoLogo` and the boot-page carry it as 72×72 data URIs, and `favicon.svg` wraps the same PNG. Technical identities stay untouched — `appId com.meowwork.app`, AUMID `ai.deepagens.worker`, and the `gitLongjie/miaoWorker` publish repo — because renaming them breaks update detection and taskbar grouping for no user-visible gain.

## Alternatives considered

**Keep an ASCII installer identity (MeowWork/DeepagensWork) and reserve 深度Work for display only.** Rejected: the deployment owner wants the product name, not a transliteration, on shortcuts, the uninstall entry, and release assets.

**Rename `appId` and the AUMID together with the brand.** Rejected: both are invisible identifiers whose change breaks update detection and taskbar grouping; the visible rename does not require them.

## Consequences

Release assets are now `深度Work-<version>-*.exe` — non-ASCII names on the GitHub release. electron-publish URL-encodes them, but this is the first non-ASCII asset name in the release history; if the publish flow objects, `artifactName` is the single knob to revert to an ASCII value. The install directory and the Electron user-data directory both derive from the display name, so an OEM rename moves `C:\Program Files\…` and `%APPDATA%\…` and does not migrate prior state — the pinned DeepagensWork directory limits that exposure to the user-data half.

## Verification

`apps/desktop/tests/builder-identity.spec.ts` pins the installer identity (executable name, shortcut, uninstall display, artifact names, per-machine flag, the `installer.nsh` pin) and the OEM overlay projection. The icon pipeline was verified by extracting the branded executable's icon group through the Windows Shell API and rendering it; the installer embeds only the new mark (long-byte comparison against the old mark's PNG entries).
