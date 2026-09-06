---
description: "The plugin market service contract for implementers and consumers: source registry, catalog browsing, npm-identity installability, and profile install outcomes."
kind: "package-reference"
---

# @deepseek-ai/dsh-market

English | [中文](README.zh.md)

## Summary

`dsh-market` lets a user pick a plugin from a catalog source and install it into a managed profile. The service lists the user's configured sources, browses their normalized catalog entries, validates that one entry maps to exactly one npm package at an exact stable release declaring a dsh bundle, and runs the profile package manager with that exact version. Ids are opaque and host-validated: clients submit source and entry ids back to the service, which resolves every package name, version, and command itself. This package ships the contract only; the HTTPS catalog, npm registry, and pnpm implementation lives in `dsh-market-local`.

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

Load this package's consumer for the surface you want — the `dsh market` CLI, the host Remote gateway, or the web settings tab — plus a provider such as `dsh-market-local`. Compose a new provider by extending the exported `Market` service class; the abstract methods are the whole contract.

### When to choose it

Choose this package when you are implementing or consuming the market capability. Skip it when you only want to install a package once: `dsh plugin --profile <name> add <package>` does that without any catalog.

### Smallest working composition

```yaml
- name: '@deepseek-ai/dsh-market-local'
- name: '@deepseek-ai/dsh-market-gateway'
```

`dsh-market-local` registers `ctx.market`; the gateway projects it onto the wire for the web settings tab. The CLI reads the same service without extra mounting.

### What can go wrong

An entry the source does not list cannot install, and an install whose npm validation fails returns a failure outcome naming the unmet requirement. Nothing activates mid-session: new bundle layers load on the next host start.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package exports the abstract `Market` service class and its type vocabulary; the Context merge declares `ctx.market`. Every abstract method is an async operation on the selected source or the managed profile: `listSources`, `selectedSource`, `selectSource`, `addSource`, `removeSource`, `browse`, `entryDetail`, `installability`, `install`, `installed`, and `uninstall`. Types carry the cross-boundary contract — branded ids for source, entry, and bundle identity; normalized catalog entries that never leak provider payload fields; and discriminated install/uninstall outcomes with a bounded output tail on failure.

| File | Owns |
|---|---|
| `src/index.ts` | The abstract `Market` Service Definition and the `ctx.market` Context merge |
| `src/types.ts` | The market type vocabulary shared by every provider and consumer |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Plugin market subsystem](../../../docs/subsystems/market.md) — the type definitions and `ctx.market` service API.
- [`dsh-market-local`](../market-local/README.md) — the shipped provider and its catalog source contract.
- [Profiles and patch layers](../../../docs/architecture.md) — how bundle layers join a profile.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the CLI, gateway, and web consumers, which own every model-facing or user-facing projection of the market contract.

#### KV Cache effect

No direct effect; the service registers no prompt, tool schema, or event payload of its own.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The contract is intentionally transport-thin; these constraints follow from that choice.

- **No provider-side push** — catalog changes surface on the next read within the provider's cache lifetime; there is no change feed.
- **One managed profile per provider** — the contract names no multi-profile story; a provider implementation picks the profile it manages.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
