---
description: "App-level scheduled work: durable tasks on calendar or fixed-rate rules dispatched into Sessions with run records, for users and maintainers choosing, configuring, or debugging the package."
kind: "package-reference"
---

# @deepseek-ai/dsh-schedule-work

English | [中文](README.zh.md)

## Summary

Schedule-work is the Host capability behind the desktop 定时工作 page: app-level tasks that run a prompt on a schedule, each dispatch opening a fresh Session in the bound workspace. Rules cover one-shot instants, daily, weekly, and monthly local calendar times, and fixed-rate intervals; tasks pause, carry a validity end, and can switch the created Session to the danger-full-access permission preset. Every dispatch writes a durable run record linking the Session. State lives in the `schedule_work` storage domain, and the Host exposes the Typert Remote `scheduleWork` namespace.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Dispatch semantics](#dispatch-semantics)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The shipped Web and desktop graphs mount the `schedule-work` Host row and the `ui-schedule-work` browser row together; no overlay is needed. The browser surface is the management page — create, edit, pause, resume, batch-remove tasks, and browse run records. There is no Config schema: enablement is composition, and every deployment-varying value (the rule, the prompt, the workspace binding) is per-task data.

The Remote namespace `scheduleWork` exposes `list`, `listRuns`, `create`, `update`, and `remove`. Validation refusals surface as the `schedule-work/invalid-task` Remote failure with the offending input field, and an edit naming an unknown task surfaces `schedule-work/task-not-found`.

### Rules

A rule is exactly one of:

- `once` — one RFC 3339 instant.
- `daily` — every day at one local `HH:mm` clock time.
- `weekly` — listed weekdays (0 = Sunday through 6 = Saturday) at one local clock time.
- `monthly` — a listed day of month at one local clock time; months without that day contribute nothing (no clamping).
- `interval` — a fixed rate of at least 300 seconds, anchored at the task's creation instant.

Calendar rules follow the Host's local time zone: the desktop runs where its user is. A DST gap resolves to the shifted instant `Date` construction produces; an overlap takes the first instant.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The gateway is a `TypertRemoteService` whose Service init opens the `schedule_work` domain and starts the runtime's drain timer (30s). `ScheduleWorkRuntime` reads the two tables (`tasks`, `runs`) and derives everything else: a task's next occurrence is computed from its rule, `lastRunAt` (else `createdAt`), and validity — never persisted, so it cannot diverge from the rule. Each drain scans enabled tasks for an occurrence in the half-open window `(lastRunAt, now]` clamped by `validUntil`; the latest occurrence in that window wins, so a task paused across many missed slots dispatches once, at the latest missed slot, and the next wait starts there (latest-only catch-up, matching the session reminder scheduler).

A dispatch writes its `running` run record, moves `lastRunAt` onto the occurrence atomically through the domain's write chain, creates the Session through the Session Controller (attached to the bound workspace when one is set), optionally runs the `/permission danger-full-access` command through the command runtime, queues the prompt as the Session's first user message, and then awaits the Agent's return to idle before finalizing the record `succeeded`. Any step that throws finalizes `failed` with the diagnostic; a full-access switch that cannot run (the permission-presets plugin absent) fails the run instead of silently proceeding with defaults. Per task, dispatches never overlap — a second due occurrence while one is in flight is skipped. Run records are pruned to the newest 50 per task after each run finishes.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `scheduleWorkGateway` Service Definition and the `scheduleWork` Remote projection |
| [`src/runtime.ts`](src/runtime.ts) | Task store, due-drain loop, dispatch, and run-record lifecycle |
| [`src/domain.ts`](src/domain.ts) | Pure rule validation and occurrence math over the Host's local time zone |
| [`src/spec.ts`](src/spec.ts) | The `schedule_work` domain declaration and durable record schemas |
| [`src/types.ts`](src/types.ts) | Record, rule, and wire vocabulary shared with the browser (the `./types` export) |
| — | No runtime invariant companion is published: the runtime owns both sides of its only cross-table relationship (run records reference tasks it also wrote), so independent observations cannot diverge. |

</details>

-----

<a id="dispatch-semantics"></a>
## Dispatch semantics

- **Durable facts are the task record and the run record.** `nextRunAt` is a derived projection, recomputed at every read and drain; the medium never stores it.
- **Catch-up is latest-only.** Missed calendar or fixed-rate occurrences never replay; exactly one dispatch consumes the whole window, stamped with the latest missed occurrence.
- **Paused tasks never fire.** Pausing (`enabled: false`) keeps the rule and the run history; resuming recomputes from the stored `lastRunAt`, so the next occurrence is always strictly in the future relative to the last dispatch.
- **A run's `succeeded` means the Session returned to idle.** It is delivery telemetry, not a verdict on the agent's work; the linked Session holds that.
- **Run history is bounded.** The newest 50 records per task survive; older ones are removed after a run finishes.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Schedule package](../schedule/README.md) — session-local reminders, a different capability: reminders bind to one conversation and deliver into it, while schedule-work tasks open their own Sessions.
- [Client schedule-work page](../../client/ui-schedule-work/README.md) — the sidebar entry, task catalog, and editor that consume this Remote namespace.
- [Storage domain data form](../../../packages/storage/storage-domain/README.md) — the durable medium this package declares its tables in.
- [Permission presets](../../../docs/subsystems/permission-presets.md) — the preset table the full-access switch addresses.

-----

<a id="model-experience"></a>
## Model Experience

### Scheduled dispatch

#### What the model sees

Each dispatch delivers the task's prompt as the created Session's first user message — model-visible input that the Session's own log records, so this package registers no prompt section and no session event of its own. When the task requests full access, the `/permission danger-full-access` command runs before the prompt; the switch's transcript effect belongs to the permission-presets seam.

#### Token effect

The delivered prompt is the only new request content, sized by the user-authored task prompt. Scheduling metadata — ids, rules, run records — never enters a request, and the package adds no private truncation or token budget.

#### KV Cache effect

Dispatches append an ordinary queued user message to a fresh Session; they neither replace existing request tokens nor split a Session across providers. Reuse of the created Session's prefix is the agent loop's own contract.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Local time zone only** — calendar rules resolve against the Host's clock; there is no per-task IANA zone.
- **No cron expressions** — the five rule kinds above are the whole grammar; "every weekday in February" is not expressible.
- **Catch-up never replays** — a Host that was off misses every slot; one dispatch at the latest missed slot is the whole recovery.
- **No run-time cancellation** — a dispatch in flight cannot be recalled from this package; cancel the Session itself.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The runtime takes a `now: () => Date` clock parameter; production uses the platform wall clock and tests pin explicit instants — no production clock service. The full-access preset is addressed by the shipped preset table's key, spelled as the `/permission danger-full-access` command line, because the preset switch is the permission-presets package's owned seam.

</details>
