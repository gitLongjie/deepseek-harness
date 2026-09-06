---
description: "The market group map: plugin discovery, npm-validated installation, and the CLI, wire, and web surfaces — for users and maintainers navigating the group."
kind: "package-group"
---

# market/ — plugin market capability family

English | [中文](README.zh.md)

## Summary

The market group is the plugin-installation capability family: a user picks a plugin from a catalog source, the service validates the candidate's npm identity, and the install lands in a managed profile as a bundle layer that activates on the next host start. Catalog sources are user-configured and untrusted; the npm registry is the sole version authority, and every identity argument is a host-validated opaque id. The group splits into the Service Definition (`market`), the local provider with the catalog/registry/pnpm implementation (`market-local`), and the Typert Remote gateway (`market-gateway`).

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`market`](market/README.md) | Defines the market contract: source registry, catalog browsing, installability, install, and uninstall | `ctx.market` |
| [`market-local`](market-local/README.md) | Implements the contract over HTTPS catalog reads, the npm registry, and profile pnpm mutations | registers on `ctx.market` |
| [`market-gateway`](market-gateway/README.md) | Projects the contract onto the Typert wire for trusted web clients | registers on `ctx.marketGateway` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Plugin market subsystem](../../docs/subsystems/market.md) — the market types, source transports, and the `ctx.market` API.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
