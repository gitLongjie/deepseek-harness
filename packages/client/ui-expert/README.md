---
description: "Expert-center plugin for the dsh web client: a sidebar entry row opening the conversation-area page that presents the deployment's agent-preset roster as hireable expert cards."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-expert

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-expert` is the expert center of the dsh web client: a sidebar entry row (between the knowledge and business regions) opens the page in the conversation area — the deployment's agent-preset roster presented as hireable expert cards, with text search over names, descriptions, and tags, the category filter bar the published `preset.yml` metadata feeds, per-card suggested prompts, and a hire action per card. Hiring stages the card's preset for the NEXT session through the ui-agent-preset staging service and starts that session; the page itself is presentation-only over the `agentPresets` Remote roster.

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

The web bundle mounts the plugin by default; remove the row to turn the surface off. The sidebar entry row disappears with it — the shell renders unoccupied holes as nothing.

```yaml
- id: ui-expert
  name: '@deepseek-ai/dsh-client-ui-expert'
```

### Minimal configuration

No config of its own: the page reads the roster through `agentPresets.list`, and a deployment composing no presets renders the empty market rather than an error. Cards show healthy presets only — a broken roster row cannot compose the session a hire would start, so it never appears as hireable.

### What can go wrong

The section registers into the shell-declared `sidebar.experts` hole and the page into ui-conversation's `conversation.expert.browser` hole; removing a declaration leaves the registration waiting and the surface absent, which is the documented behavior of an unoccupied slot. Hiring while no conversation flow is bound stages nothing: the staging service no-ops without a seat to land the pick on, and the page still starts the session on the deployment default.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Two slot registrations plus one navigation service: `ExpertNav` fills `sidebar.experts`, `ExpertBrowser` fills `conversation.expert.browser`, and `UiExpertService` owns the page state with the knowledge page's close-on-session policy. Hiring stages through the `uiAgentPreset` service (stage before session start, mirroring the settings section's authoring entry) and starts the session through the Workspace UI's shared action.

| File | Owns |
|---|---|
| `src/client/index.ts` | The two slot registrations, dictionaries, and inject factories |
| `src/client/ExpertNav.tsx` | The entry row: wide variant and rail icon, active while the page stands |
| `src/client/ExpertBrowser.tsx` | The page: search, category filter, card grid, hire, states |
| `src/client/navigation.ts` | The page store and its close-on-session watcher |
| `src/client/contract/slots.ts` | The injected shares and props composition |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`dsh-agent-presets`](../../preset/agent-presets/README.md) — the roster this page renders and the `preset.yml` metadata fields the cards show.
- [`dsh-client-ui-agent-preset`](../ui-agent-preset/README.md) — the preset surfaces this package stages picks through.
- [Slots subsystem](../../../docs/subsystems/slots.md) — the hole/occupant model this registration uses.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the agent-preset roster it renders: a hire stages which preset composes the next session, and the host records that choice as its own `agent-preset/selected` session event.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Local roster only** — the page presents the deployment's installed presets; installing from a remote expert registry arrives with the marketplace install channel and its trust policy.
- **Browse-and-hire only** — expert authoring, favorites, and per-card reviews are deferred until the registry exists to publish them.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
