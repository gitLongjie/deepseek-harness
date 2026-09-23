---
description: "Expert-center plugin for the dsh web client: a sidebar entry row opening the conversation-area page that presents the deployment's expert market as hireable expert cards."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-expert

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-expert` is the expert center of the dsh web client: a sidebar entry row (between the knowledge and business regions) opens the page in the conversation area — the expert market presented as hireable expert cards, each carrying its avatar, attribution subtitle, curator badge, description, and tags, with text search over those texts, the category filter bar the record metadata feeds, per-card suggested prompts, and a hire action per card. Hiring stages the card's preset id for the NEXT session through the ui-agent-preset staging service and starts that session. The market's sole source is the experts the deployment ships — roster rows that publish card metadata, delivered by the market's install channel; mode presets publish no card metadata and never present here.

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

No config of its own: the page renders the roster the deployment ships — presets that publish card metadata present as hireable experts, and the rest of the roster stays out.

### What can go wrong

The section registers into the shell-declared `sidebar.experts` hole and the page into ui-conversation's `conversation.expert.browser` hole; removing a declaration leaves the registration waiting and the surface absent, which is the documented behavior of an unoccupied slot. Hiring while no conversation flow is bound stages nothing: the staging service no-ops without a seat to land the pick on, and the page still starts the session on the deployment default.

A roster row the host reported broken (its composition cannot mount) keeps its card on the page with the hire action disabled and the health verdict shown: the market is the only surface that advertises the expert, so the misconfiguration reports here instead of hiring into a silent failure.

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

- [`dsh-agent-presets`](../../preset/agent-presets/README.md) — the `preset.yml` metadata fields expert cards are shaped after, and the preset surfaces the roster stays out of.
- [`dsh-client-ui-agent-preset`](../ui-agent-preset/README.md) — the preset surfaces this package stages picks through.
- [Slots subsystem](../../../docs/subsystems/slots.md) — the hole/occupant model this registration uses.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the preset each hire stages: a hire forwards the card's preset id to the staging service, the next session composes from it, and the host records the choice as its own `agent-preset/selected` session event.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Roster-driven market** — the market reads the deployment's agent-preset roster; the attribution subtitle, curator badge, and avatar image a card design reserves await the roster carrying them with the marketplace install channel, so cards fall back to a gradient tile and the published glyph.
- **Browse-and-hire only** — expert authoring, favorites, and per-card reviews are deferred until the registry exists to publish them.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
