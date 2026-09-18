---
description: "The schedule group map: session-local reminders and app-level scheduled tasks, for users and maintainers navigating the group."
kind: "package-group"
---

# schedule/ — Reminders and scheduled tasks

English | [中文](README.zh.md)

## Summary

The schedule group owns two kinds of time-based automation. The `schedule` package lets an agent create, list, and cancel reminders for the current conversation: after a delay, at an absolute time, or on a fixed interval, delivered as ordinary messages in that conversation; they survive restarts but never leave the session or send email, SMS, or push notifications. The `schedule-work` package is the app-level capability behind the 定时工作 page: user-authored tasks on calendar or fixed-rate rules that open their own Sessions, with pause, validity bounds, and run records. Optional browser packages show the reminder catalog and manage the tasks.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`schedule/`](schedule/README.md) | Session-local reminders: schedule, list, and cancel active records; publish an optional read-only projection for the header catalog and list-row marker; deliver due reminders as conversation messages | — (tools only, in the exact agent scope) |
| [`schedule-work/`](schedule-work/README.md) | App-level scheduled tasks on calendar or fixed-rate rules dispatched into their own Sessions, with run records and the `scheduleWork` Remote namespace | `scheduleWorkGateway` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Session-local Schedule subsystem](../../docs/subsystems/schedule.md) — durable record, transition, view, and delivery contracts.
- [Generated tool catalog](../../docs/tool-catalog.md#deepseek-aidsh-schedule) — the `schedule_create`/`schedule_list`/`schedule_delete` schemas the model receives.
- [Schedule user guide](../../docs/user/guide/schedule.md) — the official configuration path for mounting the package.
- [Web Schedule catalog](../client/ui-schedule/README.md) — the optional read-only browser presentation of active records.
- [Scheduled-work page](../client/ui-schedule-work/README.md) — the sidebar entry, task catalog, editor, and run records for app-level tasks.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
