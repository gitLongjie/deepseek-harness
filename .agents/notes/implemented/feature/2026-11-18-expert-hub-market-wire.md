# Agent Note: Expert hub market wire

Status: implemented

English | [中文](2026-11-18-expert-hub-market-wire.zh.md)

## Problem

The expert page needs installable store entries (`category: "expert"`) as a typed catalog distinct from the agent-preset roster. Without a dedicated wire, the page cannot name `ExpertHubCatalog` or call install/remove without reaching the whole market surface, and LiveShare cannot classify the endpoints the Client assembly already mounts.

## Decision

Ship `@deepseek-ai/dsh-expert-hub` as a Typert Remote projection of the market's `expert` category under the `expertHub` namespace (`catalog`, `installEntry`, `uninstall`). Re-export `./types` from `dsh-api-remotes`, merge hub rows into `dsh-client-ui-expert` beside roster experts, classify the three endpoints in LiveShare, and mount the gateway next to `market-gateway` in the web-app patch. The `./types` export's `types` condition points at `src/types.ts` so Client typecheck can resolve `ExpertHubCatalog` before the package's `lib/types` emit exists.

## Alternatives considered

**A separate expert Service Definition and local provider.** Rejected: it would duplicate market install/uninstall without a second consumer that needs a different contract.

**Extend only `market/*` for the expert page.** Rejected: the page would keep filtering `market/browse` and would not get a stable `ExpertHubCatalog` type of its own.

## Verification

- `packages/market/expert-hub/tests/gateway.spec.ts` projects catalog/install/remove through a mocked `ctx.market`.
- Client-face LiveShare completeness includes `expertHub/catalog|installEntry|uninstall`. The wire names are not `install` or `remove`, because those names collide with the Remote client's namespace service.
- `ui-expert` typechecks against `ExpertHubCatalog` from `@deepseek-ai/dsh-expert-hub/types`.

## Consequences

The expert page can merge installable hub rows with the roster without importing market wire types. Install and remove stay owned by `ctx.market`; the hub only filters the `expert` category and renames the wire for that UI. Online persona modules are a separate decision: [Expert plaza modules](2026-11-20-expert-plaza-modules.md).
