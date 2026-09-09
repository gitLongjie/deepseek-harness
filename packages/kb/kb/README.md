---
description: "The knowledge-base listing contract: the bases a deployment's enterprise knowledge service exposes, with opaque backend-assigned ids."
kind: "package-reference"
---

# @deepseek-ai/dsh-kb

English | [中文](README.zh.md)

## Summary

`dsh-kb` declares the knowledge-base capability: list the bases a deployment's knowledge service exposes to the configured credential. Base ids are backend-assigned and opaque; visibility follows the credential the provider resolves, so the listed bases are exactly what the deployment may read. The concrete WeKnora provider lives in `dsh-kb-weknora`; consumers are the host Remote gateway (`dsh-kb-gateway`) and the web client's sidebar knowledge section. Retrieval verbs join this definition when a consumer needs them.

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

Consume `ctx.knowledgeBase` through the Service Definition; mount a provider to supply it.

```yaml
- name: '@deepseek-ai/dsh-kb-weknora'
- name: '@deepseek-ai/dsh-kb-gateway'
```

### Minimal configuration

No config: the definition owns no fields. Its types are the shared vocabulary of the group.

### What can go wrong

Mounting no provider fails the consumers' `inject` at boot — the capability either exists or the composition says so loudly.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package declares the abstract `KnowledgeBase` service (`ctx.knowledgeBase`) with its types, plus the package-owned invariant companion. Behavior invariants live with their owners.

| File | Owns |
|---|---|
| `src/index.ts` | The abstract `KnowledgeBase` Service Definition and the `ctx.knowledgeBase` merge |
| `src/types.ts` | `KnowledgeBaseId` and `KnowledgeBaseView`, the group's shared vocabulary |
| `src/invariant.ts` | The package invariant companion |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Knowledge-base subsystem](../../../docs/subsystems/knowledge-base.md) — the listing types and `ctx.knowledgeBase` API.
- [`dsh-kb-weknora`](../kb-weknora/README.md) — the WeKnora provider.
- [`dsh-kb-gateway`](../kb-gateway/README.md) — the wire projection.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the clients the listing serves; the definition registers no prompt, tool schema, or event payload of its own.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Listing only** — retrieval verbs join the definition when a consumer needs them; until then clients answer from a base only through model-facing knowledge tools.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
