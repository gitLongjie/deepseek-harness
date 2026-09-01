# Agent Note: macOS bundles without a signing certificate are ad-hoc sealed after pack

Status: implemented

English | [中文](2026-09-02-macos-adhoc-seal-after-pack.zh.md)

## Problem

The desktop release built with `mac.identity: null` shipped an app bundle that macOS Gatekeeper reports as **"damaged and can't be opened"** — with no bypass at all — on macOS Sequoia (and 14.x for arm64). The DMG itself is intact (the published assets' sha256 digests verify, and the UDIF `koly` trailer is present), so users read a perfectly valid download as corruption. The v1.1.0 release hit exactly this on Apple Silicon + Sequoia.

`identity: null` makes electron-builder skip signing entirely, which is worse than plainly unsigned: the Electron binaries keep only their per-file **linker signatures** (`flags=0x20002 (adhoc,linker-signed)`), the bundle has no `_CodeSignature/CodeResources`, and `codesign --verify --deep --strict` fails with "code has no resources but signature indicates they must be present". A signature that promises sealed resources over an unsealed bundle is what macOS surfaces as a broken seal, i.e. "damaged" — a dead end: macOS 15 removed the right-click → Open bypass, and no Open Anyway button is offered for damaged apps.

## Decision

`build/afterPack.cjs` runs in electron-builder's `afterPack` phase — after the bundle is assembled, before the dmg and zip targets are built — and, on `darwin` only, seals the bundle with an ad-hoc signature (`codesign --force --deep --sign -`) followed by a strict verification (`codesign --verify --deep --strict`) that fails the build loudly if the seal is broken. The hook no-ops when `CSC_LINK` or `CSC_NAME` is present, so provisioning real signing certificates later replaces it without config changes, and `mac.identity`/`hardenedRuntime`/`entitlements` stay as-is for that path.

The result is a bundle with a **valid ad-hoc signature**: Gatekeeper stops it with the ordinary "Apple could not verify the developer" dialog, which users clear once through System Settings → Privacy & Security → Open Anyway (or `xattr -dr com.apple.quarantine /Applications/Deepagens-Worker.app` in a terminal). No Apple Developer account is needed.

## Alternatives considered

**Keep `identity: null` and document the terminal workaround.** `xattr -dr com.apple.quarantine` does unblock the current release, but every user hits a dead-end "damaged" dialog first, and the documented right-click → Open route no longer exists on Sequoia. Rejected as the only fix; kept as the documented fallback for v1.1.0 downloads.

**Upgrade to electron-builder v27, whose `mac.sign.identity: "-"` natively ad-hoc signs.** The upgrade is a breaking-change migration (signing options moved under `mac.sign`, asar and target schema changes) that reaches every platform's build for a one-line mac fix. Rejected for now; the v27 migration note is the natural place to drop the hook.

**Real Developer ID signing plus notarization.** The correct long-term answer (it also restores macOS auto-update, which Squirrel.Mac refuses for non-Developer-ID builds — ad-hoc included). It requires the paid certificate and APPLE_* secrets; the config is already pre-wired for it, and the hook steps aside automatically.

## Consequences

Every unsigned mac artifact is sealed: the Gatekeeper flow becomes recoverable, `codesign --verify --deep --strict` passes on the packaged app, and a broken seal fails CI at build time instead of at a user's Mac. The signature is still ad-hoc — no TeamIdentifier, no notarization — so Gatekeeper stops the app once (Open Anyway) and macOS auto-update remains unavailable until real Developer ID signing is provisioned.

## Testing

The hook's darwin branch runs on the `desktop-build.yml` macos job (and the publish flow's), where the strict verification gates the build; the non-darwin no-op and the hook load were verified on Windows, and `electron-builder --dir` accepts the `afterPack` key. The released v1.1.0 DMG assets were verified intact by sha256 and UDIF trailer before diagnosing the seal as the cause.
