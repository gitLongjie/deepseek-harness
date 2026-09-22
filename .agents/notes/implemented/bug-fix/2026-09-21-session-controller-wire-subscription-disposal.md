# Agent Note: Dispose the Session Controller's wire subscriptions on reload

Status: implemented

[English](2026-09-21-session-controller-wire-subscription-disposal.md) | 中文

## Problem

A frozen desktop main window (renderer burning CPU for hours) left two facts in the logs: the `dsh-api-session-controller` client entry re-activated over and over — hundreds of times across long-running sessions — and the preload bridge eventually warned `11 dsh:stream:frame listeners added`. Each re-activation re-ran the entry's `apply`, which registered six wire subscriptions (`api-session/*` Remote events, `connection/reset`, and the typert `agent` client adapter) **without keeping their disposers**. Old subscriptions kept firing into the retired `ClientSessions` instance, so every session-list event cost one more full pass and the renderer's event handling grew without bound until the main thread starved.

The trigger that restarts the entry in the first place is still unidentified (it fires at irregular intervals from seconds to hours, only for this entry, with no other loader entry cycling). But the leak is what turns a restart into an unbounded cost curve, and the restart itself is cheap once the cost stops accumulating.

## Decision

`packages/api/session-controller/src/client/index.ts` now registers every wire subscription inside one `ctx.effect`, so a reload withdraws the previous activation's set before the new one binds. Two sibling leaks of the same shape found in the sweep are fixed the same way: `ui-approval`'s `approval/request` waterfall listener and `ui-commands`' `commands/change` / `agent-preset/selected` / `connection/reset` subscriptions move under `ctx.effect`.

## Alternatives considered

**Hunting the restart trigger first.** Without the leak the restart cost is bounded, so fixing the leak removes the freeze even while the trigger is still unknown; the trigger needs a long instrumented run to catch and can follow.

**Clearing listeners inside `ClientSessions`.** The retired instance cannot withdraw subscriptions it does not own; ownership lives at the registration site in `apply`.

## Consequences

A re-activation now costs one bounded `apply` pass instead of one more permanent subscription. Remote-event waterfalls and `connection/reset` handlers stop running against retired session state, which also removes stale-instance handling as a source of phantom list updates. The restart trigger remains open: the next freeze's precursor is a `[boot] Nms entry @deepseek-ai/dsh-api-session-controller -> active` line in `desktop.log` with a growing `N`, and a CDP probe (`--remote-debugging-port`) attached before it recurs can capture the restarting call stack.
