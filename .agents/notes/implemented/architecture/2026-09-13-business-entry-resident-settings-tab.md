# Agent Note: The resident business-entries settings tab and the decoupled toggle state

Status: implemented

English | [中文](2026-09-13-business-entry-resident-settings-tab.zh.md)

## Problem

The business-entry visibility switch lived inside the plugin's own client bundle, and its persisted state was a `disabled: true` row in the home patch layer (`~/.dsh/cordis.patch.yml`). A patch row is a Loader instruction: at boot the Loader skips the plugin entirely, so a plugin disabled in a previous session never ran the client that owned both the switch and the re-enable listener. Toggling the switch on wrote the file but could not mount anything — the user saw no business entries and no way back except hand-editing the patch file.

## Decision

The section is shell-owned. `ui-conversation` registers a resident `settings.section` (`business-entries`, desktop-only — the registration probes `window.__DSH_IPC__`), so the tab and its switch render whether or not the plugin is enabled. The toggle state moved out of the patch layer into `$DSH_HOME/plugin-settings.json` (`plugin-toggle.ts` reads and writes it); the plugin itself always mounts and gates only its `sidebar.business` registration on that state, re-reading on the `dsh-business-entry:toggle` CustomEvent. The plugin drops its own settings section, and the home patch layer no longer carries plugin rows for it.

## Alternatives considered

**Live-mount through config-only HMR.** Rejected: the desktop has no guaranteed config-only recompose that also refreshes the renderer's client-module registry, so the "re-enable" path could still demand a restart — a toggle that lies.

**Keep the loader-level disable and document a restart after re-enabling.** Rejected: the persisted state and the mounted state would disagree for a whole session; the visible switch would not match the visible sidebar.

## Consequences

The plugin mounts in every session (its host entry is empty and its client registers nothing when disabled), trading a small bundle load for a toggle that is always truthful. The patch layer no longer expresses this plugin's state, so a hand-written `disabled: true` row for it in `cordis.patch.yml` would disable the plugin at Loader level and the resident switch could not undo it — the switch and the file no longer round-trip. Pure web deployments never see the section (no preload bridge).

## Verification

`apps/desktop/tests/plugin-toggle.spec.ts` pins the JSON state contract (read-back, sibling isolation, mangled-file recovery, home-directory creation). `packages/client/ui-conversation/tests/business-section.client.spec.tsx` covers the desktop-only rendering, state read-back, and both toggle directions including the hot-toggle event; `apply-wiring.client.spec.tsx` pins the section registration and the general-item roster.
