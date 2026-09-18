---
description: "The scheduled-work management surface: the sidebar panel row, the task catalog with batch management, the editor dialog, and run records, for users and maintainers of the page."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-schedule-work

English | [中文](README.zh.md)

## Summary

This package renders the 定时工作 (scheduled work) management surface: a clock-icon sidebar row that switches the central column to a full-page task catalog beside a run-records tab. The catalog lists tasks with their rule summary, derived status, and next run; it filters by status, searches, refreshes, and supports batch pause, resume, and removal. The add/edit dialog covers the name, prompt, workspace binding, full access, schedule rule, and validity. All data flows through the Host's `scheduleWork` Remote face; the page holds no schedule state of its own.

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

The shipped Web and desktop rosters enable this plugin together with the Host `schedule-work` row; no overlay is needed. In the expanded sidebar the row shows the clock icon and the localized 定时工作 label; in the collapsed rail it is the icon alone, with the label as its tooltip and accessible name. Selecting the row navigates through the layout service (`ctx.layout.selectPanel`), so the conversation stays intact behind it — returning to the conversation is the shell's own navigation.

The two tabs share one toolbar: status filter and search apply to the task catalog; refresh re-reads both lists. Row actions (edit, pause or resume, delete) appear on hover outside batch mode. Batch mode replaces them with checkboxes and one action bar. The editor dialog validates locally (non-empty name and prompt, a complete rule) and disables submission until the form is complete; a refused submit surfaces the Host's diagnostic under the form.

### Status and summaries

A task's displayed status is derived: `active` when enabled with a next occurrence, `paused` when disabled (winning over expiry, so a paused task never reads as ended), `ended` when enabled but nothing more will fire (a spent `once`, or validity past its end). Rule summaries are browser-formatted from the durable rule — `每天 09:00`, `每周 周一 08:30`, `每 5 分钟` — in the viewing locale; the absolute next-run line uses the browser's date-time formatting. Run rows show the owning task's name, start and finish times, and the dispatch outcome; a failed run carries the Host's diagnostic.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin makes two slot registrations whose declarations it depends on but does not own, each through `ctx.slots.inject` so activation order is irrelevant: a `sidebar.panellist` list entry (id `schedule-work`, order 60, label thunk) whose cell renders the alarm-clock icon, and a keyed `main` entry under the same key rendering `ScheduleWorkPage`. The layout service validates panel selection against the live main registry, so the pair is the whole contract. The page component receives the injected `scheduleWork` face (thin RemoteResult-unwrapping wrappers over `ctx.remote.scheduleWork`), the global `useWorkspaces` hook for the editor's workspace picker, and the namespace's `t` seat. Local state is presentation only: tab, filter, search, selection, dialog state, and the loaded lists.

### Source map

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Browser entry: dictionaries, sidebar panel row, and keyed main-page registration |
| [`src/client/ScheduleWorkPage.tsx`](src/client/ScheduleWorkPage.tsx) | Catalog tabs, toolbar, batch management, and run-records list |
| [`src/client/TaskEditor.tsx`](src/client/TaskEditor.tsx) | The add/edit dialog and its rule editor |
| [`src/client/task-format.ts`](src/client/task-format.ts) | Pure rule summaries, derived status, and time formatting |
| [`src/client/locales.ts`](src/client/locales.ts) | English and Chinese page copy |
| [`src/index.ts`](src/index.ts) | Empty Host apply that keeps the browser feature addressable by Loader |
| — | No runtime invariant companion is published because this page owns no mutable cross-plugin state. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Schedule-work package](../../schedule/schedule-work/README.md) — the durable tasks, dispatch loop, and run records behind this page.
- [Sidebar shell](../ui-sidebar/README.md) — the global panel list this package's row registers into.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the durable task records it edits; the schedule-work runtime that dispatches them owns every model-facing effect.

#### KV Cache effect

No direct invalidation. Creating, pausing, or removing a task changes no running session's prefix or recorded state; a Session a later dispatch creates establishes its own prefix from its own composition.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No live updates** — the page reads on mount, on refresh, and after each mutation; a dispatch that fires elsewhere while the page is open appears on the next refresh, not live.
- **No run-record actions** — records are read-only; opening the linked Session from a run row is future work.
- **Batch scope** — batch operations apply to the current selection only; there is no select-all-across-filters.
- **Monthly rules are single-day** — the editor offers one day of month per task, though the wire type accepts a list.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
