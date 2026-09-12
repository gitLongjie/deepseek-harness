# Agent Note: Sidebar business-entry group

Status: implemented

English | [中文](2026-09-12-sidebar-business-entry-group.zh.md)

## Problem

The sidebar's browsing region held only the workspace browser and (optionally) the knowledge-base section. Deployments shipping their own task entries — reports, briefings, scripts, rumor detection — had no place in the navigation shell to surface them. Adding each entry as a separate top-level slot would bloat the shell contract; embedding them inside the workspace browser would conflate session management with deployment-specific task routing.

## Decision

The sidebar shell declares a `sidebar.business` hole between `sidebar.knowledge` and `sidebar.workspaces` in the browsing region, mirroring the `sidebar.knowledge` pattern. A standalone deployment plugin, `@xmanrui/dsh-business-entry` (source under `business-entry/`, bundled by its own esbuild script), fills it: a collapsible disclosure row over a static catalog of seven entries (`dailyReport`, `topics`, `sentiment`, `videoScript`, `report`, `multiFormat`, `rumor`). The group's disclosure state and the user's pick ride an entry-declared store that survives the shell unmounting wide content at collapse settle. No inject face is declared because no Host data reaches a menu that only records a pick. In the 56px rail the group renders a single icon button that asks the shell for the expanded column and opens the group with it.

The entry catalog lives in the plugin's `src/client/entries.ts` and derives the selection-id type from the array literal, so a row's id and its label cannot drift apart. Labels ride the `business` locale namespace. Selection is viewing state only: no page, command, or session action consumes the pick yet; future business surfaces will read the same store when they ship.

## Alternatives considered

**Embed entries inside the workspace browser.** Rejected: the workspace browser owns session grouping, ordering, search, and drag — mixing deployment-specific task routing into it would couple two unrelated domains and force every workspace-browser test to know about business entries.

**One top-level slot per entry.** Rejected: seven new shell holes for a single conceptual group would bloat the sidebar contract and make the shell topology depend on the deployment's task count. A single `sidebar.business` hole with a self-contained occupant keeps the shell stable across catalog changes.

**Hardcode the group inside ui-sidebar.** Rejected: the sidebar shell owns column geometry only; business content belongs to a registrant. A built-in occupant would violate the shell's separation and prevent deployments from replacing or removing the group without forking the shell.

**Persist disclosure and selection across reloads.** Rejected: persisting selection would require validating restored ids against the live catalog at a durable boundary, and the catalog is static source — a mismatch between persisted state and a changed catalog would need migration logic for zero current consumer. Disclosure resets on reload; persisting arrives when a consumer ships.

## Consequences

The sidebar shell gains one more optional region seat; deployments without business entries register no occupant and the region renders without the section, and the generated slot catalog ships the seat unoccupied because the occupant lives outside the workspace scan. The plugin deploys into the web profile's `node_modules` and registers through the profile's patch layer; `apps/desktop/scripts/dev.ts` rebuilds and re-copies it next to the IM plugin, and the home `cordis.patch.yml` `disabled` row turns it off per machine. The store outlives sidebar collapse but not page reload; wiring a consumer requires reading the store through the same declared handle. The entry catalog is source-static: adding, removing, or reordering entries requires editing the plugin's `src/client/entries.ts` and rebuilding.
