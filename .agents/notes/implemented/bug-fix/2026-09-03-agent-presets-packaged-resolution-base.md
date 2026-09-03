# Agent Note: Agent presets resolve packaged rows from the archive root

Status: implemented

English | [中文](2026-09-03-agent-presets-packaged-resolution-base.zh.md)

## Problem

On a freshly installed packaged desktop application, every new session failed with `agent-preset-invalid`: discovery reported the shipped `standard` preset broken because "23 rows name plugins that cannot be resolved". The same install served existing sessions and the host booted fine, so the failure was specific to how agent presets resolve their plugin packages.

## Decision

`dsh-agent-presets` anchors bare package names at the application archive root (`app.asar`) when it runs inside one, detected from its own module location (`installedHostBase`); in every open layout the anchor stays the composition directory's base (`ctx.baseUrl`). Both resolution sites apply the rule: roster health (`AgentPresets`) and the standing mount (`mountPreset`'s `PresetTree.import`), so a preset reported healthy also imports healthy.

The packaged desktop skips `healProfilesModuleFallback`, so `$DSH_HOME/profiles/node_modules` never exists on a clean machine and the upward `node_modules` walk from the composition base — the writable profile directory — finds nothing. The packaged runtime already resolved bare Loader imports through `bareModuleBaseUrl` (the archive root), where `electron-builder` packs the whole plugin closure; the preset seam was the one consumer still reading the composition base. The same walk from the archive root answers every row, and Electron's main-process `fs` sees through the archive (the boot-time resource assertions already rely on that).

## Alternatives considered

**Consume the boot-provided `dshBareModuleBaseUrl` ambient service, as `client-modules` does.** Rejected: reading it through the context proxy requires declaring it in the row's `inject`, which turns an optional refinement into a required service and forces every bare test harness to provide it. Providing the value in a plain harness also perturbed scope-layered prompt tests, which made the inject design unreviewable against this suite.

**Ship the packaged base through roster config.** Rejected: the base is a runtime fact of the installed host, not a deployment choice; every deployment would carry boilerplate that can drift from the actual layout.

## Consequences

Fresh packaged installs create sessions again: discovery reports the shipped presets healthy and the standing mount imports their rows from the archive. Development and installed-CLI layouts are unchanged — the helper returns undefined there and the composition base keeps answering through the healed profile fallback.
