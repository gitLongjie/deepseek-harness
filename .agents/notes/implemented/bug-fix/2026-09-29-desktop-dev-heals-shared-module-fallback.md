# Agent Note: desktop dev heals the shared module fallback farm

Status: implemented

English | [中文](2026-09-29-desktop-dev-heals-shared-module-fallback.zh.md)

## Problem

A locally authored expert preset (`~/.dsh/.agent-presets/<id>/`) naming a package the checkout had just gained reported "N rows name plugins that cannot be resolved" in every desktop surface — the expert market's hire button disabled, the mode picker excluding the row — while the same preset scanned healthy in the packaged rebuild and under the `dsh` CLI. The user-visible trap: the fix (adding the package to `apps/desktop` dependencies) was already merged, and no log line anywhere named the actual failure, because roster health never logs.

The desktop dev launcher (branded `深度Work-dev.exe`) runs the same compiled main as the installed build, so `app.isPackaged` is true and `runDesktopBoot` receives a `bareModuleBaseUrl` pointing at the checkout. The heal gate read `options.bareModuleBaseUrl === undefined` as "open runtime" and skipped `healProfilesModuleFallback` — but the branded executable IS an open runtime. The shared `~/.dsh/profiles/node_modules` farm stayed at whatever generation last healed it, the profile-resolution generation answered from that stale farm, and any package absent from the farm failed preset health even though both the checkout's `node_modules` and the computed closure contained it. A packaged rebuild healed nothing either (links cannot enter `app.asar`), so until someone ran a CLI profile or repackaged, no launch path refreshed the farm.

## Decision

The heal gate is a named predicate, `healsSharedModuleFallback(bareModuleBaseUrl)`: heal in every runtime whose bare-module base is absent or outside an `app.asar` path segment, skip only the closed archive. Segment-exact comparison, so an `app.asar.unpacked` twin reads as the open tree it is. Desktop dev therefore heals the farm on every launch, repointing it at the running checkout's dependency closure — the same contract every other open-runtime launch (`dsh` profiles, the CLI) already follows.

## Alternatives considered

- **Drop the heal gate's coupling to `bareModuleBaseUrl` entirely** and let the packaged runtime attempt the heal. Rejected: the farm materializes OS links, which cannot reach inside `app.asar`; the attempt would either throw or silently write a foreign generation.
- **Make preset health fall back to a raw filesystem walk when the generation lookup misses.** Rejected: the resolver's enforce behavior is the contract — a package outside the generation must not silently resolve — and weakening it in one consumer would hide the exact staleness this fix removes.

## Consequences

- A checkout that gains a plugin package is hireable in desktop dev after one restart, without a CLI launch or repackage healing the farm first.
- Alternating dev runs between two checkouts flip the shared farm's links to whichever launch healed last; that is the farm's documented shared-generation behavior, now exercised by desktop dev too.
