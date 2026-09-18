# Agent Note: OEM desktop builds without an update feed disable auto-update

Status: implemented

English | [中文](2026-09-18-oem-desktop-without-update-feed.zh.md)

## Problem

`updateUrl` was mandatory at every layer of the OEM pipeline: the config parser, the desktop packaging projection, and the packaged runtime resolver all rejected its absence, and the module-level resolver threw before the desktop window could open. An OEM deployment that must not auto-update — an isolated campus network, for example — had no honest way to declare that: the only path to a working build was inventing a feed URL that would then fail every check.

## Decision

`updateUrl` is optional end to end. `oem.config.json` omits it for feed-less deployments; the parser and the desktop packaging projection still reject a present-but-invalid value. The electron-builder overlay omits `dsh.updateUrl` and the `publish` block when no feed exists. At runtime `resolveDesktopUpdateUrl` returns undefined, and `initUpdater` leaves electron-updater entirely unwired: no feed, no startup check, no periodic re-check. `requestUpdateCheck` and the badge's IPC actions are inert, and the Help menu omits the check-updates entry (`updateChecksEnabled`). The in-app badge never appears because no status event is ever sent.

## Alternatives considered

**Keep the field required; ship a placeholder URL.** Rejected: every check would fail against an unreachable host, and the Help-menu check would report an error the deployment can never fix.

**A separate disable flag beside a required URL.** Rejected: the flag and the URL could disagree, and presence of a feed is already the complete fact — a second field only adds a lying state.

**An empty-string sentinel.** Rejected: it fails URL validation by design, so it would need its own special case anyway while reading as a malformed value.

## Consequences

Campus and other closed deployments build and run with zero update traffic, and the periodic re-check from [the re-check note](2026-09-14-periodic-desktop-update-recheck.md) applies only when a feed exists. Re-enabling updates for such a deployment is adding `updateUrl` back and shipping a release — no migration, no stored state. The cost is one more branch at each consumer of the resolved URL; the HTTPS-only rule and the local-rehearsal exception are unchanged for builds that do declare a feed.

## Verification

`scripts/oem-config.client.spec.ts` pins parse-without-`updateUrl`; `apps/desktop/tests/builder-identity.spec.ts` pins the overlay without update metadata; `apps/desktop/tests/update-url.spec.ts` pins absent-resolves-to-undefined; `apps/desktop/tests/updater.spec.ts` pins the unwired updater and inert manual check; `apps/desktop/tests/menu.spec.ts` pins the missing Help-menu entry.
