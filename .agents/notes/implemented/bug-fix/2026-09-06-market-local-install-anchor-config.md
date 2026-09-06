# Agent Note: market-local resolves its install anchor through config in packaged hosts

Status: implemented

English | [中文](2026-09-06-market-local-install-anchor-config.zh.md)

## Problem

The packaged desktop shell failed to boot: the `market-local` loader entry threw `cannot resolve the running dsh installation (@deepseek-ai/dsh)` during plugin construction, so the whole web-profile mount rejected. The plugin located the installation anchor by probing Node search paths for the CLI app package name from its own module URL. That probe works from a workspace checkout (the CLI package is on the search path) and from a `dsh` CLI installation, but never inside a desktop asar: the shell's app package is `@deepseek-ai/dsh-desktop` at the asar root, and the CLI package is not shipped at all. The packaged smoke gate caught it before release.

## Decision

`LocalMarket.Config` gains an optional `installAnchor` path, validated for existence at construction, falling back to the existing probe. The desktop boot hands over its own anchor through a `resolveMarketAnchorPatch` boot patch — the same overlay mechanism that ships the preset root — gated on the composition actually mounting the row, and spread-merging the row's config because a patch's config replaces wholesale. Hosts stay explicit: the CLI keeps the probe, the shell passes what it already passes to `loadProfile` and `healProfilesModuleFallback`.

## Alternatives considered

**Extending the probe with more candidate package names.** Rejected: the shell's package is the asar root, not a `node_modules` package, so no name probe can find it; adding names would only widen a broken lookup.

**`DSH_INSTALL_ANCHOR` environment variable.** Rejected: implicit config buried in a constructor, against the explicit-config rule; the Config field is validated and documented where the plugin is configured.

## Verification

`packages/market/market-local/tests/index.spec.ts` covers the configured anchor winning over the probe (exact path reaches `pnpmUninstall`) and the loud error for a nonexistent anchor. `apps/desktop/tests/boot.spec.ts` covers `resolveMarketAnchorPatch` returning the anchor patch only when the row exists. The desktop packaged smoke (`pnpm --filter @deepseek-ai/dsh-desktop run smoke -- --skip-build`) boots the packaged shell with the market entry mounted.

## Consequences

The packaged desktop shell boots with the market plugin mounted; install, uninstall, and installed views anchor at the shell's own manifest, the same manifest its root plugin links follow. An `installAnchor` config pointing at a missing file now fails at load instead of at first market operation.
