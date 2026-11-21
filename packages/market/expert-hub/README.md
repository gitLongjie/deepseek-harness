---
description: "The expert-hub wire projection: expose the market's expert category to trusted web clients over the host's Typert Remote gateway."
kind: "package-reference"
---

# @deepseek-ai/dsh-expert-hub

English | [中文](README.zh.md)

## Summary

`dsh-expert-hub` puts the market's `expert` category behind the host's authenticated web gateway: the expert page reads installable expert cards and starts installs through this projection instead of reaching the market service directly. The same gateway lists, uploads, and installs online expert modules on the token-api expert hub, and reads one card's persona for its detail dialog. Every call arrives from a signed-in client, so the gateway forwards opaque source, entry, and bundle ids verbatim and lets `dsh-market-local` keep resolving names, versions, and commands on the host. Upload uses the signed-in `DEEPAGENS_API_KEY`. A saved card (`origin` absent or `mine`) and a shipped preset whose directory is outside `.agent-presets` can be uploaded. A plaza install cannot.

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

`origin` is optional and defaults to `https://claw.deepagens.com`. The expert page and the host Remote assembly are the consumers. Upload and plaza download also need `dsh-credentials` and `dsh-expert-publish` on the host; without them those methods return a refusal and the npm catalog still works.

### What can go wrong

The gateway is a pure projection: a call whose underlying service rejects propagates that rejection, and a catalog read with no selected source returns whatever empty page the market provider yields.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin extends `TypertRemoteService` with the wire namespace `expertHub` and the same service key. It projects `catalog` (the market `expert` category), `installEntry`, `uninstall`, `plaza`, `uploadable`, `versions`, `detail`, `publishModule`, and `installModule`. The wire names are not `install` or `remove`, because those names collide with the Remote client's namespace service. `plaza`, `uploadable`, `versions`, and `detail` are reader reads; `publishModule` and `installModule` are owner actions. A downloaded module is registered through `ctx.expertPublisher`, so it is hireable without a restart. `publishModule` reads a saved expert file first and otherwise the shipped preset directory. `versions` returns the version saved for each local expert; a plaza install also carries the published version when that copy can be updated.

| File | Owns |
|---|---|
| `src/index.ts` | The `ExpertHubGateway` Typert remote projection of `ctx.market` and the online module methods |
| `src/online.ts` | token-api plaza, upload, and install |
| `src/shipped.ts` | persona and skills read from a shipped preset directory |
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
- **Two catalogs** — npm store entries stay on `catalog`; online modules stay on `plaza`. Shipped roster experts continue to arrive through `agentPresets.list`. The host does not run scripts from an uploaded module.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
