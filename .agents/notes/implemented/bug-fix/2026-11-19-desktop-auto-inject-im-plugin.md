# Agent Note: Desktop mounts the shipped IM plugin

Status: implemented

English | [中文](2026-11-19-desktop-auto-inject-im-plugin.zh.md)

## Problem

Desktop ships `@xmanrui/dsh-im` (WeChat / Feishu / …) and refreshes it under `pnpm dev`, but Settings → IM机器人 still disappeared on a fresh per-checkout product home for two independent reasons:

1. The web profile template never lists the package in `dsh.profile.bundles`, so the Loader never mounts it until someone runs `dsh plugin add`.
2. `pnpm dev` used to copy only `lib/*.js` plus the manifest into the profile farm. The Host entry keeps production deps (`qrcode`, channel SDKs, …) external; that incomplete farm copy fails to load when the Loader resolves the bare package from the profile baseUrl. Boot-injecting the cordis patch alone cannot recover a Host that never starts.

## Decision

- Call `resolveOptionalBundlePatch(INSTALL_ANCHOR, '@xmanrui/dsh-im', …)` in the desktop Host boot overlays so the cordis row mounts whenever the install anchor resolves the package. An existing profile or home configuration of `xmanrui-dsh-im` (including `disabled: true`) still wins.
- Point the web profile farm at the full checkout package (junction/symlink) during `pnpm dev`, and stage production `node_modules` beside the packaged `lib/` via `npm ci --omit=dev`, so Host externals resolve in both layouts.
- Stop auto-injecting and packaging `@xmanrui/dsh-business-entry`; the workspace package remains for local builds but is not a shipped desktop surface.

## Alternatives considered

**Tell users to reinstall the plugin after every fresh product home.** Rejected: Desktop already packages the plugin; requiring a manual `dsh plugin add` for a shipped surface is the bug.

**Add `@xmanrui/dsh-im` to the web `PROFILE_TEMPLATES` bundles list.** Rejected: the official web template is shared with non-desktop Hosts that do not ship the package in the installation anchor.

**Keep copying only `lib/` into the profile farm and rely on install-anchor resolution.** Rejected: the vendored Loader resolves bare plugin packages from the profile baseUrl, so the farm copy is the one that loads.

## Consequences

Packaged and `pnpm dev` desktop boots mount Settings → IM机器人 whenever `@xmanrui/dsh-im` resolves and its Host entry can import production deps. Profiles that already installed or disabled the plugin keep their composed configuration. Business-entry no longer appears unless a profile explicitly installs it.
