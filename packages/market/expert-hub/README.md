---
description: "The expert-hub wire projection: expose the market's expert category to trusted web clients over the host's Typert Remote gateway."
kind: "package-reference"
---

# @deepseek-ai/dsh-expert-hub

English | [中文](README.zh.md)

## Summary

`dsh-expert-hub` puts the market's `expert` category behind the host's authenticated web gateway: the expert page reads installable expert cards and starts installs through this projection instead of reaching the market service directly. Every call arrives from a signed-in client, so the gateway forwards opaque source, entry, and bundle ids verbatim and lets `dsh-market-local` keep resolving names, versions, and commands on the host.

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

Mount the plugin on a host that also provides a `ctx.market` implementation; it registers the wire face `ctx.expertHub` under the `expertHub` Remote namespace.

```yaml
- name: '@deepseek-ai/dsh-market-local'
- name: '@deepseek-ai/dsh-expert-hub'
```

### Minimal configuration

No config: the gateway adds no fields. The expert page and the host Remote assembly are the only consumers.

### What can go wrong

The gateway is a pure projection: a call whose underlying service rejects propagates that rejection, and a catalog read with no selected source returns whatever empty page the market provider yields.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin extends `TypertRemoteService` with the wire namespace `expertHub` and the same service key. It projects three methods: `catalog` browses the market with `category: 'expert'`, `install` forwards a source-local entry ref, and `remove` uninstalls by bundle id.

| File | Owns |
|---|---|
| `src/index.ts` | The `ExpertHubGateway` Typert remote projection of `ctx.market` |
| `src/types.ts` | The wire request/response types; `package.json` `exports["./types"].types` points here so Client typecheck resolves before `lib/types` exists |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Plugin market subsystem](../../../docs/subsystems/market.md) — the market types and `ctx.market` API.
- [`dsh-market`](../market/README.md) — the contract being projected.
- [`dsh-market-local`](../market-local/README.md) — the provider behind the projection.
- [`dsh-client-ui-expert`](../../client/ui-expert/README.md) — the expert page that consumes the catalog.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the wire clients it serves; the projection registers no prompt, tool schema, or event payload of its own.

#### KV Cache effect

No direct invalidation; the forwarded responses own any client-side context effects.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Trusted clients only** — the projection adds no authorization of its own; it relies on the host gateway's authenticated session and the provider's host-side validation.
- **Market-backed only** — the hub admits store entries in the `expert` category; shipped roster experts continue to arrive through `agentPresets.list`, not this wire.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
