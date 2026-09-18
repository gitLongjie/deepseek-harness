# Agent Note: The packaged client scan resolves bare entries from the installed host

Status: implemented

English | [中文](2026-09-18-client-scan-resolves-from-installed-host.zh.md)

## Problem

After [the runtime-closure fix](2026-09-18-packaged-desktop-runtime-dependency-closure.md), the packaged shell still booted its full plugin roster on the build machine and rendered a plugin-loading screen that never left on a real install. The smoke's outside-repository, isolated-`DSH_HOME` copy finally reproduced it on the build machine: the client-modules graph composed one application entry (a 47,505-char index render) from the payload that composed all 61 entries when run from inside the repository — the running location decided the graph.

`ClientModuleRegistry.resolveSource` picked the resolution base with an inverted condition: `exactPackageSpecifier(loaderName) === undefined` selects the non-package specifiers (cordis builtins, relative and file paths), so every scoped bare row (`@deepseek-ai/...`) resolved from the profile tree's base URL in `$DSH_HOME`. Node's upward walk from there lands in `$DSH_HOME/profiles/node_modules` — the fallback directory only a dev run's healing populates — so a machine that never ran from a checkout resolved no client package, and the renderer booted zero plugins waiting forever for `uiRenderer`.

## Decision

A plain bare package name (scoped or unscoped, per `exactPackageSpecifier`) resolves from `dshBareModuleBaseUrl ?? <owning tree base>`; the non-package specifiers keep the owning tree. The registry declares the fact in its `inject` list — the boot layer always provides it (undefined in the open runtime), so the declaration documents the dependency without a pending-fiber risk. In the open runtime the fact is undefined and the fallback keeps dev behavior unchanged; the profile tree resolution the old code exercised remains for the specifiers that need it.

## Alternatives considered

**Heal the fallback directory at packaged boot.** Rejected: the closure fix already rejected creating `$DSH_HOME/profiles/node_modules` entries for a packaged run, and healing would couple the packaged app's correctness to a writable side directory again — the same machine-dependence, one step later.

**Resolve through the Loader's import machinery instead of the package-metadata walk.** Rejected for now: the scan needs each package's manifest and client export path, not its module record, and re-deriving them from import results duplicates the resolution the base fact already anchors.

## Consequences

A packaged install composes the same client graph anywhere — inside the checkout, under a spaced install path, on a machine with a fresh `DSH_HOME`. The build machine loses its accidental advantage: the outside-repository smoke now fails payloads that only booted there. Machines that ran earlier installers keep their state in `%APPDATA%\<display name>`; see [the ASCII userData id note](2026-09-18-desktop-userdata-ascii-id.md) for the directory decision in the same repair.

## Verification

`packages/client/modules/tests/node-half.client.spec.ts` pins the packaged-base resolution for a scoped bare row (the fixture resolver rejects the profile base, so only the installed host resolves), the `dshBareModuleBaseUrl` injection contract, and the late-visible-entry resample. The packaged smoke's `client-graph` check reports one application entry on the broken payload and the full roster (61 entries, ~12.6MB index render) after the fix.
