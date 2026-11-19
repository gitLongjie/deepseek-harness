# Agent Note: Desktop auto-injects the IM plugin

Status: implemented

English | [中文](2026-11-19-desktop-auto-inject-im-plugin.zh.md)

## Problem

Desktop ships `@xmanrui/dsh-im` (WeChat / Feishu / …) inside the install and refreshes it into the active web profile's `node_modules` under `pnpm dev`, but the web profile template never lists it in `dsh.profile.bundles`. After a per-checkout product home starts a fresh web profile, the IM settings surface is absent until someone runs `dsh plugin add` for that profile. `business-entry` and `dsh-skin` already avoid this by injecting their cordis patches at boot when the package resolves.

## Decision

Call `resolveOptionalBundlePatch(INSTALL_ANCHOR, '@xmanrui/dsh-im', …)` in the desktop Host boot overlays, before the business-entry and skin injections. An existing profile or home patch that already configures `xmanrui-dsh-im` (including `disabled: true`) still wins.

## Alternatives considered

**Tell users to reinstall the plugin after every fresh product home.** Rejected: Desktop already packages and copies the plugin; requiring a manual `dsh plugin add` for a shipped surface is the bug.

**Add `@xmanrui/dsh-im` to the web `PROFILE_TEMPLATES` bundles list.** Rejected: the official web template is shared with non-desktop Hosts that do not ship the package in the installation anchor.

## Consequences

Packaged and `pnpm dev` desktop boots mount Settings → IM机器人 whenever `@xmanrui/dsh-im` resolves from the install anchor. Profiles that already installed or disabled the plugin keep their composed configuration.
