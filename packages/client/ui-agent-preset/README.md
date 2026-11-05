---
description: "Name the expert for the next task and open the experts page, where the new-task default is set. Authoring is guided to Creator expert."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-agent-preset

English | [中文](README.zh.md)

## Summary

Name the expert for the next task and open the experts page, where the new-task default is set. Authoring is guided to Creator expert.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The new-session chip names the expert the next task will use. Clicking it opens the experts page. Hiring a card starts a chat under that preset. “Set as new task default” on a healthy card writes the default and applies it to the blank session on the current new-task surface. Settings has no Agent presets section. A broken expert stays on the page and cannot be hired or saved as the default.

Turning Coding Tools off clears unapplied choices through the existing Developer tools subscription. Once the off value is accepted, every authenticated browser resets a saved built-in PTC or Minimal default to Standard. Saved Standard, Creator, and custom defaults stay unchanged. Existing sessions keep their preset; New Session uses the current default. Turning Coding Tools back on does not restore the old default. If Standard is missing or broken, the default remains unchanged.

**Let the agent create a plugin** in the Plugins page's **Add plugin** menu enters Creator. It submits no message and preserves unsent drafts. While the roster loads or Creator is unavailable, the menu item is disabled with an explanation. A Host refusal is shown in a Toast.

Entering Creator selects `cordis` for the receiving blank Session without changing the new-task default or Coding Tools setting. If no workspace or blank Session is bound yet, the choice waits for that binding. After the choice is applied, the Creator Session keeps its preset; a later newly created Session uses the configured default, such as Standard.

On Desktop, the optional [product analytics](../product-analytics/README.md) service receives `agent_preset_switch` when a direct mode-picker choice moves to a different built-in preset: an unbound choice counts once it is staged for the next Session, and a choice for the bound blank Session counts once the Host applies it. The event carries the source and target categories mapped from the preset id (`cordis` is `creator`; `ptc`, `minimal`, and `standard` keep their ids; any other id is `other`) and the Coding Tools setting known at the choice. Custom targets, refused choices, choices the Host settles on another preset, default changes and their blank-Session synchronization report nothing, and neither does a choice made while the source mode or Coding Tools setting is unknown. Custom preset ids and names are not collected.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`agentPresets/list` supplies the roster and marks the current default. The experts page writes the new-task default into the `agent-preset-registry` settings namespace and synchronizes the current blank session. The chip and the read-only session label use recorded preset identities. Connection resets and settings updates refresh the roster.

`CreatePluginMenuItem` contributes to `plugins.add.actions` using the shared roster store. Its selection calls the owner's `onDismiss()` and then `startCreatorDraft`. That callback stages `cordis` through `AgentPresetSeatController`, except when the main blank Session lists a different preset (navigation then opens another blank and leaves that one unchanged), and opens the task through `uiWorkspace.startSession` with explicit draft preservation and `agentPreset: 'cordis'`, so the Host composes the reused blank or new Session under Creator; without a target Workspace, the staged choice applies when a Session binding becomes available. The choice is consumed once applied. `AgentPresetSeat` renders refusals through the shared `Toast` component.

`AgentPresetSeatController.select()` and `apply()` return the attempt's outcome: `applied` when the Host commits the staged preset, `staged` while no Session is current, `unchanged` when busy, without a stage, for a started or already matching Session, or when the Host settles on another preset, and `refused` with the bare Host reason. The chip's injected `select` reports `agent_preset_switch` from that outcome and returns only the refusal reason.

The Workspace's blank Session is its New Session placeholder, and flows share it: a hire composes the expert into it, and the next new-session flow adopts that same Session. `bindPlaceholderAdoption` is where this package restores the composition a fresh `session.create` resolves — but only where nothing healthy can mount what is there. A placeholder composing a healthy preset stays; a staged pick returns immediately, because the applier owns switching the Session onto it. Only a composition nothing can mount any more (a preset deleted or broken since) falls back to the default. Naming reads that same healthy roster, so a session running any preset is named by that preset.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Scope](../../core/scope/README.md) — Registration isolation.
- [Agent](../../core/agent/README.md) — Session runtime.
- [Cordis](../../../docs/cordis-primer.md) — Plugin configuration and lifecycle.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the selected preset, whose plugins own model-visible capabilities.

#### KV Cache effect

Selection changes affect only later tasks; existing plugins and prompts remain unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Web creates and edits no preset: the configuration viewer is read-only, and a bundle installed through Creator expert declares a new preset or overrides a shipped one by row id, replacing its complete child list.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
