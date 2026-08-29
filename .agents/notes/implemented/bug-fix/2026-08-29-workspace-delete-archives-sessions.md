# Agent Note: Deleting a workspace archives its member sessions

Status: implemented

English | [中文](2026-08-29-workspace-delete-archives-sessions.zh.md)

## Problem

Deleting a Workspace removed only its registration; every member session instantly fell out of all grouping surfaces and reappeared in the sidebar's Ungrouped bucket. Users who deleted a workspace they no longer wanted saw its old sessions regroup under "Ungrouped", which read as the deletion failing to clean up. The client half could not fix this itself: it would have to fan out per-session verbs before the delete RPC, with no atomicity and a window where sessions are already ungrouped.

## Decision

`WorkspaceRegistry.deleteKnown` now extends the registry-global archive set with the workspace's member sessions in the same committed state write that removes the registration. Membership uses the entity's filtered `sessionIds` getter, so only sessions that passed the id-plus-canonical-cwd check enter the set; sessions already filtered out (missing headers, dead cwds) were Ungrouped strays before the delete and stay outside, preserving the archived set's known-session invariant. Host streams already publish `host/archived-sessions-changed` on archive-set mutations, so every connected client sweeps the archived rows — including an archived current selection, which clears into the New Session view — with no client-side change.

## Alternatives considered

**Detach sessions from the workspace without archiving.** Rejected: the sessions would still land in Ungrouped, the exact surface the report complains about.

**Client-side per-session delete or archive before the delete RPC.** Rejected: non-atomic, needs N round trips, and the client `ISessions` face has no delete verb to begin with.

**Delete the sessions outright.** Rejected: session deletion is a separate, still-absent capability, and the registration-deletion decision keeps session logs Host-owned.

## Verification

`packages/workspace/workspace/tests/workspace.spec.ts` covers the delete archiving its member into the durable archived set while the directory and session logs stay untouched. `packages/host/apiproxy/tests/api-proxy-workspace.spec.ts` covers the wire flow: the delete streams `host/archived-sessions-changed` before `host/workspace-removed`, and `workspace.list` reports the archived id. `apps/web/tests/workspace-management.e2e.ts` covers the product behavior: after deleting a workspace through the dialog its session disappears from every grouping surface, the Ungrouped bucket withdraws, and the state survives a reload.

## Consequences

Deleting a workspace now hides its sessions everywhere in one step; unarchiving a session after its workspace is gone leaves it Ungrouped, because the accounting slot dies with the workspace record. The delete dialog copy states the archive outcome. The host stream now emits one extra frame per delete, ordered archive-change before removal.
