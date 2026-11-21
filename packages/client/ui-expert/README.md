---
description: "Expert-center plugin for the dsh web client: a sidebar entry row opening the conversation-area page that presents the deployment's expert market as hireable expert cards."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-expert

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-expert` is the expert center of the dsh web client: a sidebar entry row (between the knowledge and business regions) opens the page in the conversation area — the expert market presented as hireable expert cards, each carrying its avatar, attribution subtitle, curator badge, description, and tags, with text search over those texts, the category filter bar the record metadata feeds, per-card suggested prompts, and a hire action per card. Hiring stages the card's preset id for the NEXT session through the ui-agent-preset staging service and starts that session. The market admits roster rows that publish card metadata. Shipped Standard, PTC, Minimal, and Creator presets publish `category: general`, so they appear here beside experts delivered by the install channel. A row with no card metadata stays out. Filter chips for the shipped category ids general, marketing, and content come from this package's dictionaries. Any other category id stays as authored text.

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

No config of its own: the page renders the roster the deployment ships — presets that publish card metadata present as hireable experts, and the rest of the roster stays out. The page has two modules. My experts is that roster: each card opens a detail dialog with its description, persona, and skill titles, and shows the version saved on this machine. A card this account saved locally, and a shipped expert loaded from outside `.agent-presets`, can be uploaded. The card shows when that upload finishes, or why it stopped. A healthy card can be hired into a new chat or saved as the new-task default. A plaza install on that roster offers update when the published version is higher. Expert plaza lists modules published on the gateway: each card shows its version, a missing one is downloaded, and a higher published version of an installed copy is updated. A module this account already published from a local expert shows that version and does not offer another download. Hire appears after a plaza module is installed. The new-session chip opens this page. The default card shows that badge.

### What can go wrong

The section registers into the shell-declared `sidebar.experts` hole and the page into ui-conversation's `conversation.expert.browser` hole; removing a declaration leaves the registration waiting and the surface absent, which is the documented behavior of an unoccupied slot. Hiring while no conversation flow is bound stages nothing: the staging service no-ops without a seat to land the pick on, and the page still starts the session on the deployment default.

A roster row the host reported broken (its composition cannot mount) keeps its card on the page with hire and the new-task default disabled, and the health verdict shown: the market is the only surface that advertises the expert, so the misconfiguration reports here instead of hiring into a silent failure.

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
| `src/client/ExpertBrowser.tsx` | The page: my experts and the plaza, search, category filter, card grid, hire, states |
| `src/client/navigation.ts` | The page store and its close-on-session watcher |
| `src/client/contract/slots.ts` | The injected shares and props composition |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`dsh-agent-presets`](../../preset/agent-preset-registry/README.md) — the `preset.yml` metadata fields expert cards are shaped after, and the preset surfaces that read the roster.
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
- **Upload skips plaza installs and package copies** — a card saved by the signed-in account and a shipped expert can be uploaded. A plaza install and a preset under `.agent-presets` cannot. Favorites and per-card reviews stay deferred.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
