# Agent Note: Client boot graph Loader reconciliation

Status: implemented

English | [中文](2026-09-01-client-boot-graph-loader-reconciliation.zh.md)

## Problem

The desktop client could receive a boot graph containing a dynamically mounted directory-picker surface but not the static UI renderer or workspace entries that provide its `slots` and `uiWorkspace` services. The browser Loader left the picker pending and rendered a boot failure on a fresh installation.

## Decision

`ClientModuleRegistry.graph()` reconciles every current Loader row before returning the graph, and the webserver index-injection listener reads that method. The reconciliation captures client rows that existed before the registry's `internal/plugin` listener began observing lifecycle events, while the listener continues to publish later dynamic additions and removals.

In a packaged application, the registry resolves a bare Loader row from `dshBareModuleBaseUrl`, the installed application location that the desktop root Include also uses to import bare packages. It retains the owning tree's base URL for relative, absolute, and file rows. A writable `$DSH_HOME` profile cannot resolve through `app.asar`, so using its URL for a static bare row would incorrectly omit that row from the graph.

The graph therefore includes the renderer, workspace, and selected directory-picker surface when the desktop shell renders its injected `index.html`. The browser Loader can activate the service providers before the picker, and the picker registers both directory-flow occupants.

## Alternatives considered

**Rely only on `internal/plugin` events.** Rejected: the event subscription has no replay, so a registry created after a Loader row can never discover that row through future events alone.

**Resolve every row from the writable profile tree.** Rejected: this matches open source runs, but a packaged desktop profile is deliberately outside `app.asar`. Its static bare entries have already been imported from the installed host, and metadata discovery must use that same location.

**Add fallback `slots` or `uiWorkspace` implementations to the picker.** Rejected: the picker requires the real renderer and workspace navigation services. A fallback would hide an incomplete boot graph and leave the directory flow unusable.

**Make the native picker a permanent static row.** Rejected: the host selects the native or browse interaction at runtime. Static inclusion would not repair the general registry race and would break that selection model.

## Consequences

Graph reads do a bounded reconciliation over the live Loader entries. The node-half regression tests cover an entry that becomes visible without a lifecycle event and a packaged bare entry whose writable profile cannot resolve the installed package. The web boot test covers activation of the renderer, workspace, and picker dependency chain. Desktop packaging must still include the three package artifacts; the reconciler only makes active Loader rows visible to the browser.
