# Agent Note: Scheduled work — an app-level task capability and the desktop management page

Status: implemented

English | [中文](2026-09-19-schedule-work-app-tasks.zh.md)

## Problem

The desktop product needs a 定时工作 (scheduled work) entry where the user — not the model — creates tasks that run a prompt in a workspace on a calendar plan such as "daily at 09:00", with pause, a validity end, and run records. The existing capability does not fit: `dsh-schedule` reminders are **session-local** — records live in the owning session's event log, delivery lands in that same conversation, the rules are after/at/every only (fixed rate, no calendar semantics), there is no paused state, and there is no client-facing read/write channel at all (the only UI is the read-only session-header catalog). Stretching that model over product-level tasks would dress "a reminder belonging to a session" up as "a task belonging to the user", and pause, run history, and cross-session binding could only be faked.

## Decision

A new capability seam with one package on each end:

- `packages/schedule/schedule-work` (host): the `scheduleWorkGateway` Service Definition plus the `scheduleWork` Typert Remote namespace (list/listRuns/create/update/removeTasks — the wire method avoids the reserved `remove`, which collides with the Remote namespace service and the client API refuses the whole namespace over it). Durable state lives in the `schedule_work` storage domain (a storage-domain JSON document), never in a session log. The runtime holds a 30s drain timer; a dispatch creates a fresh Session through the Session Controller (attached to the bound workspace), optionally runs the `/permission danger-full-access` command through the command runtime, queues the prompt as the Session's first user message, and finalizes the run record once the Agent returns to idle. Catch-up is latest-only: a window of missed slots dispatches once, at the latest slot. Calendar rules resolve in the Host's local time zone.
- `packages/client/ui-schedule-work` (browser): a `sidebar.panellist` row plus a same-keyed `main` page — the panellist mechanism's first occupant; the page reads and writes through `ctx.remote.scheduleWork`, and the editor's workspace picker rides the global `useWorkspaces` hook.

Load-bearing choices: `nextRunAt` is never persisted (it is derived from rule + `lastRunAt` + validity at every read, so it cannot diverge); a dispatch writes the run record, then advances `lastRunAt` atomically, then creates the Session, so a slow create cannot double-fire; dispatches for one task never overlap; the full-access switch goes through the `/permission` command — permission-presets' owned seam — and when the command is unavailable the run fails instead of silently proceeding with defaults. `dsh-schedule` stays as it is: reminders belong to sessions, scheduled tasks belong to the app.

## Alternatives considered

**Extend dsh-schedule's change union with pause, calendar rules, and app-level storage.** Rejected: that welds two durable models — "a projection folded from a session log" and "an app-level record" — into one package; the fork inheritance semantics (cut at `inheritedEventCount`) mean nothing for app-level tasks, and the persistence type union would need extending and migrating.

**Client-driven scheduling: compute times in the page and deliver via the session create/prompt remotes.** Rejected: the moment the desktop app closes, nothing runs; the scheduler must live in the host process.

**Reuse the storage domain but expose reads and writes as agent tools.** Rejected: user operations must not depend on a model relaying a tool call; the Remote face is the deterministic channel, and tools remain for agent-initiated flows.

## Consequences

The desktop graph mounts both rows by default; no overlay. `~/.dsh/storages/schedule_work.json` is the only task and run state. Run records keep the newest 50 per task, pruned after each run finishes. Calendar rules have no per-task zone, no cron grammar, and no replay of downtime misses — the package READMEs own those limits. The sidebar panellist now has its first real occupant; any future global panel follows the same pattern.

## Verification

`packages/schedule/schedule-work/tests/domain.spec.ts` pins rule validation and local-time occurrence math (including the catch-up window); `tests/runtime.spec.ts` pins create/edit/remove, persistence across a reopen, latest-only catch-up, paused skipping, validity, the full-access command and its failure path, and no double dispatch in flight, over the real storage domain on an in-memory backend; `tests/gateway.spec.ts` pins the Remote projection and error-code mapping; `packages/client/ui-schedule-work/tests/schedule-work-page.client.spec.tsx` pins catalog rendering, filter and search, batch management, dialog create/edit, run records, and both dictionaries.
