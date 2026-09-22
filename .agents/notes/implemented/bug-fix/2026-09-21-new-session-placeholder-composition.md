# Agent Note: The New Session placeholder keeps the composition a new Session gets

Status: implemented

English | [中文](2026-09-21-new-session-placeholder-composition.zh.md)

## Problem

A Workspace's blank Session is that Workspace's New Session placeholder: `uiWorkspace.connectWorkspace` reuses it for every later new-session flow. It also carries whatever composition an earlier flow gave it, and hiring an expert is exactly such a flow — the expert page stages the expert and starts a session, which reuses the placeholder and composes the expert into it. Every later 新会话 then adopts that same Session, so the next chat starts under a composition nobody chose for it, and the preset is fixed the moment the first message arrives. The chip beside the composer made the report harder to read still: it named the composition from its own options, which exclude expert-marked rows (`presetOptions`), so a chat running an expert either showed a bare identifier or was not named at all. The machine that reported this had `agent-presets.default` set to `standard` while the adopted blank Session recorded `geo-optimizer`.

## Decision

`UiWorkspace.bindPlaceholderAdoption(listener)` registers one step on the Workspace navigation service: every blank Session `connectWorkspace` ADOPTS runs it before the connect resolves, and a step that throws never fails the navigation. The preset domain owns what the step does. `AgentPresetSeatController.prepareNewSession` restores the roster's marked default — the composition `session.create` resolves — but only where these surfaces cannot have chosen what is there: a mode the chip or the settings page offers is that flow's own answer and stays, while a composition with no menu row (an expert hired from the market, a preset deleted since, or no recorded preset at all) is another flow's leftover. A staged pick returns immediately, because the applier owns switching the Session onto it. A Session this package creates composes the same default by construction, so the step runs for an adopted placeholder only.

The chip names the composition a chat runs over the whole healthy roster (`AgentPresetSeatState.currentPreset`) rather than only over the options it offers. An expert-hired chat shows the expert's published name with a tooltip saying the chat was composed from it; a preset with no healthy row left (deleted or broken since) shows its identifier with a tooltip saying it is unavailable. The menu still offers modes alone.

## Alternatives considered

**Restore the default whenever the placeholder's composition differs from it.** Rejected: it reverts a mode the user picked for this very chat — choosing 极简模式 on the chip and then clicking 新会话 would silently put the chat back on the default, and a reload after a pick would do the same.

**Compare compositions in `connectWorkspace` and create a fresh Session when they differ.** Rejected: the blank Session is the Workspace's placeholder and the flow's own answer to "start a new chat", so abandoning it would leave a stray blank row and charge every new-session flow a session create — while the composition it holds is not a fact this package can judge.

**Return the adopted Session's preset and let the conversation area switch it.** Rejected: one decision spread across two packages, with the workspace layer deciding a composition — the preset domain's vocabulary — and a second switch path beside the staged pick that already owns this.

**Exclude expert-marked presets from reuse, as the mode surfaces exclude them.** Rejected: the same defect one row wider. An authored preset left on the placeholder would still leak, and the rule would then live in a third place beside `presetOptions` and the market.

**Name the chip from its own options and let an expert chat show its identifier.** Rejected: that reading is the report. A chat that runs an expert must say so, and the expert market is the only place its name exists.

**Have `ui-workspace` depend on the preset surfaces.** Rejected: this package owns navigation and the placeholder's lifecycle, not what a composition is; the hook keeps the composition decision with the plugin that reads the roster, and `ui-agent-preset` already declares `uiWorkspace` for starting sessions.

## Consequences

新会话 starts the chat it promises on a Workspace whose placeholder a hire left composed, and the chip names whatever the next chat runs, experts included. The step costs one `agentPresets/select` round trip on an adopted placeholder whose composition is not the default, and none when it already is or when this flow's own surfaces could have chosen it; a deployment with no marked default restores nothing, because no composition is what a fresh create would produce. The Workspace navigation service now holds one registration, so its README states that instead of claiming no cross-plugin mutable state.

## Testing

`settings-store.client.spec.ts` pins the restore and each skip — a started Session, a pick this flow already staged, a mode the chip offers, a roster marking no default, a refused roster read, and a refusal from a Session that started mid-step — plus the restore of a placeholder recording no preset, and the chip naming an expert the menu cannot offer. `apply.client.spec.ts` pins the binding the conversation scope registers, the restore reaching the host through `agentPresets/select`, and the chip naming an expert-hired chat. `workspaces-service.client.spec.ts` pins the adopted-only registration, its unbinding, and a navigation that survives a failing step. `components.client.spec.tsx` pins the chip's label and its hint for an expert, for an identifier no row names, and for a refused switch.
