# Agent Note: Desktop dev bare-plugin resolution and dev update checks

Status: implemented

English | [中文](2026-11-03-desktop-dev-external-plugin-resolution.zh.md)

## Problem

The branded dev executable boots the web profile but resolves bare plugin imports from `apps/desktop`, walking up to the repository-root `node_modules`. `ensureRootPluginLinks` mirrored only the `@deepseek-ai` scope, so third-party plugin packages the web profile farm carries (`dsh-wechat`, `dsh-zentao-report`, `@xmanrui/*`, `@tt-a1i/*`) resolved only through September's hand-made symlinks — packages without one (`dsh-wechat`, `dsh-zentao-report`) failed to import on every launch. The same launch ran the updater: the branded exe reports `app.isPackaged` like the installed build, so `initUpdater` wired the OEM feed and requested `alpha.yml`, a metadata file the feed never publishes — one 404 per launch plus every re-check tick.

## Decision

`ensureRootPluginLinks` now also mirrors every package in the web profile farm's `node_modules` whose manifest declares `dsh.bundle`, at its own repository-root location (scoped names included); farm libraries without `dsh.bundle` and the `@deepseek-ai` scope (owned by the existing `profilesAi` mirror) stay out. The dev launcher exports `DSH_DESKTOP_DEV=1`, and `initUpdater` treats it as an unwired feed: no `setFeedURL`, no event handlers, no startup or re-check, and `updateChecksEnabled` reports false so the Help-menu entry and the renderer badge stay inert. The installed build, which never sets the flag, is unchanged.

## Alternatives considered

**Resolve plugin names against the farm through `bareModuleBaseUrl`.** Rejected because the vendored Loader's plain bare imports resolve from `vendor/loader`, not the mount base; the repository-root mirror is the mechanism the dev exe already relies on.

**Pin the generic feed to the `latest` channel so `alpha.yml` is never requested.** Rejected: it would offer upstream stable releases to an OEM build with its own version line, so the 404 is better silenced by not checking in development; the feed side should publish channel metadata or point the OEM `updateUrl` at its own feed.

**Reinstall the farm from its manifest.** Rejected: the farm's `@xmanrui/*` packages predate its manifest, and a pnpm rebuild would prune them.

## Verification

`apps/desktop/tests/boot.spec.ts` covers third-party mirroring (qualifying packages at scoped and unscoped locations, non-plugin libraries and the `@deepseek-ai` scope excluded, second-pass idempotence) and the existing cases now pin `profilesModules` so tests never touch the real farm.

## Consequences

A broken farm install still surfaces as a plugin import failure, but the missing piece is now linked wherever it exists, so only genuinely absent packages fail. Development launches no longer touch the update feed at all.
