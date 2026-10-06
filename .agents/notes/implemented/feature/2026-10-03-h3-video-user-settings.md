# Agent Note: user-editable H3 video settings over the composition layer

Status: implemented

English | [中文](2026-10-03-h3-video-user-settings.zh.md)

## Problem

Every H3 video tunable — the ComfyUI origin and workflow template, the MiniMax endpoint and model, poll intervals, concurrency caps, output directory, and disk-preflight numbers — lived only inside the preset's composition file. Editing any of them meant hand-editing YAML under `~/.dsh/.agent-presets/`, an action the desktop offers no surface for: a person tuning the local backend or pasting a hosted API key had no way in from the interface, and a wrong YAML edit could break the whole preset's mount.

The seam already had the layering concept — a composition base per deployment — but no user layer and no host-plane owner. `settings.register` is a once-per-process ownership registration, so the namespace could not be registered from the preset-mounted service (a second session mounting the same preset would collide on registration, and the namespace would come and go with mounts).

## Decision

A three-part split along the existing seams:

- **Host entry** (`@deepseek-ai/dsh-experimental-h3-video/settings`, a web-app bundle row): registers the `h3-video` settings namespace over a flat, all-optional schema (`comfyUrl`, `comfyWorkflowPath`, `minimaxApiKeyRef`, `outputDir`, `minFreeSpaceMb`, …) and publishes the live section as the `h3VideoSettings` host-plane service. The settings UI works whether or not any preset is mounted; the view outlives sessions.
- **In-preset service**: `LocalH3Video` resolves an effective configuration through the exported `resolveOverlayConfig(base, section)` — present non-empty settings win, absent ones inherit, and the two backend anchors travel with the overlay (`comfyWorkflowPath` enables local, `minimaxApiKeyRef` enables remote) — then rebuilds its providers on every committed change through `view.watch`. Service resolution crosses the preset's `h3Video` isolate realm the same way `credentials` already does; scope handles do not, which is why the view is a service and not a shared `SettingsScope`.
- **Client card** (`ui-settings-plugins`, keyed on the namespace): one card over the whole namespace — the configurable tab dispatches one card per served namespace, so grouping lives inside the card as ordered fields (local, remote, output) rather than as multiple cards. The MiniMax key follows the web-search precedent: staged with the form, written through the credentials domain addressed by the section's reference, never stored in the settings document.

The overlay is deliberately flat: the settings card is a flat form, and the one place the flat names meet the composition's `comfy`/`minimax` rows is the exported resolve step — an explicit boundary rather than a scattered `??` chain.

## Alternatives considered

- **Register the namespace from the preset-mounted service.** Rejected: duplicate registration throws on the second mounted session, and the namespace would vanish with the last one.
- **Edit the preset's composition file from the settings UI.** Rejected: composition is a file the roster health-checks and a mount consumes verbatim; a UI YAML writer is a second authoring path with none of the staging, validation, or revision fencing the settings document already has.
- **Re-enable the host-plane engine and configure it there.** Rejected: the service rows are preset-plane by design (per-session isolation); only the settings namespace is host-plane, and the view service carries it into the realm.
- **Multiple cards (one per backend) over one namespace.** Rejected: the tab pairs one card per namespace by slot key; suffixing keys breaks the dispatch, and one card with ordered fields delivers the same grouping without a second ledger convention.

## Consequences

- The Plugins settings page edits H3 video configuration end to end; a committed change reaches a mounted service without a session restart and reaches the next mount through the constructor's initial resolve.
- A composition with no backend anchor is now legitimate: it fails at load only until settings enable one, which moves the "at least one backend" rule from load-time-only to a live-editable state.
- `resolveOverlayConfig` is the single mapping table; a field added to the schema travels through it or does not exist. The flat vocabulary is client-spelled (a client package must not depend on a Host package), so the two spellings move in one PR by construction of the note and tests.
