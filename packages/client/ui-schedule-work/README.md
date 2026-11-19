---
description: "Scheduled-work page components that are not mounted. Automation tasks is the sidebar scheduling entry."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-schedule-work

English | [中文](README.zh.md)

## Summary

This package does not mount a sidebar row or a main page. Automation tasks is the left-sidebar scheduling entry, including More, so the 定时工作 row is not registered. The page component remains: a task catalog beside a run-records tab, with rule summaries, derived status, next run, status filter, search, refresh, and batch pause, resume, and removal. The add/edit dialog covers the name, prompt, workspace binding, full access, schedule rule, and validity. All data flows through the Host's `scheduleWork` Remote face; the page holds no schedule state of its own.

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

The shipped Web and desktop rosters load this plugin, and `apply` registers only the `scheduleWork` dictionaries. It does not register `sidebar.panellist` or a `main` panel, so 定时工作 does not appear in the sidebar or in More.

The unmounted `ScheduleWorkPage` still behaves as follows. The two tabs share one toolbar: status filter and search apply to the task catalog; refresh re-reads both lists. Row actions (edit, pause or resume, delete) appear on hover outside batch mode. Batch mode replaces them with checkboxes and one action bar. The editor dialog validates locally (non-empty name and prompt, a complete rule) and disables submission until the form is complete; a refused submit surfaces the Host's diagnostic under the form.

### Status and summaries

A task's displayed status is derived: `active` when enabled with a next occurrence, `paused` when disabled (winning over expiry, so a paused task never reads as ended), `ended` when enabled but nothing more will fire (a spent `once`, or validity past its end). Rule summaries are browser-formatted from the durable rule — `每天 09:00`, `每周 周一 08:30`, `每 5 分钟` — in the viewing locale; the absolute next-run line uses the browser's date-time formatting. Run rows show the owning task's name, start and finish times, and the dispatch outcome; a failed run carries the Host's diagnostic.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`apply` registers the `scheduleWork` dictionaries and no slots. `ScheduleWorkPage` is not mounted. The component still takes a `scheduleWork` callback face, the global `useWorkspaces` hook for the editor's workspace picker, and the namespace's `t` seat. Local state is presentation only: tab, filter, search, selection, dialog state, and the loaded lists.

### Source map

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Browser entry: `scheduleWork` dictionaries only |
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
- [Automation tasks page](../ui-schedule/README.md) — the sidebar scheduling entry, including More.
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
