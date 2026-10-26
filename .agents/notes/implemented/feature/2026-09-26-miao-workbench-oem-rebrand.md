# Agent Note: OEM rebrand to 喵工作台 with the ASCII miaoWorker disk identity

Status: implemented

English | [中文](2026-09-26-miao-workbench-oem-rebrand.zh.md)

## Problem

The OEM identity was "miaoWork" (sailboat artwork, sailing-themed copy) across the desktop shell, the client UI, the installer, and the agent's own system-prompt identity line. The product is becoming 喵工作台: the display name, the notification and login copy, the greeting strings, every icon surface, and the on-disk paths needed to move together, and the on-disk identity had to stay ASCII (`miaoWorker`) so install paths and data directories stay stable while the display name is non-ASCII.

## Decision

One brand source and one ASCII file-system id:

- `oem.config.json` carries `productName: "喵工作台"`, a cat-themed `loginTagline`, and cat-themed `greetings`; the existing OEM pipeline (`scripts/oem-config.ts`, `desktop-oem-config.mjs`) projects the rest, so no consumer changed shape.
- The ASCII disk identity is `miaoWorker` everywhere a path is machine-read: the NSIS install dir (`installer.nsh` pins `$PROGRAMFILES64\miaoWorker`), the electron-builder overlay package `name` (APP_FILENAME), the Windows/macOS/Linux artifact prefixes, the Linux executable name, and the explicit `userData` directory in the desktop main process (Windows `%APPDATA%\miaoWorker`, macOS `~/Library/Application Support/miaoWorker`). Display-facing fields (`shortcutName`, `uninstallDisplayName`, the executable's FileDescription via the dev launcher) carry 喵工作台.
- All icon surfaces derive from the 512×512 cat-head mark (`apps/desktop/build/icon.old.png`): the multi-size ICO flows through the existing OEM icon pipeline (`apps/web/public/favicon.ico` → `syncDesktopOemIcons` → `build/icon.ico` + `build/tray.ico`), `build/icon.png`/`tray.png`/`tray@2x.png` are the PNG twins, `apps/web/public/favicon.{ico,png,svg}` rebrand the web surface, and the inline `MewoLogo`/boot-page data URIs are the 72×72 rendering of the same mark. Window, taskbar, tray, and installer icons all read these files.
- The model-visible identity line in `system-prompt` ("You are an AI agent powered by …") and the desktop completion-notification title are rebranded, together with the client default-brand fallbacks (`brand.localBuild`, login page title, boot-page wordmark, `OfficialBrandName`) and the shipped preset persona prefix.

`ai.deepagens.worker` (Windows AppUserModelId) and the `loginUrl`/`updateUrl` endpoints are unchanged: the AUMID is an invisible Win32 id whose rename would risk toast-activation compatibility, and the endpoints are functional backend addresses, not brand copy.

## Alternatives considered

**Non-ASCII install directory from `productName`.** Rejected: NSIS directories, artifact names, and support tooling stay reproducible only with an ASCII id; miaoWork already paid this cost with `DeepagensWork`, and the rename swaps one ASCII id for another.

**Rebrand only the installer and leave the agent identity line.** Rejected: the line is model-visible product copy; a 喵工作台 session claiming to be powered by miaoWork would contradict every other surface.

**Regenerating icons by hand-editing build outputs only.** Rejected: `build/icon.ico` is a projection of `apps/web/public/favicon.ico` via `syncDesktopOemIcons`; editing the outputs would be reverted on the next dev or deploy run.

## Consequences

Existing miaoWork/DeepagensWork installs keep their uninstall key (shared `appId`), so the same-key upgrade path removes them; their `userData` under the old name does not migrate, matching the pre-release stance that on-disk formats carry no compatibility promise. Published release assets switch to the `miaoWorker-*` prefix with the next release; the updater resolves asset names from each release's own `latest.yml`, so no dual naming is needed. The icon source files keep their `.old` twins in `build/` for reference.

## Verification

`apps/desktop/tests/builder-identity.spec.ts` pins the new artifact names, install dir, and overlay package name; `apps/desktop` unit tests (149) pass, including the completion-notification title and tray icon paths; `system-prompt`, `agent-loop`, `app-boot`, and `web-app` suites (778) pass against the rebranded identity line; client and `apps/web` suites (690) pass with the regenerated sidebar snapshots.
