---
description: "The market wire projection: expose the market service to trusted web clients over the host's Typert Remote gateway."
kind: "package-reference"
---

# @deepseek-ai/dsh-market-gateway

English | [中文](README.zh.md)

## Summary

`dsh-market-gateway` puts the market behind the host's authenticated web gateway: the web settings tab reads sources, browses catalog pages, and starts installs through this projection instead of reaching the service directly. Every call arrives from a signed-in client, so the gateway forwards opaque source, entry, and bundle ids verbatim and lets `dsh-market-local` keep resolving names, versions, and commands on the host. Mount it on any host whose web clients should manage plugins.

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

Mount the plugin on a host that also provides a `ctx.market` implementation; it registers the wire face `ctx.marketGateway` under the `market` Remote namespace.

```yaml
- name: '@deepseek-ai/dsh-market-local'
- name: '@deepseek-ai/dsh-market-gateway'
```

### Minimal configuration

No config: the gateway adds no fields. The web settings tab and the host Remote assembly are the only consumers.

### What can go wrong

The gateway is a pure projection: a call whose underlying service rejects propagates that rejection, and an entry the selected source does not list resolves to a not-found outcome rather than an error.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin extends `TypertRemoteService` with the wire namespace `market` and its own service key `marketGateway`, so the registration never collides with `ctx.market`. It projects all eleven contract methods one-to-one: source reads and mutations, browse with a query object, installability, install, the installed view, and uninstall by bundle id. `entryDetail` is the one reshaping method — the contract's `undefined` becomes a `{ found: false }` wire outcome, and a hit becomes `{ found: true, entry }` — so Remote clients never model optionality.

| File | Owns |
|---|---|
| `src/index.ts` | The `MarketGateway` Typert remote projection of `ctx.market` |
| `src/types.ts` | The wire request/response types generated for the `market` namespace |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Plugin market subsystem](../../../docs/subsystems/market.md) — the market types and `ctx.market` API.
- [`dsh-market`](../market/README.md) — the contract being projected.
- [`dsh-market-local`](../market-local/README.md) — the provider behind the projection.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the wire clients it serves; the projection registers no prompt, tool schema, or event payload of its own.

#### KV Cache effect

No direct invalidation; the forwarded responses own any client-side context effects.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Trusted clients only** — the projection adds no authorization of its own; it relies on the host gateway's authenticated session and the provider's host-side validation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
