# Agent Note: Desktop mounts the shipped IM plugin

Status: implemented

English | [中文](2026-11-19-desktop-auto-inject-im-plugin.zh.md)

## Problem

Desktop ships `@xmanrui/dsh-im` (WeChat / Feishu / …) and refreshes it under `pnpm dev`, but Settings → IM机器人 still disappeared on a fresh per-checkout product home for two independent reasons:

1. The web profile template never lists the package in `dsh.profile.bundles`, so the Loader never mounts it until someone runs `dsh plugin add`.
2. `pnpm dev` used to copy only `lib/*.js` plus the manifest into the profile farm. The Host entry keeps production deps (`qrcode`, channel SDKs, …) external; that incomplete farm copy fails to load when the Loader resolves the bare package from the profile baseUrl. Boot-injecting the cordis patch alone cannot recover a Host that never starts.

Separately, Settings → 业务入口 stayed visible after the plugin was retired because `ui-conversation` registered a shell-owned settings section whenever `__DSH_IPC__` was present, and earlier desktop releases could leave a composed `xmanrui-dsh-business-entry` row or farm copy that still filled the sidebar.

## Decision

- Call `resolveOptionalBundlePatch(INSTALL_ANCHOR, '@xmanrui/dsh-im', …)` in the desktop Host boot overlays so the cordis row mounts whenever the install anchor resolves the package. An existing profile or home configuration of `xmanrui-dsh-im` (including `disabled: true`) still wins.
- Point the web profile farm at the full checkout package (junction/symlink) during `pnpm dev`, and stage production `node_modules` beside the packaged `lib/` via `npm ci --omit=dev`, so Host externals resolve in both layouts.
- Stop packaging and auto-injecting `@xmanrui/dsh-business-entry`; force-disable that plugin id at boot; purge leftover farm copies under `pnpm dev`; stop registering the shell-owned Settings → 业务入口 section from `ui-conversation`.

## Alternatives considered

**Tell users to reinstall the plugin after every fresh product home.** Rejected: Desktop already packages the plugin; requiring a manual `dsh plugin add` for a shipped surface is the bug.

**Add `@xmanrui/dsh-im` to the web `PROFILE_TEMPLATES` bundles list.** Rejected: the official web template is shared with non-desktop Hosts that do not ship the package in the installation anchor.

**Keep copying only `lib/` into the profile farm and rely on install-anchor resolution.** Rejected: the vendored Loader resolves bare plugin packages from the profile baseUrl, so the farm copy is the one that loads.

**Leave the shell-owned 业务入口 settings tab and only stop Host injection.** Rejected: the settings nav item is registered by `ui-conversation` on desktop, not by the plugin, so injection changes alone cannot remove it.

## Consequences

Packaged and `pnpm dev` desktop boots mount Settings → IM机器人 whenever `@xmanrui/dsh-im` resolves and its Host entry can import production deps. Profiles that already installed or disabled the plugin keep their composed configuration. Business-entry no longer appears in Settings or the sidebar unless a future change re-enables it.
