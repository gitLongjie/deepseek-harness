---
description: "Knowledge-base plugin for the dsh web client: a sidebar section listing the bases a deployment's WeKnora exposes, and the conversation-area document browser a base row opens."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-knowledge-base

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-knowledge-base` is the knowledge page of the dsh web client: a sidebar entry row opens the page in the conversation area — the base list beside the document browser (名称/类型/更新时间), with inline document search, the deployment console action, and an ask action per base that starts a New Session. Data arrives through the `knowledgeBase` Remote namespace, so the page renders without any knowledge of WeKnora's transport.

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

The web bundle mounts the plugin by default; remove the row (with the `kb-weknora` and `kb-gateway` host rows) to turn the surface off.

```yaml
- id: ui-knowledge-base
  name: '@deepseek-ai/dsh-client-ui-knowledge-base'
```

### Minimal configuration

No config of its own: the section reads the deployment facts from the gateway (`list` + `describe`). A failed or empty listing renders as a status row — retryable error, loading, or empty — never as a broken region.

### What can go wrong

The section registers into the shell-declared `sidebar.knowledge` hole; removing the ui-sidebar declaration (or the shell) leaves the registration waiting and the section absent, which is the documented behavior of an unoccupied slot.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Two slot registrations: `KnowledgeBaseSection` fills `sidebar.knowledge` with a persisted fold store, an inject factory over the Remote face and the Workspace UI's shared New Session action, and this package's `knowledge` locale namespace. Header, search, and rail conventions mirror the workspace browser so the sections read as one region.

| File | Owns |
|---|---|
| `src/client/index.ts` | The `sidebar.knowledge` registration, dictionaries, and inject factory |
| `src/client/KnowledgeBaseSection.tsx` | The section: header, search, states, base rows, rail |
| `src/client/stores.ts` | The persisted fold store |
| `src/client/contract/slots.ts` | The injected share and props composition |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Knowledge-base subsystem](../../../docs/subsystems/knowledge-base.md) — the listing types and `ctx.knowledgeBase` API.
- [`dsh-client-ui-workspace`](../ui-workspace/README.md) — the region this section renders above.
- [Slots subsystem](../../../docs/subsystems/slots.md) — the hole/occupant model this registration uses.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the host-side knowledgeBase service the section calls, which owns every model-facing effect.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Browse-only rows** — a base row opens the document browser; scoping a session's knowledge tools to the picked base arrives with per-session agent presets.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
