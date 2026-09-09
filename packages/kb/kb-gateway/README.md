---
description: "The knowledge-base wire projection: expose the listing service to trusted web clients over the host's Typert Remote gateway."
kind: "package-reference"
---

# @deepseek-ai/dsh-kb-gateway

English | [中文](README.zh.md)

## Summary

`dsh-kb-gateway` puts the knowledge-base listing behind the host's authenticated web gateway: the sidebar knowledge section reads the bases and the deployment console URL through this projection instead of reaching the service directly. Every call arrives from a signed-in client, so the gateway forwards nothing but read verbs and lets `dsh-kb-weknora` keep owning the transport and credential resolution.

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

Mount the plugin on a host that also provides a `ctx.knowledgeBase` implementation; it registers the wire face `ctx.knowledgeBaseGateway` under the `knowledgeBase` Remote namespace.

```yaml
- name: '@deepseek-ai/dsh-kb-weknora'
- name: '@deepseek-ai/dsh-kb-gateway'
```

### Minimal configuration

No config: the gateway adds no fields. The sidebar knowledge section and the host Remote assembly are the only consumers.

### What can go wrong

The gateway is a pure projection: a call whose underlying service rejects propagates that rejection, and the client renders it as its retry state.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin extends `TypertRemoteService` with the wire namespace `knowledgeBase` and its own service key `knowledgeBaseGateway`, so the registration never collides with `ctx.knowledgeBase`. It projects both contract methods one-to-one: the base listing and the deployment facts read.

| File | Owns |
|---|---|
| `src/index.ts` | The `KnowledgeBaseGateway` Typert remote projection of `ctx.knowledgeBase` |
| `src/types.ts` | The wire request/response types generated for the `knowledgeBase` namespace |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Knowledge-base subsystem](../../../docs/subsystems/knowledge-base.md) — the listing types and `ctx.knowledgeBase` API.
- [`dsh-kb`](../kb/README.md) — the contract being projected.
- [`dsh-kb-weknora`](../kb-weknora/README.md) — the provider behind the projection.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the wire clients it serves; the projection registers no prompt, tool schema, or event payload of its own.

#### KV Cache effect

No direct invalidation; the forwarded responses own any client-side context effects.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Trusted clients only** — the projection adds no authorization of its own; it relies on the host gateway's authenticated session and the provider's credential-scoped visibility.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
