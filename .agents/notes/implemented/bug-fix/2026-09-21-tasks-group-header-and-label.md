# Agent Note: Restore the trailing group header and name it Tasks

Status: implemented

English | [中文](2026-09-21-tasks-group-header-and-label.zh.md)

## Problem

The sidebar's trailing group holds the Sessions that no Workspace accounts for. The desktop branch had removed that group's header row — the loose-Session tail rendered as bare rows directly under the last Workspace folder, on the reasoning that the tail needed no title, card, or group actions. Two consequences followed. First, a Session created outside the GUI's Workspace flow (the CLI, the SDK, an IM binding, or a seeded history whose canonical cwd was never attached) appeared as an untitled row beneath an unrelated Workspace, with nothing naming it or the directory it runs in; the sidebar's own hover card and row layout carry no cwd either. Second, the recorded `snapshots/web/message-actions/fork.expected.md` golden and two `WorkspaceBrowser` specs still described a header row and a `.slice(1)` tree-item offset, so the keyless replay lane was red.

The bucket's copy was also rejected as product wording: 未分组 / Ungrouped describes what the group lacks rather than what it holds.

## Decision

The ungrouped bucket renders its header row again: the group's own expand toggle, no group menu, and an inert ＋ — a Session can be started in a real Workspace only, so the tail's ＋ must not fall back to the current or most recent Workspace from a group that owns no directory. `deriveGroups` again reads that group's persisted expansion flag like every other group, so the header's toggle and the auto-expand effect for the selected Session both apply to it.

The bucket's label is 任务 in Simplified Chinese and **Tasks** in English, changed in both dictionaries that name it: `ui-workspace`'s `group.ungrouped` (the sidebar header, the group-actions accessible names, and the search row's fallback Workspace label) and `ui-settings-unarchive-sessions`'s `ungrouped` (the archived-sessions page's owning-Workspace column). The group's code identity is unchanged: `UNGROUPED_KEY` in `tree.ts`, the browser-local order account key, and the dictionary key name all still say ungrouped.

## Alternatives considered

**Keep the headerless tail and rename the label.** The label has no surface without a header, and the rows would still read as members of the preceding Workspace.

**Name the bucket only in the sidebar.** The archived-sessions page names the same bucket for the same Sessions, so one product concept would carry two names.

**Give the tail's ＋ the current-or-recent-Workspace fallback.** `startSession` without a Workspace inherits the selection or the most recent Workspace, so the ＋ would create a Session in a directory the row it sits on does not name.

**Hide the ungrouped rows behind the "In one list" grouping mode.** Sessions outside every Workspace are ordinary product history; making them reachable only after a view-mode switch hides them further, not less.

## Verification

`pnpm exec vitest run packages/client/ui-workspace packages/client/ui-settings-unarchive-sessions` covers the restored behavior: `workspace-browser.client.spec.tsx` pins the auto-expanded Tasks header for a loose current Session, its absent group menu, its inert ＋, and the header row's place in the rendered tree during drag reordering; `tree.client.spec.ts` covers the ungrouped group's derivation and expansion flag; `rows.client.spec.tsx` covers the header's missing workspace menu. `packages/client/ui-settings-unarchive-sessions/tests/components.client.spec.tsx` pins the Tasks label on the archived-sessions page.

`DSH_SNAPSHOT=replay pnpm run test:web` replays the `message-actions` scenario, whose fork golden again lists the trailing group header above the seeded Sessions.

## Consequences

Sessions outside every Workspace are visible again as a labeled group that names them and opens for the selected Session. The group carries no rename, delete, reveal, or create action, so nothing in it can act on a directory it does not own. The `delete.desc` copy still tells users that deleting a Workspace archives its Sessions, which is what the Host does; the label change does not alter membership, ordering, archiving, or the Workspace registry's attach rule, so a Session still joins a Workspace only through `attachSession`.
